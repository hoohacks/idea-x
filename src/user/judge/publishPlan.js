import { ref, get, update, push, serverTimestamp } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { guardWith } from "../admin/snapshots.js";
import { resolveName } from "../admin/adminAction.js";
import { checkDrift, readLiveBasis } from "./checkDrift.js";
import { FIRST_ROUND } from "./getTeamInfo.js";
import { strandedBy, describeStranded } from "./strandedScores.js";

/**
 * Publishes a plan: the one place that replaces every judge and team
 * assignment in a live event.
 *
 * `planSchedule` builds a plan with no writes, so an organizer can review and
 * hand-edit it in the preview before anything is saved. This is the other
 * half -- it takes that plan, refuses anything that is not safe to write, and
 * then writes it all in one atomic update.
 *
 * Order matters:
 *   1. Confirm the caller is an admin -- a guard rail, not the boundary; the
 *      root rule in database.rules.json is what actually stops a non-admin.
 *   2. Refuse an empty plan, or one with a team that has no judges. A moveTeam
 *      edit is allowed to place a previously unscheduled team with an empty
 *      panel -- that is deliberate, so an organizer can drop a team into a
 *      room before assigning judges. Publishing one would send a team to a
 *      room nobody is coming to, so this is caught here, before anything is
 *      touched.
 *   3. Re-read the world and compare it to the plan's basis. Any blocking
 *      drift -- a team or judge that moved since the plan was built -- refuses
 *      the publish rather than write a schedule that is quietly wrong.
 *   4. Take a restore point of everything about to be replaced. If it cannot
 *      be taken, abandon -- a wipe with no restore point is exactly what that
 *      module exists to prevent.
 *   5. Write everything -- every judge's derived copy, every team's slot, the
 *      schedule metadata, the audit entry, and the cleared draft -- in ONE
 *      multi-path update, so a dropped connection cannot land some of it
 *      without the rest.
 *
 * Returns { ok, error?, drift?, snapshotId? }. Never throws.
 */
export async function publishPlan(plan, { discardScores = false } = {}) {
    try {
        // a guard rail, not the boundary: the root rule is what actually stops
        // a non-admin, but failing here gives a usable message instead of a
        // bare PERMISSION_DENIED from a multi-path update
        const admin = await requireAdmin("publish the judging schedule");

        // ---- refuse anything unpublishable, before touching the database ----

        const assignments = Object.values(plan.assignments ?? {});
        if (!assignments.length) {
            return { ok: false, error: "This plan has no assignments. There is nothing to publish." };
        }

        // applyEdit's moveTeam deliberately lets an organizer place a previously
        // unscheduled team with an empty panel -- useful while hand-editing, but
        // publishing one would send that team to a room nobody is coming to.
        const unjudged = assignments.filter((a) => a.judges.length === 0);
        if (unjudged.length) {
            return {
                ok: false,
                error: `${unjudged.length} team(s) have no judges assigned (${unjudged
                    .map((a) => a.teamName)
                    .join(", ")}). Assign a judge to each before publishing.`,
            };
        }

        // ---- refuse a plan whose inputs have moved underneath it ----

        const live = await readLiveBasis(plan.onlyCheckedIn);
        const drift = checkDrift(plan.basis, live, plan);
        if (drift.blocking.length) {
            return { ok: false, error: "This plan is out of date and cannot be published as is.", drift };
        }

        // ---- refuse a plan that would orphan work already done ----
        //
        // A card lives at scores/first/{teamId}/{judgeUid}. Republishing moves
        // assignments and no cards, so a card whose pair this plan does not
        // seat keeps counting toward that team's average -- the average the
        // final-round cut is made from -- while belonging to a judge who will
        // not be in the room. Nothing downstream can tell that has happened.
        //
        // Only the dangerous case is refused: a re-plan that still seats every
        // judge who has scored, and the first publish of an event, strand
        // nothing and go through untouched. `discardScores` is the deliberate
        // way past it, and clears the cards rather than leaving them orphaned.
        const scoresSnap = await get(ref(database, `scores/${FIRST_ROUND}`));
        const stranded = strandedBy(plan, scoresSnap.exists() ? scoresSnap.val() : {});

        if (stranded.length && !discardScores) {
            return {
                ok: false,
                stranded,
                error:
                    `${stranded.length} score card(s) have already been filed for pairings this ` +
                    `plan does not keep: ${describeStranded(stranded, plan)}. Publishing would ` +
                    `leave them counting toward the standings for judges who are no longer ` +
                    `assigned. Move a single judge from Judging progress instead, or discard the ` +
                    `first round scores and publish again.`,
            };
        }

        // ---- restore point, before anything is replaced ----
        //
        // Publishing rewrites every assignment in the event. It used to do so
        // with a bare update() -- no audit entry, no before-state, no undo --
        // which made the single most destructive button in the app the only one
        // with no way back.
        const guard = await guardWith({
            label: `Before publishing the schedule (${live.teamIds.length} teams, ${live.judgeIds.length} judges)`,
            reason: "publishing replaces every assignment in the event",
            // `scores` only when they are about to be destroyed, so the
            // discard is undoable rather than a one-way door
            paths: discardScores
                ? ["teams", "judges", "config/scheduleMeta", "scores"]
                : ["teams", "judges", "config/scheduleMeta"],
        });
        if (!guard.ok) return { ok: false, error: guard.error };

        // ---- write everything in one atomic update ----
        //
        // `live.allTeamIds`/`live.allJudgeIds` -- the unfiltered id sets
        // `readLiveBasis` already read, underneath its filtered `teamIds`/
        // `judgeIds` -- are used here rather than a second raw read of the same
        // two nodes. They are needed to clear stale schedule data for anyone
        // NOT in this plan -- a team that withdrew, a judge who is no longer
        // eligible -- which is a wider set than the filtered roster the plan
        // was checked against.

        const byJudge = {};
        for (const assignment of assignments) {
            for (const judge of assignment.judges) {
                (byJudge[judge.judgeId] ??= {})[assignment.id] = assignment;
            }
        }

        const updates = {};

        // Every judge id currently in the database: their derived copy, or
        // null to clear a stale one for a judge this plan did not assign --
        // including one no longer eligible at all.
        live.allJudgeIds.forEach((judgeId) => {
            const assigned = byJudge[judgeId];
            updates[`judges/${judgeId}/teamAssignments`] =
                assigned && Object.keys(assigned).length ? assigned : null;
        });

        // Every team id currently in the database: its assignment, or null to
        // clear a stale one for a team this plan did not place -- including
        // one that withdrew its submission since the plan was built.
        live.allTeamIds.forEach((teamId) => {
            updates[`teams/${teamId}/schedule`] = plan.assignments[teamId] ?? null;
        });

        // In the SAME update as the schedule, so a dropped connection cannot
        // land the new assignments while leaving the old cards behind against
        // them -- which is the exact state this guard exists to prevent.
        if (discardScores) updates[`scores/${FIRST_ROUND}`] = null;

        updates["config/scheduleMeta"] = {
            generatedAt: serverTimestamp(),
            generatedBy: admin.uid,
            teams: live.teamIds.length,
            judges: live.judgeIds.length,
            onlyCheckedIn: !!plan.onlyCheckedIn,
        };

        // The draft is cleared here, inside this same update, rather than via a
        // separate clearDraft() call -- a second write could fail independently
        // and leave a published schedule with a live draft still sitting on top
        // of it.
        updates["scheduleDraft"] = null;

        // The audit entry goes out in the SAME update as the schedule, so a
        // dropped connection cannot land one without the other. Its changes are
        // omitted deliberately: the before-state is in the restore point above,
        // which is precisely what the log's size cap could not hold.
        const entryId = push(ref(database, "adminLog")).key;
        updates[`adminLog/${entryId}`] = {
            at: serverTimestamp(),
            by: admin.uid,
            byName: await resolveName(admin.uid),
            action: "schedule.publish",
            summary:
                `Published the judging schedule: ${live.teamIds.length} teams, ${live.judgeIds.length} judges` +
                `${plan.onlyCheckedIn ? ", checked-in only" : ""}. Restore point taken first.` +
                (plan.edits?.length
                    ? ` Hand edited: ${plan.edits.map((e) => e.summary).join("; ")}.`
                    : ""),
            undoable: false,
        };

        await update(ref(database), updates);

        return {
            ok: true,
            error: null,
            snapshotId: guard.snapshotId,
        };
    } catch (error) {
        console.error("Error publishing the judging schedule:", error);
        return { ok: false, error: error.message || "Something went wrong publishing the schedule." };
    }
}

export default publishPlan;

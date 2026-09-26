import { ref, get } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { splitIntoBatches, allocateBatch, describeSupply } from "./schedulePlan.js";
import { fetchRooms, fetchBatchConfig, displayName } from "./scheduleConfig.js";
import { judgesRoundOne, judgesEitherRound } from "./judgeRoles.js";

/**
 * Builds the first round judging schedule as a plan, without writing it.
 *
 * Teams are split into batches that each present at a different time. Within a
 * batch every team gets its own room, and every judge is sent to at most one
 * team per batch, so no judge is ever double booked.
 *
 * Returns { ok, error, warnings, advice, plan }. It never throws, and it
 * issues no writes -- the plan it returns is handed to a separate publish
 * step, so an organizer can see and hand-edit a schedule before anything is
 * saved.
 *
 * `onlyCheckedIn` restricts the pool to judges who have actually arrived.
 * Check-in state used to be ignored entirely, so a judge who never turned up
 * still got a third of the rooms and the teams they were sent to went unseen,
 * with nothing anywhere reporting it.
 */
export async function planSchedule({ onlyCheckedIn = false } = {}) {
    const warnings = [];
    const fail = (error, advice = []) => ({
        ok: false, error, warnings, advice, plan: null,
    });

    try {
        // a guard rail, not the boundary: the root rule is what actually stops
        // a non-admin, but failing here gives a usable message instead of a
        // bare PERMISSION_DENIED from a multi-path update
        await requireAdmin("plan the judging schedule");
        const [judgeSnapshot, teamSnapshot, rooms, batchConfig] = await Promise.all([
            get(ref(database, "judges")),
            get(ref(database, "teams")),
            fetchRooms(),
            fetchBatchConfig(),
        ]);

        if (!judgeSnapshot.exists()) return fail("There are no judges registered yet.");
        if (!teamSnapshot.exists()) return fail("There are no teams registered yet.");

        const judgeData = judgeSnapshot.val();
        const teamData = teamSnapshot.val();

        const roundOneJudges = Object.entries(judgeData)
            .filter(([, details]) => judgesRoundOne(details))
            .map(([id, details]) => ({ id, ...details }));

        // Everyone an organizer could legitimately put on a panel, which is a
        // wider set than the one allocated from. Judges marked for the final
        // round only -- the professors and professionals -- are never handed a
        // batch here, but they are named below so the plan drawer can offer one
        // by hand when a round-one judge does not turn up. `basis.judgeIds`
        // deliberately stays the round-one pool: it is what drift is checked
        // against, and it has to describe what was actually allocated from.
        const pickableJudges = Object.entries(judgeData)
            .filter(([, details]) => judgesEitherRound(details))
            .map(([id, details]) => ({ id, ...details }));

        const judgesList = onlyCheckedIn
            ? roundOneJudges.filter((judge) => judge.checkedIn === true)
            : roundOneJudges;

        const absent = roundOneJudges.length - judgesList.length;
        if (onlyCheckedIn && absent > 0) {
            warnings.push(`${absent} first round judge(s) have not checked in and were left out.`);
        }

        const teamsList = Object.entries(teamData)
            .filter(([, details]) => details?.submitted)
            .map(([id, details]) => ({ id, ...details }));

        // ---- validate before building the plan ----

        if (!judgesList.length) {
            return fail(
                onlyCheckedIn && roundOneJudges.length
                    ? "None of the first round judges have checked in yet. Check them in on the Judge Search page, or build the plan without the check-in filter."
                    : "No judges are marked as first round judges. Mark them on the Judge Search page, then build the plan again."
            );
        }

        // Every supply question -- too few rooms, too few judges, too many
        // judges for too few teams, batches that do not divide evenly -- is
        // answered in one place, with numbers the organizer can act on.
        const supply = describeSupply({
            teamCount: teamsList.length,
            judgeCount: judgesList.length,
            roomCount: rooms.length,
            batchCount: batchConfig.batchCount,
            target: batchConfig.target,
        });

        if (!supply.ok) return fail(supply.error, supply.advice);
        warnings.push(...supply.warnings);

        if (teamsList.some((team) => !team.name)) {
            warnings.push("Some submitted teams have no name and will show up blank on the schedule.");
        }

        // ---- build the plan ----

        const batches = splitIntoBatches(teamsList, batchConfig.batchCount)
            .filter((batch) => batch.length > 0);

        const teamAssignments = {};
        // keyed by team id rather than an array: rules can address a single
        // assignment, and deleting one cannot renumber the rest
        const assignedJudgeIds = new Set();

        batches.forEach((batch, batchIndex) => {
            const batchNumber = batchIndex + 1;

            batch.forEach((team, seat) => {
                teamAssignments[team.id] = {
                    teamName: team.name ?? "Unnamed Team",
                    id: team.id,
                    room: rooms[seat],
                    time: batchConfig.batchTimes[batchNumber] ?? "TBD",
                    batch: batchNumber,
                    judges: [],
                };
            });

            const panels = allocateBatch({
                judgeCount: judgesList.length,
                batchSize: batch.length,
                batchIndex,
                target: batchConfig.target,
            });

            panels.forEach((panel, seat) => {
                const assignment = teamAssignments[batch[seat].id];
                panel.forEach((judgeIndex) => {
                    const judge = judgesList[judgeIndex];
                    assignment.judges.push({
                        judgeName: displayName(judge, "Unnamed Judge"),
                        judgeId: judge.id,
                    });
                    assignedJudgeIds.add(judge.id);
                });
            });
        });

        const unjudged = Object.values(teamAssignments).filter((a) => a.judges.length === 0);
        if (unjudged.length) {
            // Unreachable given the checks above, but refuse to build a plan that
            // would send a team to a room nobody is coming to.
            return fail(
                `${unjudged.length} team(s) ended up with no judges (${unjudged
                    .map((a) => a.teamName)
                    .join(", ")}). No plan was built.`
            );
        }

        // Name the teams an organizer might still want to do something about,
        // rather than saying "some teams" and leaving them to find out which.
        const thin = Object.values(teamAssignments).filter((a) => a.judges.length < 2);
        if (thin.length) {
            warnings.push(
                `Seen by one judge only: ${thin.map((a) => a.teamName).join(", ")}. ` +
                "Add a judge to these from Judging progress."
            );
        }

        const spare = judgesList.filter((judge) => !assignedJudgeIds.has(judge.id));
        if (spare.length) {
            warnings.push(
                `${spare.length} judge(s) have no assignment at all and are spares: ` +
                `${spare.map((j) => displayName(j, "Unnamed Judge")).join(", ")}.`
            );
        }

        return {
            ok: true,
            error: null,
            warnings,
            advice: supply.advice,
            plan: {
                assignments: teamAssignments,
                basis: {
                    teamIds: teamsList.map((t) => t.id).sort(),
                    judgeIds: judgesList.map((j) => j.id).sort(),
                    rooms,
                    batchCount: batchConfig.batchCount,
                    batchTimes: batchConfig.batchTimes,
                    target: batchConfig.target,
                },
                onlyCheckedIn,
                judgeNames: Object.fromEntries(
                    pickableJudges.map((j) => [j.id, displayName(j, "Unnamed Judge")])
                ),
                // the ids in `judgeNames` that the generator would never seat,
                // so the drawer can mark them as the reach outside the pool
                // that they are
                finalOnlyJudgeIds: pickableJudges
                    .filter((j) => !judgesRoundOne(j))
                    .map((j) => j.id),
                teamNames: Object.fromEntries(
                    teamsList.map((t) => [t.id, t.name ?? "Unnamed Team"])
                ),
            },
        };
    } catch (error) {
        console.error("Error planning judge schedule:", error);
        return fail(error.message || "Something went wrong planning the schedule.");
    }
}

export default planSchedule;

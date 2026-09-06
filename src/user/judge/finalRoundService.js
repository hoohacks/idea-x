import { ref, get, update, onValue, serverTimestamp } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { FIRST_ROUND } from "./getTeamInfo.js";
import { compareForRanking, rankingEntry, scoredJudgeCount } from "./scoreRubric.js";
import { guardWith } from "../admin/snapshots.js";
import { buildFinalPlan, slotsOf, slotLabel, orphanedIn } from "./finalRoundPlan.js";
import { checkFinalDrift, blockingOnly, BLOCKING } from "./checkFinalDrift.js";
import { clearFinalDraft } from "./finalDraftStore.js";

export const FINAL_ROUND_ROOM = "Rice 011";

/** Overridden by config/finalRoundSize. */
export const DEFAULT_FINAL_ROUND_SIZE = 4;

/**
 * Below this, an average is not really a ranking — it is one person's opinion.
 * Teams under it are still ranked, but the plan reports them so an organizer
 * can send a judge round before the cut is made rather than discovering it
 * afterwards.
 */
export const MIN_JUDGES_FOR_CONFIDENCE = 2;

/**
 * Every first-round card, as { teamId: { judgeUid: card } }.
 *
 * One location. Cards used to live under the team node as well, and this read
 * merged both so nothing vanished during the cutover; that is finished, and the
 * app neither writes nor reads the old path any more.
 */
export async function loadFirstRoundScores() {
  const byTeam = {};

  const snap = await get(ref(database, `scores/${FIRST_ROUND}`));
  if (snap.exists()) {
    for (const [teamId, cards] of Object.entries(snap.val() ?? {})) {
      byTeam[teamId] = { ...(cards ?? {}) };
    }
  }

  return byTeam;
}

/**
 * Rank every team that has at least one usable card.
 *
 * Ties are broken explicitly rather than left to sort stability, which would
 * hand the last podium place to whichever team Firebase happened to give the
 * earlier push key.
 */
export function rankTeams(teamsData, scoresByTeam) {
  return Object.entries(teamsData ?? {})
    .map(([teamId, team]) => ({
      ...rankingEntry(teamId, team?.name, scoresByTeam?.[teamId]),
      submitted: Boolean(team?.submitted),
    }))
    .filter((team) => typeof team.averageScore === "number")
    .sort(compareForRanking);
}

/**
 * Judges eligible to work the final round: checked-in round-one judges, or
 * -- if nobody is checked in -- every round-one judge, so a final round is
 * never silently assigned to nobody.
 *
 * This used to iterate every registered judge, so somebody who signed up in
 * October and never turned up still received finalAssignments -- and that
 * node is what the rules treat as proof of assignment for writing a final
 * score. Shared by the planner and the publisher, so the two cannot disagree
 * about who counts.
 */
function eligibleJudgePool(judgesData) {
  const workingJudges = Object.entries(judgesData)
    .filter(([, judge]) => judge?.isRound1Judge === true && judge?.checkedIn === true)
    .map(([uid]) => uid);
  if (workingJudges.length) return workingJudges;
  return Object.entries(judgesData)
    .filter(([, judge]) => judge?.isRound1Judge === true)
    .map(([uid]) => uid);
}

/**
 * Everything the planner and the publisher both need to read.
 *
 * Shared so the two cannot disagree about who counts as an eligible judge or
 * what the room is — the failure mode that lets a plan publish differently
 * from how it looked.
 */
async function readFinalWorld() {
  const [teamsSnap, judgesSnap, sizeSnap, roomSnap] = await Promise.all([
    get(ref(database, "teams")),
    get(ref(database, "judges")),
    get(ref(database, "config/finalRoundSize")),
    get(ref(database, "config/finalRoundRoom")),
  ]);

  const teamsData = teamsSnap.exists() ? teamsSnap.val() ?? {} : {};
  const judgesData = judgesSnap.exists() ? judgesSnap.val() ?? {} : {};
  const scoresByTeam = await loadFirstRoundScores();

  const size = Number(sizeSnap.val());
  return {
    teamsData,
    judgesData,
    scoresByTeam,
    size: Number.isInteger(size) && size > 0 ? size : DEFAULT_FINAL_ROUND_SIZE,
    // The control panel has always been able to set this. Until now the write
    // ignored it and used the constant, so changing the room in the control
    // panel changed the display and nothing else.
    room: roomSnap.exists() ? String(roomSnap.val()) : FINAL_ROUND_ROOM,
  };
}

/** The eligible pool with display names, in the shape the plan carries. */
function poolWithNames(judgesData) {
  return eligibleJudgePool(judgesData).map((uid) => ({
    judgeId: uid,
    judgeName:
      [judgesData[uid]?.firstName, judgesData[uid]?.lastName].filter(Boolean).join(" ").trim() ||
      "Unnamed Judge",
  }));
}

/**
 * What an organizer should know about a plan, whether it was just built or
 * hand-edited since.
 *
 * Recomputed on every render rather than frozen at build time, so an edit that
 * creates a problem — emptying a panel, dropping the wrong team — says so while
 * there is still time to fix it.
 */
export function warningsFor(plan) {
  const warnings = [];
  const ranked = plan?.ranked ?? [];
  const finalists = slotsOf(plan);

  if (!finalists.length) return ["No teams are in the cut."];

  const thin = finalists
    .map((slot) => ranked.find((team) => team.teamId === slot.teamId))
    .filter((team) => team && team.judgeCount < MIN_JUDGES_FOR_CONFIDENCE);
  if (thin.length) {
    warnings.push(
      `${thin.map((t) => t.name).join(", ")} reached the final on fewer than ` +
        `${MIN_JUDGES_FOR_CONFIDENCE} judges.`
    );
  }

  // a tie straddling the cut line is the one an organizer has to know about
  const inCut = new Set(finalists.map((slot) => slot.teamId));
  const lastIn = [...ranked].reverse().find((team) => inCut.has(team.teamId));
  const firstOut = ranked.find((team) => !inCut.has(team.teamId));
  if (lastIn && firstOut && lastIn.averageScore === firstOut.averageScore) {
    warnings.push(
      `${lastIn.name} and ${firstOut.name} tied on average; the tiebreak put ${lastIn.name} through.`
    );
  }

  if (!(plan?.pool ?? []).length) {
    warnings.push(
      "No judges are marked as first-round judges, so nobody can be given a final-round assignment."
    );
  }

  const orphaned = orphanedIn(plan);
  if (orphaned.length) {
    warnings.push(
      `${orphaned.join(", ")} reached the final round with no eligible judge — every available ` +
        `judge already scored them in round one. Add a judge who did not, or they present to an ` +
        `empty room.`
    );
  }

  const empty = finalists
    .filter((slot) => !slot.judges.length && !orphaned.includes(slot.teamName))
    .map((slot) => slot.teamName);
  if (empty.length) {
    warnings.push(`${empty.join(", ")} has nobody on its panel and will present to an empty room.`);
  }

  return warnings;
}

/**
 * Build the plan an organizer edits, and write nothing.
 *
 * The planner half of the plan/publish split. It used to return a list of
 * finalists; it now returns a full draft — the cut, the running order, the room
 * and a panel per team — because everything derived at the moment of the write
 * was everything an organizer could not correct.
 *
 * Returns { ok, error?, plan, warnings }. Never throws.
 */
export async function planFinalRound({ requireSubmitted = true } = {}) {
  try {
    await requireAdmin("plan the final round");

    const world = await readFinalWorld();
    if (!Object.keys(world.teamsData).length) {
      return {
        ok: false,
        error: "No teams found to evaluate for the final round",
        plan: null,
        warnings: [],
      };
    }

    const ranked = rankTeams(world.teamsData, world.scoresByTeam)
      // an unsubmitted team has nothing to present; it used to be eligible
      .filter((team) => (requireSubmitted ? team.submitted : true));

    if (!ranked.length) {
      return {
        ok: false,
        error: "No teams have scores yet. Final round cannot be activated.",
        plan: null,
        warnings: [],
      };
    }

    const plan = buildFinalPlan({
      ranked,
      scoresByTeam: world.scoresByTeam,
      pool: poolWithNames(world.judgesData),
      size: world.size,
      room: world.room,
    });

    return { ok: true, error: null, plan, warnings: warningsFor(plan) };
  } catch (error) {
    console.error("Error planning the final round:", error);
    return {
      ok: false,
      error: error.message || "Something went wrong planning the final round.",
      plan: null,
      warnings: [],
    };
  }
}

/** The live state `checkFinalDrift` compares a plan against. */
export async function readLiveFinalBasis() {
  const world = await readFinalWorld();
  return {
    cardCounts: Object.fromEntries(
      Object.keys(world.teamsData).map((teamId) => [
        teamId,
        scoredJudgeCount(world.scoresByTeam[teamId]),
      ])
    ),
    eligibleJudges: Object.fromEntries(
      poolWithNames(world.judgesData).map((judge) => [judge.judgeId, true])
    ),
    submitted: Object.fromEntries(
      Object.entries(world.teamsData).map(([teamId, team]) => [teamId, Boolean(team?.submitted)])
    ),
    room: world.room,
    size: world.size,
    teamsData: world.teamsData,
    judgesData: world.judgesData,
  };
}

/**
 * Publish a planned final round.
 *
 * Takes the plan as given — the running order, the panels and the room an
 * organizer actually confirmed — rather than re-deriving any of it. Refuses on
 * blocking drift, takes a restore point, and only then writes.
 *
 * Three things go into ONE atomic update, so they cannot drift apart:
 *
 *   finalRound/*                        the standings, admin-readable only
 *   teams/{id}/finalSlot                the team's own room and time
 *   judges/{uid}/finalAssignments/{id}  what each judge has to see
 *
 * The last two exist because Realtime Database needs read permission at the
 * location being queried, and the standings must not be readable. Denormalising
 * is the same answer the first-round schedule already uses.
 *
 * Returns { ok, error?, drift?, warnings, snapshotId }. Never throws.
 */
export async function publishFinalRound(plan) {
  try {
    const user = await requireAdmin("activate the final round");

    const finalists = slotsOf(plan);
    if (!finalists.length) {
      return { ok: false, error: "No finalists to publish.", warnings: [] };
    }

    const live = await readLiveFinalBasis();
    const drift = checkFinalDrift(plan, live);
    if (blockingOnly(drift).length) {
      return { ok: false, error: null, drift, warnings: [] };
    }

    const updates = {};
    const teamsPayload = {};

    for (const slot of finalists) {
      const ranked = (plan.ranked ?? []).find((team) => team.teamId === slot.teamId);
      const timeslot = slotLabel(slot.order);

      teamsPayload[slot.teamId] = {
        name: slot.teamName,
        averageScore: ranked?.averageScore ?? 0,
        fundableVotes: ranked?.fundableVotes ?? 0,
        judgeCount: ranked?.judgeCount ?? 0,
        // still means "scored this team in round one", which is what
        // peopleService and dangerZone already clean up. The edit layer refuses
        // to seat an excluded judge, so this and the panel cannot disagree.
        excludedJudges: plan.excluded?.[slot.teamId] ?? {},
        timeslot,
        room: plan.room,
      };

      updates[`teams/${slot.teamId}/finalSlot`] = { room: plan.room, timeslot };
    }

    // clear any slot left over from a previous activation
    for (const teamId of Object.keys(live.teamsData)) {
      if (!(teamId in teamsPayload)) updates[`teams/${teamId}/finalSlot`] = null;
    }

    // each judge gets exactly the teams the plan seats them on, and nobody else
    // keeps an assignment -- that node is what the rules treat as proof of
    // assignment for writing a final score
    const perJudge = {};
    for (const slot of finalists) {
      for (const judge of slot.judges) {
        if (!perJudge[judge.judgeId]) perJudge[judge.judgeId] = {};
        perJudge[judge.judgeId][slot.teamId] = {
          teamId: slot.teamId,
          teamName: slot.teamName,
          room: plan.room,
          timeslot: slotLabel(slot.order),
        };
      }
    }
    for (const judgeUid of Object.keys(live.judgesData)) {
      updates[`judges/${judgeUid}/finalAssignments`] = perJudge[judgeUid] ?? null;
    }

    const guard = await guardWith({
      label: `Before activating the final round (${finalists.length} teams)`,
      reason: "activation rewrites every judge's final assignments and the standings",
      paths: ["teams", "judges", "finalRound"],
    });
    if (!guard.ok) return { ok: false, error: guard.error, warnings: [] };

    updates["finalRound/active"] = true;
    updates["finalRound/activatedAt"] = serverTimestamp();
    updates["finalRound/activatedBy"] = user.uid;
    updates["finalRound/teams"] = teamsPayload;

    await update(ref(database), updates);
    await clearFinalDraft();

    return {
      ok: true,
      error: null,
      drift: drift.filter((issue) => issue.level !== BLOCKING),
      warnings: warningsFor(plan),
      snapshotId: guard.snapshotId,
    };
  } catch (error) {
    console.error("Error publishing the final round:", error);
    return {
      ok: false,
      error: error.message || "Something went wrong publishing the final round.",
      warnings: [],
    };
  }
}

/**
 * Close the final round.
 *
 * Every denormalised copy is cleared in the same update as the flag. Leaving
 * `finalAssignments` behind would leave every judge holding write access to
 * /scores/final for those teams, because that node is what the rules treat as
 * proof of assignment.
 *
 * The standings are archived rather than deleted. Deactivating used to destroy
 * them outright while the final scores survived underneath, so reactivating
 * recomputed a possibly different finalist set against cards from the old one.
 */
export async function deactivateFinalRound() {
  const user = await requireAdmin("deactivate the final round");

  const [currentSnap, judgesSnap, teamsSnap] = await Promise.all([
    get(ref(database, "finalRound/teams")),
    get(ref(database, "judges")),
    get(ref(database, "teams")),
  ]);

  const updates = {};

  if (currentSnap.exists()) {
    updates[`finalRound/archive/${Date.now()}`] = {
      teams: currentSnap.val(),
      archivedAt: serverTimestamp(),
      archivedBy: user.uid,
    };
  }

  for (const judgeUid of Object.keys(judgesSnap.val() ?? {})) {
    updates[`judges/${judgeUid}/finalAssignments`] = null;
  }
  for (const teamId of Object.keys(teamsSnap.val() ?? {})) {
    updates[`teams/${teamId}/finalSlot`] = null;
  }

  updates["finalRound/active"] = false;
  updates["finalRound/teams"] = null;
  updates["finalRound/deactivatedAt"] = serverTimestamp();
  updates["finalRound/deactivatedBy"] = user.uid;

  await update(ref(database), updates);
  return { ok: true };
}

/**
 * Whether the final round is open. Readable by anyone signed in — it is the
 * only part of /finalRound that is.
 */
export function subscribeToFinalRoundActive(callback) {
  const unsubscribe = onValue(
    ref(database, "finalRound/active"),
    (snapshot) => callback({ active: snapshot.val() === true }),
    (error) => {
      console.error("Failed to subscribe to final round state:", error);
      callback({ active: false, error: error.message });
    }
  );
  return () => unsubscribe();
}

/**
 * The standings, with the average scores. Admin only — mount this behind a role
 * check or every judge logs a permission error on each page load.
 */
export function subscribeToFinalRoundStandings(callback) {
  const unsubscribe = onValue(
    ref(database, "finalRound/teams"),
    (snapshot) => callback({ teams: snapshot.exists() ? snapshot.val() : null }),
    (error) => {
      console.error("Failed to subscribe to final round standings:", error);
      callback({ teams: null, error: error.message });
    }
  );
  return () => unsubscribe();
}

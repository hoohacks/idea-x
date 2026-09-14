import { ref, get } from "firebase/database";
import { database } from "../../firebase.js";
import { fetchRooms, fetchBatchConfig, displayName } from "./scheduleConfig.js";
import { judgesRoundOne } from "./judgeRoles.js";

/**
 * What moved since a plan was built.
 *
 * A plan is a snapshot: `planSchedule` reads the world once and hands back a
 * draft an organizer can hand-edit before anything is published. Time passes
 * between that read and the publish -- a team submits, a judge goes home, a
 * room floods -- and publishing on the old snapshot would write a schedule
 * that is quietly wrong: a team with no slot, a judge on a card who is no
 * longer eligible.
 *
 * `checkDrift` is the comparison. It never touches the database -- it takes
 * the fingerprint the plan was built from (`basis`), the same shape read
 * fresh (`live`), and the plan itself, and sorts what changed into two piles:
 *
 *   blocking  -- the plan is now wrong, not merely stale. Each item carries a
 *                `repair`, a targeted fix an organizer can apply instead of
 *                rebuilding and losing their hand edits.
 *   advisory  -- shown, but the plan still publishes fine as it stands.
 *
 * `readLiveBasis` is the only half of this file that reads the database. It
 * has to shape teams and judges exactly as `planSchedule` does -- same
 * `submitted` filter, same `isRound1Judge` and `checkedIn` filters, the same
 * `displayName` -- or drift would fire on a difference that was never real,
 * just two places naming things differently.
 */

/** A batch+room pair, as a single comparable key. */
function slotKey(batch, room) {
  return `${batch}::${room}`;
}

/**
 * Whether two batchTimes maps carry the same pairs, regardless of key order.
 * `JSON.stringify` compares in enumeration order, so a config re-saved with
 * its keys in a different order -- nothing about the times themselves
 * changed -- would otherwise read as drift.
 */
function sameBatchTimes(a, b) {
  const aEntries = Object.entries(a ?? {});
  const bMap = b ?? {};
  if (aEntries.length !== Object.keys(bMap).length) return false;
  return aEntries.every(([batch, time]) => bMap[batch] === time);
}

/**
 * The first open room in the emptiest batch, for placing a team that showed
 * up after the plan was built. `null` means the event is full: every batch,
 * in every configured room, is already spoken for.
 *
 * `claimed` is every batch+room pair a repair generated EARLIER in this same
 * `checkDrift` call has already proposed. Without it, two teams that both
 * need placing would be evaluated independently against the plan's stale
 * assignments and could be handed the identical "free" room -- a repair an
 * organizer presses that dead-ends on the room already being taken by the
 * repair they just applied. Checking `claimed` as well is what keeps every
 * repair generated in one pass free of the others.
 */
function freeSlot(plan, live, claimed = new Set()) {
  for (let batch = 1; batch <= live.batchCount; batch++) {
    const taken = new Set(
      Object.values(plan.assignments).filter((a) => a.batch === batch).map((a) => a.room)
    );
    const room = live.rooms.find((r) => !taken.has(r) && !claimed.has(slotKey(batch, r)));
    if (room) return { batch, room };
  }
  return null;
}

/**
 * Compares the fingerprint a plan was built from (`basis`) against the same
 * shape read fresh (`live`), and classifies what moved. Pure -- no database,
 * no clock, nothing but the three arguments -- so it can be tested with plain
 * fixtures and used again unchanged wherever a plan needs re-checking.
 */
export function checkDrift(basis, live, plan) {
  const blocking = [];
  const advisory = [];

  const basisTeamIds = new Set(basis.teamIds);
  const liveTeamIds = new Set(live.teamIds);
  const liveJudgeIds = new Set(live.judgeIds);

  // Every batch+room pair a repair has already claimed in this call, shared
  // across the "teams appeared" and "rooms removed" sections below, so the
  // two kinds of room repair can never point two organizer actions at the
  // same slot.
  const claimedSlots = new Set();

  // ---- teams that submitted since the plan was built ----
  const appeared = live.teamIds.filter((id) => !basisTeamIds.has(id)).sort();
  for (const teamId of appeared) {
    const teamName = live.teamNames?.[teamId] ?? teamId;
    const slot = freeSlot(plan, live, claimedSlots);
    if (slot) {
      claimedSlots.add(slotKey(slot.batch, slot.room));
      blocking.push({
        kind: "teamAppeared",
        message: `${teamName} submitted after this plan was built and has no slot.`,
        // `teamName` rides along on the repair itself: `plan.teamNames` was
        // built by planSchedule from teams that existed AT PLAN TIME, which
        // by definition excludes a team that appeared afterward. Without it,
        // applyEdit's moveTeam has no source for this team's name and falls
        // back to "that team" -- which then gets published to the team's own
        // schedule and fanned out to the judge's card.
        repair: { type: "moveTeam", teamId, batch: slot.batch, room: slot.room, teamName },
      });
    } else {
      blocking.push({
        kind: "teamAppeared",
        message: `${teamName} submitted after this plan was built, but every room in every ` +
          "batch is already taken. Rebuild the plan to include them.",
        repair: { type: "rebuild" },
      });
    }
  }

  // ---- teams that withdrew their submission ----
  const withdrew = basis.teamIds.filter((id) => !liveTeamIds.has(id)).sort();
  for (const teamId of withdrew) {
    const teamName = plan.teamNames?.[teamId] ?? teamId;
    blocking.push({
      kind: "teamWithdrew",
      message: `${teamName} withdrew its submission since this plan was built.`,
      repair: { type: "dropTeam", teamId },
    });
  }

  // ---- judges who lost eligibility ----
  // A judge on a panel makes the plan wrong -- that card now points at
  // someone who will not show. A judge who was only a spare makes no card
  // wrong at all, so it is advisory.
  const lostJudges = basis.judgeIds.filter((id) => !liveJudgeIds.has(id));
  for (const judgeId of lostJudges) {
    const judgeName = plan.judgeNames?.[judgeId] ?? live.judgeNames?.[judgeId] ?? judgeId;
    const onPanels = Object.values(plan.assignments).filter((a) =>
      a.judges.some((j) => j.judgeId === judgeId)
    );

    if (onPanels.length > 0) {
      for (const assignment of onPanels) {
        blocking.push({
          kind: "judgeLost",
          message: `${judgeName} is no longer a first round judge, but is on the panel ` +
            `for ${assignment.teamName}.`,
          repair: { type: "removeJudge", teamId: assignment.id, judgeUid: judgeId },
        });
      }
    } else {
      advisory.push({
        kind: "judgeLost",
        message: `${judgeName} is no longer available, but was only a spare judge and is ` +
          "not on any panel.",
      });
    }
  }

  // ---- rooms the plan actually uses that are no longer configured ----
  // A missing room needs one team moved, not the plan rebuilt -- rebuilding
  // would discard every hand edit the organizer has made, which is exactly
  // what classifying drift exists to avoid. So each affected assignment gets
  // offered a free room in the SAME batch it is already in, keeping its time
  // and its panel intact. Only when that batch has no room left free does the
  // repair fall back to a rebuild.
  //
  // When two assignments in the SAME batch both lose their room, the second
  // one's search has to exclude whatever the first one was just given --
  // otherwise both "taken" sets are computed independently against the
  // plan's stale rooms and can agree on the identical replacement, hence
  // `claimedSlots` (shared with the "teams appeared" section above).
  const liveRoomsSet = new Set(live.rooms);
  const affectedByRoom = Object.values(plan.assignments)
    .filter((a) => !liveRoomsSet.has(a.room))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const assignment of affectedByRoom) {
    const takenInBatch = new Set(
      Object.values(plan.assignments)
        .filter((a) => a.batch === assignment.batch && a.id !== assignment.id)
        .map((a) => a.room)
    );
    const freeRoom = live.rooms.find(
      (r) => !takenInBatch.has(r) && !claimedSlots.has(slotKey(assignment.batch, r))
    );

    if (freeRoom) {
      claimedSlots.add(slotKey(assignment.batch, freeRoom));
      blocking.push({
        kind: "roomRemoved",
        message: `${assignment.room} is no longer a configured room, but ` +
          `${assignment.teamName} is using it in batch ${assignment.batch}.`,
        repair: {
          type: "moveTeam", teamId: assignment.id, batch: assignment.batch, room: freeRoom,
        },
      });
    } else {
      blocking.push({
        kind: "roomRemoved",
        message: `${assignment.room} is no longer a configured room, and batch ` +
          `${assignment.batch} has no free room to move ${assignment.teamName} into. ` +
          "Rebuild the plan.",
        repair: { type: "rebuild" },
      });
    }
  }

  // ---- the shape of the day changed ----
  if (basis.batchCount !== live.batchCount) {
    blocking.push({
      kind: "batchCountChanged",
      message: `Batch count changed from ${basis.batchCount} to ${live.batchCount} since ` +
        "this plan was built.",
      repair: { type: "rebuild" },
    });
  }
  if (basis.target !== live.target) {
    blocking.push({
      kind: "targetChanged",
      message: `Judges per team changed from ${basis.target} to ${live.target} since this ` +
        "plan was built.",
      repair: { type: "rebuild" },
    });
  }

  // ---- advisory: a label, not a fact the plan depends on ----
  if (!sameBatchTimes(basis.batchTimes, live.batchTimes)) {
    advisory.push({
      kind: "batchTimesChanged",
      message: "Batch times changed since this plan was built. The new times will be " +
        "applied to the draft.",
    });
  }

  // ---- advisory: a name changed, nothing about the plan itself did ----
  const staleJudgeIds = basis.judgeIds.filter((id) => liveJudgeIds.has(id));
  for (const judgeId of staleJudgeIds) {
    const before = plan.judgeNames?.[judgeId];
    const after = live.judgeNames?.[judgeId];
    if (before && after && before !== after) {
      advisory.push({ kind: "nameChanged", message: `${before} is now ${after}.` });
    }
  }
  const staleTeamIds = basis.teamIds.filter((id) => liveTeamIds.has(id));
  for (const teamId of staleTeamIds) {
    const before = plan.teamNames?.[teamId];
    const after = live.teamNames?.[teamId];
    if (before && after && before !== after) {
      advisory.push({ kind: "nameChanged", message: `${before} is now ${after}.` });
    }
  }

  return { blocking, advisory };
}

/**
 * Reads the database and shapes a `live` object comparable to a plan's
 * `basis` -- plus `judgeNames` and `teamNames`, so `checkDrift` can name
 * whoever moved.
 *
 * Every filter here has to match `planSchedule` exactly. If this read used a
 * different notion of "submitted" or "eligible", drift would fire on every
 * publish for a difference that was never real -- the two readers just
 * disagreeing about what counts.
 *
 * `allTeamIds`/`allJudgeIds` are the unfiltered id sets underneath `teamIds`/
 * `judgeIds` -- every team and judge node currently in the database, submitted
 * or not, eligible or not. A caller clearing stale data (a withdrawn team's
 * old slot, an ineligible judge's old `teamAssignments`) needs that wider set,
 * not the filtered one drift is checked against. Returning both here means a
 * caller needing the wider set is not forced into its own extra read of the
 * same two nodes.
 */
export async function readLiveBasis(onlyCheckedIn) {
  const [judgeSnapshot, teamSnapshot, rooms, batchConfig] = await Promise.all([
    get(ref(database, "judges")),
    get(ref(database, "teams")),
    fetchRooms(),
    fetchBatchConfig(),
  ]);

  // Deliberately diverges from planSchedule, which fails outright on a
  // missing snapshot: here an absent node reads as {}, which falls out of
  // the filters below as "every team withdrew" / "every judge left". Both
  // are blocking, so checkDrift refuses the publish rather than writing a
  // schedule built on it. A transient read failure therefore blocks a
  // publish instead of producing a wrong one -- the safe direction to fail
  // in. Do not "fix" this into a throw.
  const judgeData = judgeSnapshot.exists() ? judgeSnapshot.val() : {};
  const teamData = teamSnapshot.exists() ? teamSnapshot.val() : {};

  const roundOneJudges = Object.entries(judgeData)
    .filter(([, details]) => judgesRoundOne(details))
    .map(([id, details]) => ({ id, ...details }));

  const judgesList = onlyCheckedIn
    ? roundOneJudges.filter((judge) => judge.checkedIn === true)
    : roundOneJudges;

  const teamsList = Object.entries(teamData)
    .filter(([, details]) => details?.submitted)
    .map(([id, details]) => ({ id, ...details }));

  return {
    teamIds: teamsList.map((t) => t.id).sort(),
    judgeIds: judgesList.map((j) => j.id).sort(),
    allTeamIds: Object.keys(teamData).sort(),
    allJudgeIds: Object.keys(judgeData).sort(),
    rooms,
    batchCount: batchConfig.batchCount,
    batchTimes: batchConfig.batchTimes,
    target: batchConfig.target,
    judgeNames: Object.fromEntries(
      judgesList.map((j) => [j.id, displayName(j, "Unnamed Judge")])
    ),
    teamNames: Object.fromEntries(
      teamsList.map((t) => [t.id, t.name ?? "Unnamed Team"])
    ),
  };
}

export default checkDrift;

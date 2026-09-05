import { ref, get } from "firebase/database";
import { database } from "../../../firebase.js";
import { applyAdminAction, captureBefore } from "../adminAction.js";
import { guardWith } from "../snapshots.js";
import { FIRST_ROUND, FINAL_ROUND } from "../../judge/getTeamInfo.js";

/**
 * Break-glass tooling: the things you reach for when something has already
 * gone wrong.
 *
 * Everything destructive here takes a restore point first and refuses if one
 * cannot be written. That matters because the audit log cannot carry a bulk
 * before-state: past UNDO_SIZE_CAP it keeps counts only, so recoverability used
 * to depend on how big the event was.
 *
 * deleteScore returns the card as well as deleting it. The delete is undoable
 * from the activity feed; the returned values are for the other case, where the
 * card was wrong rather than the deletion, and a corrected one is re-entered
 * through the paper score dialog.
 */

/** Every path holding this team's room and time. Pure. */
export function overrideSlotChanges({ teamId, room, time, teamData, judgesData }) {
  const schedule = teamData?.schedule;
  if (!schedule) return [];

  const fields = [];
  if (room && room !== schedule.room) fields.push(["room", schedule.room, room]);
  if (time && time !== schedule.time) fields.push(["time", schedule.time, time]);
  if (!fields.length) return [];

  const changes = fields.map(([field, before, after]) => ({
    path: `teams/${teamId}/schedule/${field}`,
    before,
    after,
  }));

  for (const [judgeUid, judge] of Object.entries(judgesData ?? {})) {
    if (!judge?.teamAssignments?.[teamId]) continue;
    for (const [field, before, after] of fields) {
      changes.push({
        path: `judges/${judgeUid}/teamAssignments/${teamId}/${field}`,
        before,
        after,
      });
    }
  }

  return changes;
}

export async function overrideTeamSlot({ teamId, teamName, room, time }) {
  const [teamSnap, teamsSnap, judgesSnap] = await Promise.all([
    get(ref(database, `teams/${teamId}`)),
    get(ref(database, "teams")),
    get(ref(database, "judges")),
  ]);
  if (!teamSnap.exists()) return { ok: false, error: "That team no longer exists." };

  const teamData = teamSnap.val();
  const batch = teamData?.schedule?.batch;

  /*
   * Two teams cannot present in one room at one time.
   *
   * A move changes the room and the label, never the batch, so this is the only
   * thing it can break -- and it is the one check this path did not have. Both
   * other ways into a slot refuse it: the planner's moveTeam, and
   * scheduleTeamIntoBatch. This is the one an organizer uses during the event,
   * off a team's record, which makes it the worst of the three to leave open.
   *
   * Only when the room actually changes. Editing just the time on an event that
   * already has a clash somewhere should not be blocked by that clash.
   */
  if (room && batch && room !== teamData?.schedule?.room) {
    const clash = Object.entries(teamsSnap.val() ?? {}).find(
      ([id, other]) =>
        id !== teamId && other?.schedule?.batch === batch && other?.schedule?.room === room
    );
    if (clash) {
      return {
        ok: false,
        error: `${clash[1]?.name ?? "Another team"} is already in ${room} in batch ${batch}.`,
      };
    }
  }

  const changes = overrideSlotChanges({
    teamId, room, time,
    teamData,
    judgesData: judgesSnap.exists() ? judgesSnap.val() : {},
  });

  if (!changes.length) {
    return { ok: false, error: "Nothing changed. Generate a schedule first if there is none." };
  }

  return applyAdminAction({
    action: "team.slot",
    summary: `Moved ${teamName || teamId} to ${room} at ${time}`,
    changes,
  });
}

export async function deleteScore({ round, teamId, judgeUid, teamName, judgeName }) {
  if (round !== FIRST_ROUND && round !== FINAL_ROUND) {
    return { ok: false, error: `Unknown round "${round}".` };
  }

  const path = `scores/${round}/${teamId}/${judgeUid}`;
  const snap = await get(ref(database, path));
  if (!snap.exists()) return { ok: false, error: "That score is no longer there." };

  const card = snap.val();

  const result = await applyAdminAction({
    action: "score.delete",
    summary: `Deleted the ${round} round card for ${teamName || teamId} from ${judgeName || judgeUid}`,
    changes: [{ path, before: card, after: null }],
    // Undoable now. enteredBy used to be pinned to auth.uid for everyone, so
    // nobody but the original author could write a card back and this had to be
    // undoable:false, with re-entry through PaperScoreDialog stamping new
    // provenance. The pin now exempts admins, so an undo restores the card
    // exactly as the judge filed it. The dialog is still offered, because
    // re-entering from paper is a different thing from undoing a mistake.
    undoable: true,
  });

  return { ...result, card };
}

export async function setTeamSubmitted({ teamId, teamName, submitted }) {
  const before = await captureBefore([`teams/${teamId}/submitted`]);
  const was = before[`teams/${teamId}/submitted`] ?? false;

  if (Boolean(was) === Boolean(submitted)) {
    return { ok: false, error: `That team is already ${submitted ? "submitted" : "not submitted"}.` };
  }

  return applyAdminAction({
    action: "team.submitted",
    summary: `${submitted ? "Marked" : "Un-marked"} ${teamName || teamId} as submitted`,
    changes: [{ path: `teams/${teamId}/submitted`, before: was, after: Boolean(submitted) }],
  });
}

/**
 * Wipe every assignment, and optionally every score with them.
 *
 * By default scores are left alone. They are keyed by team and judge, so they
 * survive a regeneration and re-attach if the same pairing comes back -- the
 * same reason republishing a schedule warns about stranding rather than deleting.
 * Losing them because you wanted to redo the rooms would be a bad trade.
 *
 * `includeScores` is the deliberate, louder choice: a real start from scratch.
 * It clears the pre-migration locations too -- teams/{id}/scores and
 * teams/{id}/finalScores -- even though nothing reads them any more. A project
 * old enough to hold them would otherwise keep them through a wipe, and "start
 * from scratch" has to mean it. Each is only touched if it is actually there.
 *
 * Admins already hold the permission for this: the root rule reaches /scores,
 * and a delete skips .validate, so the card shape never gets to reject a null.
 * test/rules/scores.test.mjs pins both.
 */
export async function clearSchedule({ includeScores = false } = {}) {
  const [teamsSnap, judgesSnap] = await Promise.all([
    get(ref(database, "teams")),
    get(ref(database, "judges")),
  ]);

  const teamsData = teamsSnap.exists() ? teamsSnap.val() ?? {} : {};
  const judgesData = judgesSnap.exists() ? judgesSnap.val() ?? {} : {};

  const changes = [];
  for (const [teamId, team] of Object.entries(teamsData)) {
    if (team?.schedule) {
      changes.push({ path: `teams/${teamId}/schedule`, before: team.schedule, after: null });
    }
  }
  for (const [judgeUid, judge] of Object.entries(judgesData)) {
    if (judge?.teamAssignments) {
      changes.push({
        path: `judges/${judgeUid}/teamAssignments`,
        before: judge.teamAssignments,
        after: null,
      });
    }
  }

  const assignmentCount = changes.length;

  let scoreCount = 0;
  if (includeScores) {
    const scoresSnap = await get(ref(database, "scores"));
    if (scoresSnap.exists()) {
      changes.push({ path: "scores", before: scoresSnap.val(), after: null });
      scoreCount += 1;
    }

    // the pre-migration copies, which are still read
    for (const [teamId, team] of Object.entries(teamsData)) {
      for (const field of ["scores", "finalScores"]) {
        if (team?.[field]) {
          changes.push({ path: `teams/${teamId}/${field}`, before: team[field], after: null });
          scoreCount += 1;
        }
      }
    }
  }

  if (!changes.length) {
    return {
      ok: false,
      error: includeScores
        ? "There is no schedule and no scores to clear."
        : "There is no schedule to clear.",
    };
  }

  // Only worth clearing when there was a schedule; on a scores-only reset there
  // is no generation metadata to remove.
  if (assignmentCount) {
    const meta = await captureBefore(["config/scheduleMeta"]);
    changes.push({
      path: "config/scheduleMeta",
      before: meta["config/scheduleMeta"],
      after: null,
    });
  }

  const summary = includeScores
    ? `Cleared the schedule and every score: ${assignmentCount} assignment records, ${scoreCount} score locations`
    : `Cleared the schedule: ${assignmentCount} assignment records`;

  // A restore point BEFORE the wipe, and a refusal if it cannot be taken.
  //
  // The audit log alone was not enough here and the reason is worth stating:
  // applyAdminAction inlines the before-state, and drops it past
  // UNDO_SIZE_CAP. The payload for this action crosses that cap somewhere
  // around 25 teams, so clearing every score was undoable on a small test
  // event and permanent on a real one -- the safety net was present exactly
  // where it was not needed and absent where it was.
  const guard = await guardWith({
    label: summary,
    reason: includeScores
      ? "clearing every score cannot be undone from the activity feed"
      : "clearing the schedule replaces every assignment in the event",
    paths: includeScores
      ? ["teams", "judges", "scores", "config/scheduleMeta"]
      : ["teams", "judges", "config/scheduleMeta"],
  });
  if (!guard.ok) return { ok: false, error: guard.error };

  const result = await applyAdminAction({
    action: "schedule.clear",
    summary,
    changes,
    hasRestorePoint: true,
  });
  return { ...result, snapshotId: guard.snapshotId };
}

/**
 * Put one team into the final round by hand.
 *
 * Mirrors what activateFinalRound writes for a whole cohort: the private
 * standings entry, the team's own slot, and a copy for each final-round judge.
 * teams/{id}/finalSlot validates $other:false, so it carries room and timeslot
 * and nothing else.
 */
export async function forceIntoFinalRound({ teamId, teamName, room, timeslot, judgeUids = [] }) {
  if (!room || !timeslot) return { ok: false, error: "Give the team a room and a timeslot." };

  const teamsSnap = await get(ref(database, "teams"));
  const teamsData = teamsSnap.exists() ? teamsSnap.val() : {};

  /*
   * Two finalists cannot present in one room at one time.
   *
   * This writes finalSlot straight from TeamEditDrawer's free-text room and
   * timeslot fields with no check against any other finalist's seat -- the
   * same gap overrideTeamSlot had for the first round before 27182ff. Same
   * shape here: room and timeslot together are the seat, so a collision is
   * another team holding both at once.
   *
   * Only when the seat actually changes. A finalist re-saved with the slot it
   * already has -- to add a judge, say -- should not be blocked by a clash
   * that was already there before this call.
   */
  const existingSlot = teamsData?.[teamId]?.finalSlot;
  if (room !== existingSlot?.room || timeslot !== existingSlot?.timeslot) {
    const clash = Object.entries(teamsData ?? {}).find(
      ([id, other]) =>
        id !== teamId && other?.finalSlot?.room === room && other?.finalSlot?.timeslot === timeslot
    );
    if (clash) {
      return {
        ok: false,
        error: `${clash[1]?.name ?? "Another team"} is already in ${room} at ${timeslot}.`,
      };
    }
  }

  const paths = [
    `finalRound/teams/${teamId}`,
    `teams/${teamId}/finalSlot`,
    ...judgeUids.map((uid) => `judges/${uid}/finalAssignments/${teamId}`),
  ];
  const before = await captureBefore(paths);

  const changes = [
    {
      path: `finalRound/teams/${teamId}`,
      before: before[`finalRound/teams/${teamId}`],
      after: { teamId, name: teamName ?? "Unnamed team", addedByHand: true },
    },
    {
      path: `teams/${teamId}/finalSlot`,
      before: before[`teams/${teamId}/finalSlot`],
      after: { room, timeslot },
    },
    ...judgeUids.map((uid) => ({
      path: `judges/${uid}/finalAssignments/${teamId}`,
      before: before[`judges/${uid}/finalAssignments/${teamId}`],
      after: { teamId, teamName: teamName ?? "Unnamed team", room, timeslot },
    })),
  ];

  return applyAdminAction({
    action: "finalRound.force",
    summary: `Put ${teamName || teamId} into the final round in ${room} at ${timeslot}`,
    changes,
  });
}

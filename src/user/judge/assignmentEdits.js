import { ref, get, update, runTransaction } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { assignmentList } from "./assignmentList.js";

/**
 * Moving one judge, without regenerating the schedule.
 *
 * Regeneration is all or nothing: it rewrites every assignment in the event and
 * strands any score already collected, because scores are keyed by team and
 * judge and moving an assignment does not move them. That made the only
 * available response to a no-show — the single most likely thing to go wrong on
 * the day — worse than the problem.
 *
 * An assignment is stored twice on purpose, at `teams/{id}/schedule` and at
 * `judges/{uid}/teamAssignments/{id}`, so that a judge can read their own list
 * without read access to every team. Every function here therefore writes both
 * copies in ONE atomic multi-path update, the same way publishPlan does.
 * They cannot half-apply.
 *
 * The wrinkle is that each judge's copy carries the whole `judges` roster for
 * that team, so adding or removing one judge means rewriting the copy held by
 * every other judge on that team too. That fan-out is what these helpers exist
 * to get right.
 */

function displayName(person, fallback = "Unnamed Judge") {
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

async function loadContext(teamId, judgeUid) {
  const [scheduleSnap, judgesSnap] = await Promise.all([
    get(ref(database, `teams/${teamId}/schedule`)),
    get(ref(database, "judges")),
  ]);

  if (!scheduleSnap.exists()) {
    throw new Error("That team has no schedule entry. Generate the schedule first.");
  }

  const judges = judgesSnap.val() ?? {};
  if (judgeUid && !judges[judgeUid]) {
    throw new Error("That judge is not registered.");
  }

  return { schedule: scheduleSnap.val(), judges };
}

/**
 * Write the per-judge denormalised copies for a roster that has ALREADY been
 * committed to `teams/{teamId}/schedule` by `commitRoster` below. `assignment`
 * is that committed value (schedule spread with the new `judges`), so every
 * copy matches what actually landed rather than what this caller merely
 * intended to write.
 */
function fanOut(updates, teamId, assignment, roster, previousRoster) {
  for (const judge of roster) {
    updates[`judges/${judge.judgeId}/teamAssignments/${teamId}`] = assignment;
  }

  // anyone dropped from the roster loses their copy
  for (const judge of previousRoster) {
    if (!roster.some((kept) => kept.judgeId === judge.judgeId)) {
      updates[`judges/${judge.judgeId}/teamAssignments/${teamId}`] = null;
    }
  }
}

function rosterOf(schedule) {
  const raw = schedule?.judges;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.filter((entry) => entry && entry.judgeId);
}

/**
 * Does this judge's copy disagree with the roster of record?
 *
 * Compared field by field rather than as whole objects on purpose. A copy
 * written by publishPlan and one built here hold the same values in a
 * different key order, and `JSON.stringify` would call that a difference --
 * which would rewrite every copy on every no-op edit forever.
 */
function copyIsStale(copy, assignment) {
  if (!copy) return true;
  if (JSON.stringify(rosterOf(copy)) !== JSON.stringify(rosterOf(assignment))) return true;
  return ["teamName", "id", "room", "time", "batch"].some((key) => copy[key] !== assignment[key]);
}

/**
 * Bring every judge's copy back into line with the roster of record.
 *
 * The roster commits through a transaction and the copies are written after
 * it, so a failure between the two leaves a judge holding a panel that no
 * longer exists -- or holding none at all. Nothing repairs that on its own,
 * and the organizer's natural response is to make the same edit again.
 *
 * That is what this is for. Both edits below return early the moment the
 * roster already says what was asked for, and they used to return without
 * writing anything, so repeating the edit fixed nothing. Now the early return
 * reconciles first: it is the same fan-out, restricted to the copies that are
 * actually wrong, so a no-op edit stays a no-op when everything agrees.
 *
 * `judges` is the snapshot loadContext already read, so this costs no
 * additional round trip.
 */
async function repairFanOut({ teamId, schedule, roster, judges }) {
  const assignment = { ...schedule, judges: roster };
  const updates = {};

  for (const judgeId of Object.keys(judges ?? {})) {
    const copy = judges[judgeId]?.teamAssignments?.[teamId];
    const onRoster = roster.some((entry) => entry.judgeId === judgeId);

    if (!onRoster) {
      // a judge off the roster still holding a copy is the mirror failure:
      // they turn up to a team that is no longer theirs
      if (copy) updates[`judges/${judgeId}/teamAssignments/${teamId}`] = null;
    } else if (copyIsStale(copy, assignment)) {
      updates[`judges/${judgeId}/teamAssignments/${teamId}`] = assignment;
    }
  }

  if (!Object.keys(updates).length) return false;
  await update(ref(database), updates);
  return true;
}

/**
 * Commit a recomputed roster for one team, refusing a write built on a roster
 * that has since moved.
 *
 * `assignJudgeToTeam`, `unassignJudgeFromTeam` and `swapJudges` all read the
 * roster once (in `loadContext`), decide the new roster from that snapshot,
 * and used to write it straight back with a plain `update()` -- no version, no
 * recheck. Two organizers racing the same no-show scramble both read the same
 * [Y, Z], one computes [Z, X] and the other computes [Y], and whichever
 * `update()` lands second silently threw the first one away. BOTH calls
 * returned `{ ok: true }`, so neither organizer had any reason to look again.
 *
 * The fix is the same compare-and-set shape draftStore.js uses for the
 * schedule preview: `runTransaction` re-reads the roster atomically at write
 * time and aborts if it no longer matches what this caller read. Unlike
 * draftStore there is no stored `version` field on a team's schedule, so the
 * roster itself (structurally compared) is the token being raced over -- it
 * plays the same role a version number would. Exactly one writer commits; the
 * other gets `{ ok: false }` and a message telling it to reload, instead of a
 * silent loss.
 *
 * This closes the race for the roster of record at `teams/{teamId}/schedule`.
 * It does NOT close two smaller ones, and both would need more than this file
 * to close in full:
 *
 *   - The per-judge `teamAssignments` copies below are written by a SEPARATE
 *     `update()` after the transaction commits, because RTDB's client
 *     transaction API only ever guards one location, not the several
 *     top-level paths this fan-out touches. A crash in the gap between the
 *     transaction committing and that update landing would leave a judge's
 *     copy stale until the next write touches this team. That gap did not
 *     exist before (the old code's one `update()` was atomic across every
 *     path it touched) -- it is the one thing this fix trades away to close
 *     the much larger, much more likely race described above. Closing it too
 *     would need either a server-side function that owns both writes, or
 *     restructuring so a judge's assignment is read through the team's
 *     record rather than duplicated onto their own.
 *   - `findConflict`'s "is this judge already booked elsewhere in this batch"
 *     check reads a different judge's `teamAssignments` node, before this
 *     transaction runs, and is not re-checked atomically with the commit.
 *     Two organizers could still double-book a judge if both pass that check
 *     in the same window. This function only narrows that window; it does not
 *     close it.
 */
async function commitRoster({ teamId, previous, roster }) {
  const result = await runTransaction(
    ref(database, `teams/${teamId}/schedule`),
    (current) => {
      // abort by returning nothing: the roster moved between the read this
      // caller acted on and this write, so the caller's decision is stale
      if (JSON.stringify(rosterOf(current)) !== JSON.stringify(previous)) return undefined;
      return { ...current, judges: roster };
    },
    { applyLocally: false }
  );

  if (!result.committed) {
    const stillThere = result.snapshot?.exists();
    return {
      ok: false,
      error: stillThere
        ? "Another organizer already changed this team's judges. Reload and try again."
        : "That team's schedule entry was removed while you were choosing. Reload and try again.",
    };
  }

  const updates = {};
  fanOut(updates, teamId, result.snapshot.val(), roster, previous);
  await update(ref(database), updates);

  return { ok: true, roster };
}

/**
 * Is this judge already booked elsewhere at the same time?
 *
 * A judge sent to two rooms in one batch simply does not turn up to one of
 * them, and nothing would have reported it.
 */
export async function findConflict(judgeUid, teamId, batch) {
  const snap = await get(ref(database, `judges/${judgeUid}/teamAssignments`));
  if (!snap.exists()) return null;

  return (
    assignmentList(snap.val()).find(
      (existing) => existing.batch === batch && existing.id !== teamId
    ) ?? null
  );
}

/**
 * What a team could be slotted into, for a team that has no schedule entry.
 *
 * A team that submits after the schedule was generated has nowhere to go: the
 * slot override edits an existing entry and returns nothing when there is none,
 * so the only remaining move was a full regenerate -- which rewrites every
 * assignment in the event and strands every score collected so far. That is the
 * same bad trade the rest of this file exists to avoid for a no-show judge.
 *
 * Returns, per batch, the time it presents and which configured rooms are still
 * free in it.
 */
export async function findOpenSlots() {
  const [teamsSnap, roomsSnap] = await Promise.all([
    get(ref(database, "teams")),
    get(ref(database, "config/judgingRooms")),
  ]);

  const rawRooms = roomsSnap.exists() ? roomsSnap.val() : [];
  const rooms = (Array.isArray(rawRooms) ? rawRooms : Object.values(rawRooms ?? {}))
    .filter((room) => typeof room === "string" && room.trim().length > 0);

  const byBatch = new Map();
  for (const team of Object.values(teamsSnap.val() ?? {})) {
    const schedule = team?.schedule;
    if (!schedule?.batch) continue;
    if (!byBatch.has(schedule.batch)) {
      byBatch.set(schedule.batch, { batch: schedule.batch, time: schedule.time, taken: new Set() });
    }
    byBatch.get(schedule.batch).taken.add(schedule.room);
  }

  return [...byBatch.values()]
    .sort((a, b) => a.batch - b.batch)
    .map(({ batch, time, taken }) => ({
      batch,
      time,
      freeRooms: rooms.filter((room) => !taken.has(room)),
    }));
}

/**
 * Give a team its own schedule entry without regenerating anything.
 *
 * Writes the team's entry and each chosen judge's copy in ONE update, the same
 * shape publishPlan produces, so nothing downstream can tell the
 * difference between a team scheduled here and one scheduled by a generation.
 */
export async function scheduleTeamIntoBatch({
  teamId,
  batch,
  room,
  time,
  judgeUids = [],
  allowConflict = false,
}) {
  await requireAdmin("schedule a team");

  if (!room || !batch) return { ok: false, error: "Pick a batch and a room." };
  if (!judgeUids.length) {
    return { ok: false, error: "Pick at least one judge, or the team presents to an empty room." };
  }

  const [teamSnap, teamsSnap, judgesSnap] = await Promise.all([
    get(ref(database, `teams/${teamId}`)),
    get(ref(database, "teams")),
    get(ref(database, "judges")),
  ]);

  if (!teamSnap.exists()) return { ok: false, error: "That team no longer exists." };
  const team = teamSnap.val();
  if (team.schedule) {
    return {
      ok: false,
      error: "That team is already scheduled. Use the slot override to move it instead.",
    };
  }

  // the room has to be free at that time, or two teams present to one room
  const clash = Object.entries(teamsSnap.val() ?? {}).find(
    ([id, other]) =>
      id !== teamId && other?.schedule?.batch === batch && other?.schedule?.room === room
  );
  if (clash) {
    return {
      ok: false,
      error: `${clash[1].name ?? "Another team"} is already in ${room} in batch ${batch}.`,
    };
  }

  const judges = judgesSnap.val() ?? {};
  const missing = judgeUids.filter((uid) => !judges[uid]);
  if (missing.length) return { ok: false, error: "One of those judges is not registered." };

  if (!allowConflict) {
    for (const uid of judgeUids) {
      const existing = assignmentList(judges[uid]?.teamAssignments).find(
        (assignment) => assignment.batch === batch && assignment.id !== teamId
      );
      if (existing) {
        return {
          ok: false,
          conflict: existing,
          error:
            `${displayName(judges[uid])} is already in ${existing.room} at ${existing.time} ` +
            `for ${existing.teamName} in batch ${batch}.`,
        };
      }
    }
  }

  const assignment = {
    teamName: team.name ?? "Unnamed Team",
    id: teamId,
    room,
    time: time ?? "TBD",
    batch,
    judges: judgeUids.map((uid) => ({ judgeId: uid, judgeName: displayName(judges[uid]) })),
  };

  const updates = { [`teams/${teamId}/schedule`]: assignment };
  for (const uid of judgeUids) {
    updates[`judges/${uid}/teamAssignments/${teamId}`] = assignment;
  }

  await update(ref(database), updates);
  return { ok: true, assignment };
}

export async function assignJudgeToTeam({ judgeUid, teamId, allowConflict = false }) {
  await requireAdmin("change judging assignments");
  const { schedule, judges } = await loadContext(teamId, judgeUid);

  const previous = rosterOf(schedule);
  if (previous.some((entry) => entry.judgeId === judgeUid)) {
    const repaired = await repairFanOut({ teamId, schedule, roster: previous, judges });
    return { ok: true, unchanged: true, repaired, roster: previous };
  }

  if (!allowConflict) {
    const clash = await findConflict(judgeUid, teamId, schedule.batch);
    if (clash) {
      return {
        ok: false,
        conflict: clash,
        error: `That judge is already in ${clash.room} at ${clash.time} for ${clash.teamName}.`,
      };
    }
  }

  const roster = [
    ...previous,
    { judgeId: judgeUid, judgeName: displayName(judges[judgeUid]) },
  ];

  return commitRoster({ teamId, previous, roster });
}

export async function unassignJudgeFromTeam({ judgeUid, teamId }) {
  await requireAdmin("change judging assignments");
  const { schedule, judges } = await loadContext(teamId, null);

  const previous = rosterOf(schedule);
  const roster = previous.filter((entry) => entry.judgeId !== judgeUid);

  if (roster.length === previous.length) {
    const repaired = await repairFanOut({ teamId, schedule, roster, judges });
    return { ok: true, unchanged: true, repaired, roster };
  }
  if (!roster.length) {
    return {
      ok: false,
      error:
        "That is the only judge assigned to this team. Assign a replacement first, " +
        "or the team presents to an empty room.",
    };
  }

  return commitRoster({ teamId, previous, roster });
}

/** Replace one judge with another on the same team, in a single update. */
export async function swapJudges({ teamId, fromJudgeUid, toJudgeUid, allowConflict = false }) {
  await requireAdmin("change judging assignments");
  const { schedule, judges } = await loadContext(teamId, toJudgeUid);

  const previous = rosterOf(schedule);
  if (!previous.some((entry) => entry.judgeId === fromJudgeUid)) {
    return { ok: false, error: "That judge is not assigned to this team." };
  }
  if (previous.some((entry) => entry.judgeId === toJudgeUid)) {
    return { ok: false, error: "The replacement is already assigned to this team." };
  }

  if (!allowConflict) {
    const clash = await findConflict(toJudgeUid, teamId, schedule.batch);
    if (clash) {
      return {
        ok: false,
        conflict: clash,
        error: `The replacement is already in ${clash.room} at ${clash.time} for ${clash.teamName}.`,
      };
    }
  }

  const roster = previous
    .filter((entry) => entry.judgeId !== fromJudgeUid)
    .concat({ judgeId: toJudgeUid, judgeName: displayName(judges[toJudgeUid]) });

  return commitRoster({ teamId, previous, roster });
}

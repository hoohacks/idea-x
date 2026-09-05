import { ref, get } from "firebase/database";
import { database } from "../../../firebase.js";
import { applyAdminAction } from "../adminAction.js";

/**
 * The judging room list, and what happens to a schedule when it changes.
 *
 * config/judgingRooms feeds the NEXT generation. A schedule already written
 * holds the room name copied into teams/{id}/schedule and into every assigned
 * judge's own teamAssignments -- the same denormalisation assignmentEdits.js
 * works around, and for the same reason: a judge cannot read every team.
 *
 * So removing a room in use is not a list edit. It is a fan-out, and it must be
 * atomic or a team walks to one room while its judges walk to another.
 *
 * There is no built-in room list anywhere in the code. Rooms are venue facts,
 * added and removed here and stored only at config/judgingRooms.
 */

/** Which teams are scheduled in which room. Pure; takes a /teams snapshot. */
export function roomsInUse(teamsData) {
  const byRoom = {};
  for (const [teamId, team] of Object.entries(teamsData ?? {})) {
    const schedule = team?.schedule;
    if (!schedule?.room) continue;
    (byRoom[schedule.room] ??= []).push({
      teamId,
      teamName: schedule.teamName ?? team?.name ?? "Unnamed team",
      time: schedule.time,
      batch: schedule.batch,
    });
  }
  return byRoom;
}

/**
 * Which teams would end up sharing a room if everyone in `from` moved to `to`.
 * Pure.
 *
 * Emptying a room asks the organizer where its teams should go, and then took
 * the answer at face value. Two rooms both busy in batch 1 merge into one room
 * with two teams in it at five o'clock -- the single thing a judging schedule
 * exists to prevent, produced by the tool for fixing a room problem.
 *
 * Batch, not time: the batch is what the schedule is actually keyed on, and a
 * time is a label an organizer can retype.
 */
export function moveCollisions({ from, to, teamsData }) {
  const byRoom = roomsInUse(teamsData);
  const moving = byRoom[from] ?? [];
  const sitting = byRoom[to] ?? [];

  return moving
    .map((team) => ({ team, blockedBy: sitting.find((other) => other.batch === team.batch) }))
    .filter((pair) => pair.blockedBy);
}

/**
 * Which teams are seated in which room for the FINAL round. Pure.
 *
 * Kept separate from roomsInUse rather than folded into it. A final slot has
 * no batch -- the final round runs once, not in waves -- so a shared shape
 * would leave moveCollisions comparing `undefined === undefined` for every
 * pair of final entries and calling that a match, or every pair NOT a
 * collision if batch stayed required. Two counts, two collision checks, one
 * kept the first round's existing batch semantics untouched.
 */
export function finalRoomsInUse(teamsData) {
  const byRoom = {};
  for (const [teamId, team] of Object.entries(teamsData ?? {})) {
    const finalSlot = team?.finalSlot;
    if (!finalSlot?.room) continue;
    (byRoom[finalSlot.room] ??= []).push({
      teamId,
      teamName: team?.name ?? "Unnamed team",
      timeslot: finalSlot.timeslot,
    });
  }
  return byRoom;
}

/**
 * The final-round twin of moveCollisions: which finalists would end up
 * sharing a room if everyone in `from` moved to `to`. Timeslot stands in for
 * batch -- it is what a final-round seat is actually keyed on. Pure.
 */
export function finalMoveCollisions({ from, to, teamsData }) {
  const byRoom = finalRoomsInUse(teamsData);
  const moving = byRoom[from] ?? [];
  const sitting = byRoom[to] ?? [];

  return moving
    .map((team) => ({ team, blockedBy: sitting.find((other) => other.timeslot === team.timeslot) }))
    .filter((pair) => pair.blockedBy);
}

/**
 * Every path that has to move when a room is renamed or vacated. Pure, so the
 * fan-out is testable without a database.
 */
export function remapChanges({ from, to, teamsData, judgesData, finalRoundTeams }) {
  // Two different sets. A room can be used by a first-round batch, by the final
  // round, or by both -- and a team in the final is rarely the same team that
  // was in that room during the first round.
  const scheduledIn = new Set(
    Object.entries(teamsData ?? {})
      .filter(([, team]) => team?.schedule?.room === from)
      .map(([teamId]) => teamId)
  );
  const finalIn = new Set(
    Object.entries(teamsData ?? {})
      .filter(([, team]) => team?.finalSlot?.room === from)
      .map(([teamId]) => teamId)
  );

  const changes = [];

  for (const teamId of scheduledIn) {
    changes.push({ path: `teams/${teamId}/schedule/room`, before: from, after: to });
  }

  // The final round keeps its own copies, on nodes the first round never
  // touches. Missing them left every finalist and every final-round judge
  // pointed at a room name that no longer existed.
  for (const teamId of finalIn) {
    changes.push({ path: `teams/${teamId}/finalSlot/room`, before: from, after: to });
    if (finalRoundTeams?.[teamId]) {
      changes.push({ path: `finalRound/teams/${teamId}/room`, before: from, after: to });
    }
  }

  for (const [judgeUid, judge] of Object.entries(judgesData ?? {})) {
    for (const teamId of Object.keys(judge?.teamAssignments ?? {})) {
      // a judge can hold an assignment for a team that no longer exists; the
      // team snapshot is the authority on what is really scheduled
      if (!scheduledIn.has(teamId)) continue;
      changes.push({
        path: `judges/${judgeUid}/teamAssignments/${teamId}/room`,
        before: from,
        after: to,
      });
    }

    for (const teamId of Object.keys(judge?.finalAssignments ?? {})) {
      if (!finalIn.has(teamId)) continue;
      changes.push({
        path: `judges/${judgeUid}/finalAssignments/${teamId}/room`,
        before: from,
        after: to,
      });
    }
  }

  return changes;
}

/**
 * The configured rooms, or an empty list. There is no built-in fallback: rooms
 * are added and removed here, so a list that appeared from nowhere would make
 * a removal look like it had failed.
 */
export async function listRooms() {
  const snap = await get(ref(database, "config/judgingRooms"));
  if (!snap.exists()) return [];
  const value = snap.val();
  return (Array.isArray(value) ? value : Object.values(value))
    .filter((room) => typeof room === "string" && room.trim().length > 0);
}

async function loadWorld() {
  const [rooms, teamsSnap, judgesSnap, finalSnap] = await Promise.all([
    listRooms(),
    get(ref(database, "teams")),
    get(ref(database, "judges")),
    get(ref(database, "finalRound/teams")),
  ]);
  return {
    rooms,
    teamsData: teamsSnap.exists() ? teamsSnap.val() : {},
    judgesData: judgesSnap.exists() ? judgesSnap.val() : {},
    finalRoundTeams: finalSnap.exists() ? finalSnap.val() : {},
  };
}

export async function addRoom(name) {
  const room = String(name ?? "").trim();
  if (!room) return { ok: false, error: "Give the room a name." };

  const rooms = await listRooms();
  if (rooms.includes(room)) return { ok: false, error: `${room} is already on the list.` };

  return applyAdminAction({
    action: "room.add",
    summary: `Added ${room}`,
    changes: [{ path: "config/judgingRooms", before: rooms, after: [...rooms, room] }],
  });
}

export async function renameRoom(from, to) {
  const next = String(to ?? "").trim();
  if (!next) return { ok: false, error: "Give the room a name." };

  const { rooms, teamsData, judgesData, finalRoundTeams } = await loadWorld();
  if (!rooms.includes(from)) return { ok: false, error: `${from} is not on the list.` };
  if (rooms.includes(next)) return { ok: false, error: `${next} is already on the list.` };

  const scheduled = remapChanges({ from, to: next, teamsData, judgesData, finalRoundTeams });

  return applyAdminAction({
    action: "room.rename",
    summary: scheduled.length
      ? `Renamed ${from} to ${next}, moving ${scheduled.length} scheduled entries`
      : `Renamed ${from} to ${next}`,
    changes: [
      { path: "config/judgingRooms", before: rooms, after: rooms.map((r) => (r === from ? next : r)) },
      ...scheduled,
    ],
  });
}

/**
 * Removing a room. If a schedule is using it, the caller must say where those
 * teams go -- refusing is better than leaving a team pointed at a room that is
 * no longer on the list.
 */
export async function removeRoom(name, { moveTo } = {}) {
  const { rooms, teamsData, judgesData, finalRoundTeams } = await loadWorld();
  if (!rooms.includes(name)) return { ok: false, error: `${name} is not on the list.` };

  const inUse = roomsInUse(teamsData)[name] ?? [];
  const finalInUse = finalRoomsInUse(teamsData)[name] ?? [];
  const totalInUse = inUse.length + finalInUse.length;

  // A room the final round is using alone had nothing in `inUse` -- roomsInUse
  // only looks at team.schedule -- so this gate used to pass silently and the
  // remap below never ran, leaving every finalist's finalSlot, finalRound/teams
  // entry, and judges' finalAssignments pointed at a room no longer on the list.
  if (totalInUse && !moveTo) {
    return {
      ok: false,
      inUse,
      finalInUse,
      error: `${totalInUse} team(s) are scheduled in ${name}. Choose where they should go.`,
    };
  }
  if (moveTo && !rooms.includes(moveTo)) {
    return { ok: false, error: `${moveTo} is not on the list.` };
  }
  if (moveTo === name) {
    return { ok: false, error: "Choose a different room to move them to." };
  }

  const collisions = moveTo ? moveCollisions({ from: name, to: moveTo, teamsData }) : [];
  if (collisions.length) {
    const [first] = collisions;
    return {
      ok: false,
      collisions,
      error:
        `${moveTo} is not free: ${first.blockedBy.teamName} is already there in batch ` +
        `${first.team.batch}` +
        (collisions.length > 1 ? `, and ${collisions.length - 1} more would clash` : "") +
        `. Pick a room that is empty when these teams present.`,
    };
  }

  const finalCollisions = moveTo ? finalMoveCollisions({ from: name, to: moveTo, teamsData }) : [];
  if (finalCollisions.length) {
    const [first] = finalCollisions;
    return {
      ok: false,
      collisions: finalCollisions,
      error:
        `${moveTo} is not free for the final round: ${first.blockedBy.teamName} is already there at ` +
        `${first.team.timeslot}` +
        (finalCollisions.length > 1 ? `, and ${finalCollisions.length - 1} more would clash` : "") +
        `. Pick a room that is empty at that time.`,
    };
  }

  // Either round in use is enough to require the fan-out: remapChanges itself
  // decides what actually needs to move.
  const moved = totalInUse
    ? remapChanges({ from: name, to: moveTo, teamsData, judgesData, finalRoundTeams })
    : [];

  return applyAdminAction({
    action: "room.remove",
    summary: moved.length
      ? `Removed ${name}, moving ${totalInUse} team(s) to ${moveTo}`
      : `Removed ${name}`,
    changes: [
      { path: "config/judgingRooms", before: rooms, after: rooms.filter((r) => r !== name) },
      ...moved,
    ],
  });
}

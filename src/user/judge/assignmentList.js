/**
 * A judge's `teamAssignments` is stored as `{ teamId: assignment }`, not an
 * array. Realtime Database gives arrays numeric keys, which are fragile under
 * deletion and cannot be addressed by a security rule — the same shape problem
 * that made the member checks in the rules silently false.
 *
 * Object key order is not meaningful, so the batch number restores the order a
 * judge actually walks the rooms in. Schedules written before the change held
 * an array; both shapes are read here.
 */
export function assignmentList(raw) {
  if (!raw) return [];

  const values = Array.isArray(raw) ? raw : Object.values(raw);

  return values
    .filter((entry) => entry && typeof entry === "object")
    .sort((a, b) => (a.batch ?? 0) - (b.batch ?? 0));
}

/**
 * The judges on a team's schedule card, in either shape.
 *
 * The same array-or-keyed problem `assignmentList` solves, seen from the team's
 * side: `schedule.judges` is a keyed set on anything the current scheduler
 * wrote and an array on anything older. Entries without a `judgeId` are dropped
 * -- a roster slot that names nobody is not a judge anyone can chase.
 *
 * This lived as a private copy in four modules, which is three too many for a
 * function whose whole job is knowing what shape the data is in.
 */
export function rosterOf(schedule) {
  const raw = schedule?.judges;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.filter((entry) => entry && entry.judgeId);
}

export default assignmentList;

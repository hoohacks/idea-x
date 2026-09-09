// getPersonalSchedule.js
import { ref, get, onValue } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../firebase.js";
import { assignmentList } from "./assignmentList.js";

function requireUser() {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Must be signed in to read personal schedule");
  return user;
}

export async function getPersonalSchedule() {
  const user = requireUser();

  const snap = await get(ref(database, `judges/${user.uid}`));
  if (!snap.exists()) return [];

  return assignmentList(snap.val().teamAssignments);
}

/**
 * The live version of `getPersonalSchedule`.
 *
 * A one-shot `get` was read once when the page mounted and never again, so a
 * judge who left the judging page open all day never saw a room fix, a
 * reassignment, or a republished schedule -- their card just went stale next
 * to them while it happened. Subscribing to the judge's own assignment node
 * means an organizer's edit reaches an open tab the same way `.info/connected`
 * already does, without the judge having to reload.
 *
 * Returns the unsubscribe function directly, the same shape `onValue` itself
 * returns, so the caller's effect cleanup is a one-liner.
 */
export function subscribeToPersonalSchedule(onTeams, onError) {
  const user = requireUser();
  return onValue(
    ref(database, `judges/${user.uid}/teamAssignments`),
    (snap) => onTeams(assignmentList(snap.exists() ? snap.val() : null)),
    (error) => {
      if (onError) onError(error);
    }
  );
}

/**
 * The judge's own final-round list.
 *
 * Read from their own judge record rather than derived from /finalRound, which
 * is no longer readable by a judge — the standings carry every team's average
 * score, and handing those to anyone before the announcement is the leak this
 * denormalisation closes. Exclusions are applied at activation, so whatever is
 * here is exactly what this judge should see.
 */
export async function getFinalRoundSchedule() {
  const user = requireUser();

  const snap = await get(ref(database, `judges/${user.uid}/finalAssignments`));
  if (!snap.exists()) return [];

  // final assignments have no batch, so assignmentList's sort is a no-op here;
  // it is still the one place that copes with the legacy array shape
  return assignmentList(snap.val()).map((entry) => ({
    ...entry,
    id: entry.teamId ?? entry.id,
    time: entry.timeslot ?? entry.time,
  }));
}

function toFinalRoundList(raw) {
  return assignmentList(raw).map((entry) => ({
    ...entry,
    id: entry.teamId ?? entry.id,
    time: entry.timeslot ?? entry.time,
  }));
}

/**
 * The live version of `getFinalRoundSchedule`.
 *
 * The one-shot read behind `getFinalRoundSchedule` was only ever re-run when
 * `finalRound/active` flipped, which meant a final round that was published,
 * then corrected -- a room swap, a panel fix, a republish -- while it stayed
 * active the whole time never reached a judge who already had the page open.
 * Subscribing to the judge's own `finalAssignments` node picks up that edit
 * the moment it is written, the same as `subscribeToPersonalSchedule` does for
 * the first round.
 */
export function subscribeToFinalRoundSchedule(onTeams, onError) {
  const user = requireUser();
  return onValue(
    ref(database, `judges/${user.uid}/finalAssignments`),
    (snap) => onTeams(toFinalRoundList(snap.exists() ? snap.val() : null)),
    (error) => {
      if (onError) onError(error);
    }
  );
}

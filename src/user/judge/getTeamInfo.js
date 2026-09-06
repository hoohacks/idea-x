import { ref, get, set, query, orderByChild, equalTo, serverTimestamp } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../firebase.js";
import { enqueue, flushPending, withTimeout } from "./pendingScores.js";

export const FIRST_ROUND = "first";
export const FINAL_ROUND = "final";

function requireUser() {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Must be signed in");
  return user;
}

function scorePath(round, teamId, judgeUid) {
  return `scores/${round}/${teamId}/${judgeUid}`;
}

// Legacy fallback only. Team names are not unique, so two teams sharing a name
// would send one team's scores to the other. Always prefer the team id carried
// on the assignment.
export async function findTeamIdByName(teamName) {
  let snap;
  try {
    const q = query(ref(database, "teams"), orderByChild("name"), equalTo(teamName));
    snap = await get(q);
  } catch (error) {
    console.warn("Team name lookup is not permitted for this account:", error);
    return null;
  }
  if (!snap.exists()) return null;

  const matches = Object.keys(snap.val());
  if (matches.length > 1) {
    console.warn(`Multiple teams are named "${teamName}"; falling back to the first match.`);
  }
  return matches[0];
}

function buildPayload({ score, judgeUid, teamId, teamName, enteredBy, source }) {
  return {
    ...score,
    judgeUid,
    teamId,
    teamName,
    // who actually pressed the button. Equal to judgeUid for a judge's own
    // submission, the admin's uid when it was keyed in from paper. The rules
    // pin this one to auth.uid, so it is the field that cannot be forged.
    enteredBy,
    source,
    submittedAt: serverTimestamp(),
  };
}

/** The bare write, with no queueing. Used directly by the outbox flush. */
async function writeScore({ round, teamId, teamName, judgeUid, score }) {
  if (!teamId) throw new Error(`No team id for "${teamName}"`);
  await set(
    ref(database, scorePath(round, teamId, judgeUid)),
    buildPayload({ score, judgeUid, teamId, teamName, enteredBy: judgeUid, source: "judge" })
  );
}

/**
 * Submit a judge's own card.
 *
 * Returns `{ status: "saved" }` when the database acknowledged it, or
 * `{ status: "queued" }` when it did not and the card was written to the
 * device instead. Only throws when there is nowhere left to put it — which
 * means the browser refused storage as well, and the judge genuinely has to
 * write it on paper.
 */
export async function submitScore({ round, teamId, teamName, score }) {
  const user = requireUser();
  const entry = { round, teamId, teamName, judgeUid: user.uid, score };

  try {
    await withTimeout(writeScore(entry));
    return { status: "saved" };
  } catch (error) {
    if (!enqueue(entry)) {
      throw new Error(
        "Could not reach the database, and this device will not let the score be " +
          "saved locally either. Write the scores down and give them to an organizer."
      );
    }
    return { status: "queued", reason: error?.message ?? String(error) };
  }
}

/**
 * Send anything sitting in the outbox. Safe to call repeatedly — on load, on
 * reconnect, or from a retry button.
 */
export function syncPendingScores(judgeUid) {
  return flushPending((entry) => withTimeout(writeScore(entry)), { judgeUid });
}

/**
 * File a card on a judge's behalf, from paper or from a judge whose device
 * died. Admin only — enforced by the root rule, not here.
 *
 * This is the write the old rules made impossible: they pinned `judgeUid` to
 * auth.uid, so the root rule permitted an admin to write and validation then
 * rejected it with a bare PERMISSION_DENIED.
 */
export async function writeScoreOnBehalf({ round, teamId, teamName, judgeUid, score }) {
  const admin = requireUser();
  if (!teamId) throw new Error(`No team id for "${teamName}"`);
  if (!judgeUid) throw new Error("A judge must be chosen for the score");

  await set(
    ref(database, scorePath(round, teamId, judgeUid)),
    buildPayload({ score, judgeUid, teamId, teamName, enteredBy: admin.uid, source: "paper" })
  );
}

/** The card this judge already filed for one team, or null. */
export async function getMyScore({ round, teamId }) {
  const user = requireUser();
  const snap = await get(ref(database, scorePath(round, teamId, user.uid)));
  return snap.exists() ? snap.val() : null;
}

async function scoredTeamIds(teamIds, round) {
  const user = requireUser();
  const ids = [...new Set((teamIds ?? []).filter(Boolean))];
  if (!ids.length) return new Set();

  const results = await Promise.all(
    ids.map(async (id) => {
      // One rejection used to reject the whole Promise.all and drop the entire
      // scored set, which showed every card as unscored and invited a judge to
      // submit twice. A per-team failure now costs only that team.
      try {
        const snap = await get(ref(database, scorePath(round, id, user.uid)));
        return [id, snap.exists()];
      } catch (error) {
        console.warn(`Could not check whether ${id} is already scored:`, error);
        return [id, false];
      }
    })
  );

  return new Set(results.filter(([, scored]) => scored).map(([id]) => id));
}

export function getMyScoredTeamIds(teamIds) {
  return scoredTeamIds(teamIds, FIRST_ROUND);
}

export function getMyFinalRoundScoredTeamIds(teamIds) {
  return scoredTeamIds(teamIds, FINAL_ROUND);
}

/**
 * The idea, problem statement and pitch deck for a team this judge is assigned
 * to. Judges could not read any of this before — they got a card with a room
 * and a time on it and were expected to have found the deck some other way.
 *
 * The rules grant read on `submission` alone, so this cannot be widened into a
 * way to read the team itself, its members or its scores.
 */
export async function getTeamSubmission(teamId) {
  if (!teamId) return null;
  const snap = await get(ref(database, `teams/${teamId}/submission`));
  return snap.exists() ? snap.val() : null;
}

import { ref, get, update, onValue, runTransaction, serverTimestamp } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { resolveName } from "../admin/adminAction.js";

/**
 * Persistence for a schedule preview an organizer is still hand-editing.
 *
 * Building a schedule and then reworking room and judge assignments by hand
 * can take ten minutes. Without somewhere to put the in-progress plan, a
 * closed laptop lid or a stray reload threw all of it away. `/scheduleDraft`
 * is a single top-level node that holds exactly one draft at a time -- the
 * one currently open in the preview.
 *
 * `/scheduleDraft` gets no entry in database.rules.json, on purpose. It
 * inherits the root rule's admin-only .read/.write, same as every other path
 * nobody has written a narrower rule for. A rule scoped to this path could
 * only ever be equal or looser than that, and the unpublished schedule --
 * who is judging which team, before it is announced -- is exactly the kind
 * of thing that must not leak to a signed-in judge or competitor. So: no
 * rule, no republish, and reviewers should not add one here.
 *
 * `edits` is the one field that changes shape crossing the wire. In memory
 * (planSchedule.js, applyEdit.js) it is an ordered array. Realtime Database
 * never stores an array -- this codebase's rule is that sets are keyed, so a
 * single entry can be addressed and deleted without renumbering the rest.
 * `saveDraft` keys it on the way out with zero-padded indices ("0000",
 * "0001", ...), and `readDraft`/`subscribeDraft` sort those keys back into
 * the array `applyEdit` expects. `schedule.judges` inside each assignment is
 * the one array this codebase does keep, because it is the same shape
 * already written to teams/{id}/schedule -- except when it is empty:
 * `moveTeam` can legitimately place a team with `judges: []` before anyone is
 * assigned, and RTDB drops an empty array on write the same way it drops an
 * empty object, leaving the key entirely absent on the way back. `decodeDraft`
 * restores that key (and `assignments`, `basis.batchTimes`, and an edit's
 * `before.judges`, which can all go empty the same way) in one place, so
 * every downstream reader can assume they are always present.
 *
 * `saveDraft` is optimistic-concurrency: two organizers can have the preview
 * open at once, and the second save should not silently clobber the first.
 * It reads the stored version, refuses if it does not match the version the
 * caller last read, and names who moved it. The same check covers a draft
 * that was cleared out from under an editor: a plan carrying a version above
 * 0 with nothing currently stored did not just start existing, so that save
 * is refused rather than treated as a fresh first save.
 */

const DRAFT_PATH = "scheduleDraft";

/** Array -> keyed object, zero-padded wide enough for string sort to equal numeric order. */
function encodeEdits(edits) {
  const list = Array.isArray(edits) ? edits : [];
  const width = Math.max(4, String(list.length).length);
  const keyed = {};
  list.forEach((entry, index) => {
    keyed[String(index).padStart(width, "0")] = entry;
  });
  return keyed;
}

/** Keyed object -> array, in key order. Tolerates an array already, just in case. */
function decodeEdits(stored) {
  if (Array.isArray(stored)) return stored;
  if (!stored || typeof stored !== "object") return [];
  return Object.keys(stored)
    .sort()
    .map((key) => stored[key]);
}

/**
 * Realtime Database never stores an empty array or object -- it drops the key
 * entirely. `judges: []` on a freshly-placed team (moveTeam deliberately
 * leaves it that way until someone is assigned) comes back with no `judges`
 * key at all, not an empty one. An assignment missing that key is still an
 * assignment -- restore just the one key RTDB stripped from it.
 */
function normalizeAssignment(assignment) {
  if (!assignment) return assignment;
  return { ...assignment, judges: assignment.judges ?? [] };
}

/**
 * Restores every shape RTDB can strip from a stored draft, in one place, so
 * every consumer downstream can assume `assignments`, each assignment's
 * `judges`, `basis.batchTimes`, and an edit's `before.judges` are always
 * present -- never scatter `?? []` across the five places that read them.
 */
function decodeDraft(raw) {
  if (!raw) return null;
  const assignments = raw.assignments ?? {};
  const edits = decodeEdits(raw.edits).map((entry) =>
    entry?.before ? { ...entry, before: normalizeAssignment(entry.before) } : entry
  );
  return {
    ...raw,
    assignments: Object.fromEntries(
      Object.entries(assignments).map(([id, a]) => [id, normalizeAssignment(a)])
    ),
    basis: { ...(raw.basis ?? {}), batchTimes: raw.basis?.batchTimes ?? {} },
    edits,
  };
}

/**
 * The current draft, or null if nobody has saved one (or it was cleared).
 * Never throws -- a read failure (including "not an admin") is reported the
 * same way as "no draft yet", since callers use this to decide whether to
 * offer "resume your draft".
 */
export async function readDraft() {
  try {
    await requireAdmin("read the schedule draft");
    const snap = await get(ref(database, DRAFT_PATH));
    return snap.exists() ? decodeDraft(snap.val()) : null;
  } catch (error) {
    console.error("Could not read the schedule draft:", error);
    return null;
  }
}

/**
 * Save a plan as the draft, refusing a stale write.
 *
 * Returns { ok, error?, version? }. On success `version` is the value now
 * stored, one higher than the plan the caller had -- the caller should hold
 * onto it so its next save is checked against what it actually wrote.
 */
export async function saveDraft(plan) {
  try {
    await requireAdmin("save the schedule draft");
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const snap = await get(ref(database, DRAFT_PATH));
    const stored = snap.exists() ? snap.val() : null;

    // A plan.version above 0 means the caller last read an existing draft.
    // Nothing being stored now means that draft was discarded out from under
    // them -- not that this is a first save -- so this must refuse rather
    // than let the save resurrect a draft someone deliberately cleared. A
    // genuine first save always carries version 0, which this leaves alone.
    if (!stored && plan.version > 0) {
      return {
        ok: false,
        error:
          "This draft was discarded while you were editing it. Build a new plan " +
          "-- your edits cannot be re-applied to a draft that no longer exists.",
      };
    }

    if (stored && stored.version !== plan.version) {
      return {
        ok: false,
        error:
          `${stored.createdByName ?? "Another organizer"} changed this draft while you were ` +
          `looking. Reload the preview to pick up their version.`,
      };
    }

    const nextVersion = (plan.version ?? 0) + 1;

    // uid comes from the auth SDK directly rather than requireAdmin's return
    // value: requireAdmin's job here is the guard (throw if not an admin),
    // not to be the source of truth for who is acting.
    const uid = getAuth().currentUser?.uid;

    const stamp = stored
      ? {
          createdAt: stored.createdAt,
          createdBy: stored.createdBy,
          createdByName: stored.createdByName,
        }
      : {
          createdAt: serverTimestamp(),
          createdBy: uid,
          createdByName: await resolveName(uid),
        };

    const { edits, ...rest } = plan;

    const payload = {
      ...rest,
      edits: encodeEdits(edits),
      ...stamp,
      version: nextVersion,
    };

    /*
     * The check above narrows the race; it does not close it.
     *
     * Two organizers who read the same version both pass it, and both then
     * write -- the second silently overwriting the first, with both told the
     * save succeeded. That is the exact failure the version field exists to
     * prevent, so the write re-checks it atomically rather than trusting a read
     * from a moment ago.
     *
     * `applyLocally: false` keeps a write that is about to be rejected from
     * flashing through the live subscription on its way to being undone.
     */
    const result = await runTransaction(
      ref(database, DRAFT_PATH),
      (current) => {
        // abort by returning nothing: somebody wrote between the read and here
        if ((current?.version ?? 0) !== (plan.version ?? 0)) return undefined;
        return payload;
      },
      { applyLocally: false }
    );

    if (!result.committed) {
      const winner = result.snapshot?.val();
      return {
        ok: false,
        error:
          `${winner?.createdByName ?? "Another organizer"} saved this draft first. ` +
          `Reload the preview to pick up their version.`,
      };
    }

    return { ok: true, version: nextVersion };
  } catch (error) {
    console.error("Could not save the schedule draft:", error);
    return { ok: false, error: error.message || "The draft could not be saved." };
  }
}

/** Discard the draft. Only ever called once the schedule is published or abandoned. */
export async function clearDraft() {
  try {
    await requireAdmin("clear the schedule draft");
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    await update(ref(database), { [DRAFT_PATH]: null });
    return { ok: true };
  } catch (error) {
    console.error("Could not clear the schedule draft:", error);
    return { ok: false, error: error.message || "The draft could not be cleared." };
  }
}

/**
 * Live updates to the draft, decoded the same way `readDraft` decodes it.
 * Mirrors `subscribeToSnapshots` in ../admin/snapshots.js: hands the callback
 * a plain value (here, the plan or null) rather than a snapshot, and returns
 * an unsubscribe function.
 */
export function subscribeDraft(callback) {
  const stop = onValue(
    ref(database, DRAFT_PATH),
    (snap) => {
      callback(snap.exists() ? decodeDraft(snap.val()) : null);
    },
    (error) => {
      console.error("Could not watch the schedule draft:", error);
      callback(null);
    }
  );
  return () => stop();
}

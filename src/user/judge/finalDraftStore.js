import { ref, get, update, onValue, runTransaction, serverTimestamp } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { resolveName } from "../admin/adminAction.js";

/**
 * Persistence for a final round an organizer is still hand-editing.
 *
 * `draftStore.js` for the final round, and the same reasoning: reworking a
 * running order and four panels takes long enough that a closed laptop lid
 * must not throw it away, and two organizers with the page open must not
 * silently clobber each other.
 *
 * `/finalRoundDraft` gets no entry in database.rules.json, deliberately, the
 * same way `/scheduleDraft` does not. It inherits the root rule's admin-only
 * read and write. An unpublished final round -- who made the cut, before it is
 * announced -- is the last thing that should reach a signed-in judge or
 * competitor, and a rule scoped to this path could only ever be equal or
 * looser than the root one. So: no rule, no republish, and reviewers should
 * not add one here. `src/schema.test.js` asserts it stays absent.
 *
 * Three fields change shape crossing the wire, for the reason they always do:
 * Realtime Database has no arrays, and drops an empty one entirely. `ranked`
 * and `edits` are keyed on the way out with zero-padded indices and sorted
 * back on the way in; `pool`, each assignment's `judges` and each edit's
 * `orderBefore` are written as arrays and restored to `[]` by `decodeDraft`
 * when they come back absent. Every reader downstream can then assume they
 * are present.
 */

export const FINAL_DRAFT_PATH = "finalRoundDraft";

const key = (index) => String(index).padStart(4, "0");

function encodeList(list) {
  return Object.fromEntries((list ?? []).map((entry, index) => [key(index), entry]));
}

function decodeList(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return Object.entries(raw ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entry]) => entry);
}

export function encodeDraft(plan) {
  const { ranked, edits, assignments, ...rest } = plan;
  return {
    ...rest,
    ranked: encodeList(ranked),
    edits: encodeList(edits),
    assignments: Object.fromEntries(
      Object.entries(assignments ?? {}).map(([teamId, assignment]) => [
        teamId,
        { ...assignment, judges: assignment.judges ?? [] },
      ])
    ),
  };
}

export function decodeDraft(raw) {
  return {
    ...raw,
    ranked: decodeList(raw?.ranked),
    pool: decodeList(raw?.pool),
    excluded: raw?.excluded ?? {},
    assignments: Object.fromEntries(
      Object.entries(raw?.assignments ?? {}).map(([teamId, assignment]) => [
        teamId,
        { ...assignment, judges: decodeList(assignment?.judges) },
      ])
    ),
    edits: decodeList(raw?.edits).map((edit) => ({
      ...edit,
      orderBefore: decodeList(edit?.orderBefore),
      before: edit?.before ? { ...edit.before, judges: decodeList(edit.before.judges) } : null,
    })),
    basis: {
      ...(raw?.basis ?? {}),
      cardCounts: raw?.basis?.cardCounts ?? {},
      eligibleJudges: raw?.basis?.eligibleJudges ?? {},
    },
  };
}

/** The current draft, or null if nobody has saved one. Never throws. */
export async function readFinalDraft() {
  try {
    await requireAdmin("read the final round draft");
    const snap = await get(ref(database, FINAL_DRAFT_PATH));
    return snap.exists() ? decodeDraft(snap.val()) : null;
  } catch (error) {
    console.error("Could not read the final round draft:", error);
    return null;
  }
}

/**
 * Save a plan as the draft, refusing a stale write.
 *
 * Returns { ok, error?, version? }. On success `version` is the value now
 * stored, one higher than the plan the caller had.
 */
export async function saveFinalDraft(plan) {
  try {
    await requireAdmin("save the final round draft");
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const snap = await get(ref(database, FINAL_DRAFT_PATH));
    const stored = snap.exists() ? snap.val() : null;

    // A version above 0 means the caller last read an existing draft. Nothing
    // stored now means it was discarded out from under them, not that this is
    // a first save -- so this must refuse rather than resurrect a draft
    // somebody deliberately cleared.
    if (!stored && plan.version > 0) {
      return {
        ok: false,
        error:
          "This draft was discarded while you were editing it. Build a new plan — your edits " +
          "cannot be re-applied to a draft that no longer exists.",
      };
    }

    if (stored && stored.version !== plan.version) {
      return {
        ok: false,
        error:
          `${stored.createdByName ?? "Another organizer"} changed this draft while you were ` +
          `looking. Reload the planner to pick up their version.`,
      };
    }

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

    const payload = {
      ...encodeDraft(plan),
      ...stamp,
      version: (plan.version ?? 0) + 1,
    };

    /*
     * The check above narrows the race; it does not close it. Two organizers
     * who read the same version both pass it and both write, the second
     * silently overwriting the first with both told it saved. See the same
     * note in draftStore.js.
     */
    const result = await runTransaction(
      ref(database, FINAL_DRAFT_PATH),
      (current) => {
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
          `Reload the planner to pick up their version.`,
      };
    }

    return { ok: true, version: payload.version };
  } catch (error) {
    console.error("Could not save the final round draft:", error);
    return { ok: false, error: error.message || "The draft could not be saved." };
  }
}

/** Discard the draft. Called once the final round is published or abandoned. */
export async function clearFinalDraft() {
  try {
    await requireAdmin("clear the final round draft");
    await update(ref(database), { [FINAL_DRAFT_PATH]: null });
    return { ok: true };
  } catch (error) {
    console.error("Could not clear the final round draft:", error);
    return { ok: false, error: error.message };
  }
}

/** Live updates, so two organizers with the planner open see each other's edits. */
export function subscribeFinalDraft(callback) {
  const unsubscribe = onValue(
    ref(database, FINAL_DRAFT_PATH),
    (snapshot) => callback(snapshot.exists() ? decodeDraft(snapshot.val()) : null),
    (error) => {
      console.error("Failed to subscribe to the final round draft:", error);
      callback(null);
    }
  );
  return () => unsubscribe();
}

import { ref, get, update, push, serverTimestamp } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";

/**
 * Every write the control panel makes goes through here.
 *
 * The one property worth protecting: the change and the entry describing it go
 * into the SAME multi-path update, which Realtime Database applies atomically.
 * Two separate writes would let a change land with no record on a dropped
 * connection -- precisely the state you would be trying to explain afterwards.
 *
 * This is a forensics aid, not a ledger. Admins hold root write and deletes
 * skip validation, so entries can be erased. It answers "what did we change at
 * 4:52", not "prove nobody tampered".
 */

/**
 * Above this many bytes of serialised before/after, the entry keeps counts
 * only. Clearing a whole schedule captures every team's slot plus every
 * judge's copy -- of the order of 100 KB -- and that is not worth storing to
 * make undoable something a regeneration rebuilds anyway.
 */
export const UNDO_SIZE_CAP = 50000;

/**
 * before/after are stored as JSON strings.
 *
 * RTDB drops null values on write, so a literal `before: null` -- meaning the
 * field did not exist -- would silently vanish from the entry and undo would
 * restore the wrong thing. A string survives, and it collapses the .validate
 * for these fields to isString().
 */
export function encodeChanges(changes) {
  return changes.map(({ path, before, after }) => ({
    path,
    before: JSON.stringify(before ?? null),
    after: JSON.stringify(after ?? null),
  }));
}

export function decodeChanges(raw) {
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.map(({ path, before, after }) => ({
    path,
    before: JSON.parse(before ?? "null"),
    after: JSON.parse(after ?? "null"),
  }));
}

/** Read the current value at each path, so the entry can carry a before-state. */
export async function captureBefore(paths) {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const snap = await get(ref(database, path));
      return [path, snap.exists() ? snap.val() : null];
    })
  );
  return Object.fromEntries(entries);
}

/** Best-effort display name for the acting admin; the uid is the fallback. */
export async function resolveName(uid) {
  for (const role of ["judges", "competitors"]) {
    try {
      const snap = await get(ref(database, `${role}/${uid}`));
      if (snap.exists()) {
        const person = snap.val();
        const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
        if (name) return name;
      }
    } catch {
      // an admin who is neither a judge nor a competitor is normal
    }
  }
  return `admin ${uid.slice(0, 8)}`;
}

/**
 * Re-verify a set of paths' current values, one time, immediately before the
 * write they guard.
 *
 * This is NOT a compare-and-swap. RTDB's multi-path `update()` has no
 * condition of its own -- nothing stops a write from landing in the gap
 * between this check resolving and the `update()` call actually reaching the
 * server. What this closes is the much larger gap that used to sit in front
 * of it: `requireAdmin`'s round trip and `resolveName`'s, both awaited after
 * the caller's own drift check had already passed. Shrinking a window this
 * far, right up against the write it protects, is the most a client can do
 * without either a Cloud Function that owns the check and the write as one
 * atomic step, or restructuring so every one of these paths lives under a
 * single parent an RTDB transaction could guard at once (today they do not
 * -- an admin action's changes can span any number of unrelated top-level
 * paths).
 */
async function findLiveDrift(expectedByPath) {
  const paths = Object.keys(expectedByPath);
  if (!paths.length) return null;

  const current = await captureBefore(paths);
  for (const path of paths) {
    const want = expectedByPath[path] ?? null;
    const now = current[path] ?? null;
    if (JSON.stringify(now) !== JSON.stringify(want)) {
      return { path, expected: want, actual: now };
    }
  }
  return null;
}

/**
 * `hasRestorePoint` changes only what the entry says when the before-state was
 * too big to inline. That distinction matters: "too large to undo" used to be
 * the whole story, and it was read as "this is gone". With a restore point
 * taken beforehand the data is recoverable, and the log has to say so or nobody
 * will look.
 *
 * `guardBefore`, when given, is a `{ path: expectedCurrentValue }` map that is
 * re-checked with `findLiveDrift` right before the write goes out, and the
 * write is refused if anything drifted. It is `null` for every caller that
 * does not pass it -- undo is the only caller that has an "expected current
 * value" worth re-checking this late, and every other call site keeps writing
 * exactly as it always did.
 */
export async function applyAdminAction({
  action,
  summary,
  changes = [],
  undoable = true,
  hasRestorePoint = false,
  guardBefore = null,
}) {
  let admin;
  try {
    admin = await requireAdmin(action);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const encoded = encodeChanges(changes);
    const tooBig = JSON.stringify(encoded).length > UNDO_SIZE_CAP;

    const oversizeNote = hasRestorePoint
      ? `${summary} (${changes.length} paths — undo from Restore points)`
      : `${summary} (${changes.length} paths, too large to undo)`;

    const entry = {
      at: serverTimestamp(),
      by: admin.uid,
      byName: await resolveName(admin.uid),
      action,
      summary: (tooBig ? oversizeNote : summary).slice(0, 500),
      undoable: undoable && !tooBig,
    };
    if (!tooBig) entry.changes = encoded;

    const entryId = push(ref(database, "adminLog")).key;

    const updates = {};
    for (const { path, after } of changes) updates[path] = after ?? null;
    updates[`adminLog/${entryId}`] = entry;

    // Last check before the write, deliberately as close to `update()` as the
    // rest of this function's async work (resolveName above included) allows.
    if (guardBefore) {
      const drift = await findLiveDrift(guardBefore);
      if (drift) {
        return {
          ok: false,
          error:
            `${drift.path} has changed since this action, so undoing it would discard ` +
            `that edit. Nothing was changed.`,
          drift,
        };
      }
    }

    await update(ref(database), updates);
    return { ok: true, entryId };
  } catch (error) {
    console.error(`Admin action ${action} failed:`, error);
    return { ok: false, error: error.message || "The change could not be saved." };
  }
}

/** Swap before and after. A create reverses into a delete and vice versa. */
export function reverseChanges(changes) {
  return changes.map(({ path, before, after }) => ({ path, before: after, after: before }));
}

/**
 * Has anything moved since the entry was written?
 *
 * Undo restores a captured value, so if a later edit touched the same path an
 * unguarded undo would silently discard it. Structural comparison via JSON: the
 * values came out of the database, so they are plain JSON already.
 */
export function findDrift(changes, current) {
  for (const { path, after } of changes) {
    const now = current[path] ?? null;
    if (JSON.stringify(now) !== JSON.stringify(after ?? null)) {
      return { path, expected: after ?? null, actual: now };
    }
  }
  return null;
}

export async function undoAdminAction(entryId) {
  let entry;
  try {
    const snap = await get(ref(database, `adminLog/${entryId}`));
    if (!snap.exists()) return { ok: false, error: "That log entry no longer exists." };
    entry = snap.val();
  } catch (error) {
    return { ok: false, error: error.message || "Could not read that log entry." };
  }

  if (entry.undone) {
    return { ok: false, error: "That change has already been undone." };
  }
  if (entry.undoable === false || !entry.changes) {
    return { ok: false, error: "That change cannot be undone. It was too large to record in full." };
  }

  const changes = decodeChanges(entry.changes);

  let current;
  try {
    current = await captureBefore(changes.map((change) => change.path));
  } catch (error) {
    return { ok: false, error: error.message || "Could not check the current values." };
  }

  const drift = findDrift(changes, current);
  if (drift) {
    return {
      ok: false,
      error:
        `${drift.path} has changed since this action, so undoing it would discard ` +
        `that edit. Nothing was changed.`,
      drift,
    };
  }

  let actingUid;
  try {
    actingUid = (await requireAdmin("undo a change")).uid;
  } catch (error) {
    return { ok: false, error: error.message };
  }

  // The undo goes through applyAdminAction, so it is logged like anything else,
  // and marking the original happens in the same atomic update as the reversal.
  //
  // `guardBefore: current` re-checks these same paths one more time, right
  // before the write -- the drift check just above already passed, but it ran
  // before requireAdmin (and applyAdminAction's own resolveName) were
  // awaited, and a second admin's write reaching any of these paths in that
  // gap would otherwise be silently overwritten by this undo.
  return applyAdminAction({
    action: `undo:${entry.action}`,
    summary: `Undid: ${entry.summary}`,
    changes: [
      ...reverseChanges(changes),
      {
        path: `adminLog/${entryId}/undone`,
        before: null,
        after: { at: serverTimestamp(), by: actingUid },
      },
    ],
    undoable: false,
    guardBefore: current,
  });
}

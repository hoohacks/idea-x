import { ref, get, update, push, onValue, runTransaction, serverTimestamp } from "firebase/database";
import { database } from "../../firebase.js";
import { requireAdmin } from "../../roles.js";
import { resolveName } from "./adminAction.js";

/**
 * Restore points for the operations the audit log cannot carry.
 *
 * `applyAdminAction` records a before-state inline in the log entry, which is
 * right for a field edit and wrong for anything bulk: past UNDO_SIZE_CAP it
 * drops the before-state entirely and marks the entry un-undoable. That made
 * recoverability depend on data size -- "clear the schedule and every score"
 * was reversible on a 20-team test event and unreversible on the 30-team event
 * it was rehearsed for. The safety net was present exactly where it was not
 * needed.
 *
 * A snapshot is stored out of line instead, so size stops being the thing that
 * decides whether a mistake can be undone.
 *
 * Two nodes, on purpose:
 *
 *   /snapshotIndex/{id}   small metadata, cheap to list
 *   /snapshots/{id}       the payload, only ever read when restoring
 *
 * Listing restore points would otherwise mean downloading every one of them.
 *
 * Both live under the root admin rule and neither has a .validate clause, so
 * this needs no rules change and no republish.
 */

/** How many restore points to keep. Older ones are pruned as new ones arrive. */
export const KEEP_SNAPSHOTS = 15;

/** Everything the judging round consists of. The default for a bulk action. */
export const JUDGING_PATHS = ["teams", "judges", "scores", "finalRound", "config/scheduleMeta"];

function encode(value) {
  // JSON strings for the same reason adminLog uses them: Realtime Database
  // drops nulls on write, so a literal null -- meaning "this did not exist" --
  // would vanish and a restore would put back the wrong thing.
  return JSON.stringify(value ?? null);
}

/**
 * Copy the current value of every path into a restore point.
 *
 * Returns `{ ok, id, bytes }`. The caller must treat `ok: false` as a reason to
 * abandon the destructive action it was about to take -- a wipe with no restore
 * point is the situation this module exists to prevent.
 */
export async function captureSnapshot({ label, reason = null, paths = JUDGING_PATHS }) {
  let admin;
  try {
    admin = await requireAdmin("create a restore point");
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const entries = await Promise.all(
      paths.map(async (path) => {
        const snap = await get(ref(database, path));
        return { path, value: encode(snap.exists() ? snap.val() : null) };
      })
    );

    const bytes = entries.reduce((sum, entry) => sum + entry.value.length, 0);
    const id = push(ref(database, "snapshots")).key;
    const meta = {
      at: serverTimestamp(),
      by: admin.uid,
      byName: await resolveName(admin.uid),
      label,
      reason,
      paths,
      bytes,
    };

    /*
     * Insert this entry's metadata into /snapshotIndex and prune whatever is
     * past KEEP_SNAPSHOTS, as ONE conditional write.
     *
     * The old code read /snapshotIndex, computed the single oldest entry to
     * evict from that read, and wrote the insert and the eviction together in
     * a plain update(). Two captures landing together both read the SAME
     * pre-capture index, so both computed the SAME entry to evict -- the
     * index gained two entries and lost one, net +1 over the limit, without
     * bound as more captures piled up in the same window.
     *
     * runTransaction closes that specifically: the server reruns the updater
     * against its own latest value whenever a write has landed since this
     * client last read it, so the second capture's prune math runs against a
     * value that already reflects the first capture's insert (and its
     * prune), never a stale read from before it. Two concurrent captures
     * serialize into two correct, sequential edits instead of two
     * conflicting ones -- /snapshotIndex can never hold more than
     * KEEP_SNAPSHOTS entries, no matter how many captures land at once. That
     * part of this bug is ELIMINATED, not narrowed: a transaction is a real
     * compare-and-swap, unlike a read followed by a plain write.
     *
     * `existing` is read from `current`, not from `next` -- the entry being
     * inserted here still carries a serverTimestamp() sentinel, resolved only
     * when the transaction actually commits server-side, so it cannot be
     * sorted by `.at` locally. Every entry in `current`, by contrast, already
     * committed with a real numeric timestamp.
     */
    let staleKeys = [];
    const indexResult = await runTransaction(ref(database, "snapshotIndex"), (current) => {
      const existing = Object.entries(current ?? {})
        .map(([key, entryMeta]) => ({ key, at: entryMeta?.at ?? 0 }))
        .sort((a, b) => b.at - a.at);

      staleKeys = existing.slice(KEEP_SNAPSHOTS - 1).map((entry) => entry.key);

      const next = { ...(current ?? {}) };
      for (const stale of staleKeys) delete next[stale];
      next[id] = meta;
      return next;
    });

    if (!indexResult.committed) {
      return { ok: false, error: "Could not update the restore point list. Nothing was saved." };
    }

    /*
     * The payload, plus deleting the payloads of whatever the transaction
     * above just pruned -- bundled into one update so a failure here cannot
     * leave a payload for an entry the index no longer lists (an orphan that
     * would never surface again, and would never be cleaned up: exactly the
     * unbounded growth this module exists to prevent).
     *
     * This does NOT make the transaction and this update into one atomic
     * cross-node operation -- RTDB has no primitive for that, only
     * multi-path update() (atomic, not conditional) and single-path
     * transactions (conditional, single node). A crash between the two calls
     * can still leave /snapshotIndex pointing at a payload that was never
     * written. That fails safe rather than silently: restoreSnapshot and
     * previewSnapshot both already refuse cleanly when a payload is missing,
     * so a dangling index entry is visible and inert, not a storage leak.
     */
    const updates = { [`snapshots/${id}`]: { entries } };
    for (const stale of staleKeys) updates[`snapshots/${stale}`] = null;
    await update(ref(database), updates);

    return { ok: true, id, bytes };
  } catch (error) {
    console.error("Could not create a restore point:", error);
    return { ok: false, error: error.message || "The restore point could not be saved." };
  }
}

/**
 * Live metadata for every restore point, newest first.
 *
 * A subscription rather than a one-shot read, because restore points are
 * created by other parts of the panel -- generating a schedule, clearing it,
 * activating the final round. With a one-shot read the list a person is looking
 * at is stale the moment the thing they might need to undo happens, which is
 * the worst possible moment for it to be stale.
 */
export function subscribeToSnapshots(callback) {
  const stop = onValue(
    ref(database, "snapshotIndex"),
    (snap) => {
      const value = snap.val() ?? {};
      callback(
        Object.entries(value)
          .map(([id, meta]) => ({ id, ...meta }))
          .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      );
    },
    (error) => {
      console.error("Could not watch restore points:", error);
      callback([]);
    }
  );
  return () => stop();
}

/** Metadata for every restore point, newest first. Never loads a payload. */
export async function listSnapshots() {
  try {
    const snap = await get(ref(database, "snapshotIndex"));
    if (!snap.exists()) return [];
    return Object.entries(snap.val() ?? {})
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  } catch (error) {
    console.error("Could not list restore points:", error);
    return [];
  }
}

/**
 * Put every path in a restore point back to the value it held.
 *
 * Takes a restore point of the CURRENT state first, so restoring is itself
 * reversible -- an organizer who restores the wrong one has somewhere to go.
 * The whole thing is one atomic update, so a restore cannot half-apply.
 */
export async function restoreSnapshot(id) {
  let admin;
  try {
    admin = await requireAdmin("restore from a restore point");
  } catch (error) {
    return { ok: false, error: error.message };
  }

  let payload;
  let meta;
  try {
    const [payloadSnap, metaSnap] = await Promise.all([
      get(ref(database, `snapshots/${id}`)),
      get(ref(database, `snapshotIndex/${id}`)),
    ]);
    if (!payloadSnap.exists()) return { ok: false, error: "That restore point no longer exists." };
    payload = payloadSnap.val();
    meta = metaSnap.exists() ? metaSnap.val() : {};
  } catch (error) {
    return { ok: false, error: error.message || "Could not read that restore point." };
  }

  const entries = Array.isArray(payload?.entries)
    ? payload.entries
    : Object.values(payload?.entries ?? {});
  if (!entries.length) return { ok: false, error: "That restore point is empty." };

  const safety = await captureSnapshot({
    label: `Before restoring “${meta.label ?? id}”`,
    reason: "taken automatically so a restore can itself be undone",
    paths: entries.map((entry) => entry.path),
  });
  if (!safety.ok) {
    return {
      ok: false,
      error: `Could not take a restore point of the current state, so nothing was restored. ${safety.error}`,
    };
  }

  try {
    const updates = {};
    for (const entry of entries) {
      updates[entry.path] = JSON.parse(entry.value ?? "null");
    }

    // the log entry rides along in the same update. Its changes are omitted on
    // purpose: they are what the restore point is for, and inlining them is the
    // exact failure this module exists to fix.
    const entryId = push(ref(database, "adminLog")).key;
    updates[`adminLog/${entryId}`] = {
      at: serverTimestamp(),
      by: admin.uid,
      byName: await resolveName(admin.uid),
      action: "snapshot.restore",
      summary:
        `Restored ${entries.length} path(s) from “${meta.label ?? id}”. ` +
        `The previous state was saved as a new restore point first.`,
      undoable: false,
    };

    await update(ref(database), updates);
    return { ok: true, restored: entries.length, safetyId: safety.id };
  } catch (error) {
    console.error("Restore failed:", error);
    return {
      ok: false,
      error: error.message || "The restore could not be applied. Nothing was changed.",
    };
  }
}

/**
 * The payload and current live values for a restore point, read once when a
 * preview dialog opens -- never subscribed to, so looking at a restore point
 * does not leave a connection open behind it.
 *
 * Returns `{ ok, entries, live, error }`. `entries` and `live` are exactly
 * the shapes `diffSnapshot` (./danger/snapshotDiff.js) expects, so the
 * caller can hand them straight over.
 */
export async function previewSnapshot(id) {
  try {
    const payloadSnap = await get(ref(database, `snapshots/${id}`));
    if (!payloadSnap.exists()) return { ok: false, error: "That restore point no longer exists." };

    const payload = payloadSnap.val();
    const entries = Array.isArray(payload?.entries)
      ? payload.entries
      : Object.values(payload?.entries ?? {});
    if (!entries.length) return { ok: false, error: "That restore point is empty." };

    const liveSnaps = await Promise.all(entries.map((entry) => get(ref(database, entry.path))));
    const live = {};
    entries.forEach((entry, index) => {
      live[entry.path] = liveSnaps[index].exists() ? liveSnaps[index].val() : null;
    });

    return { ok: true, entries, live };
  } catch (error) {
    return { ok: false, error: error.message || "Could not read that restore point." };
  }
}

/**
 * Judge display names, read once when a preview dialog opens rather than
 * kept subscribed in Control.js -- a permanently open /judges listener is
 * the wrong price for a dialog almost nobody opens.
 *
 * Always returns `names` (empty on failure), so a caller can use it directly
 * as a lookup with no branch on `ok`: a uid missing from the map, whether
 * because the read failed or the judge record does not exist, falls back to
 * rendering the uid.
 */
export async function readJudgeNames() {
  try {
    const snap = await get(ref(database, "judges"));
    const value = snap.val() ?? {};
    const names = {};
    for (const [uid, judge] of Object.entries(value)) {
      const name = [judge?.firstName, judge?.lastName].filter(Boolean).join(" ").trim();
      names[uid] = name || uid;
    }
    return { ok: true, names };
  } catch (error) {
    return { ok: false, error: error.message || "Could not load judges.", names: {} };
  }
}

/**
 * Take a restore point, and refuse to continue if it could not be taken.
 *
 * Every destructive bulk action funnels through this, so "we wiped it and there
 * is no copy" stops being a reachable state.
 */
export async function guardWith({ label, reason, paths = JUDGING_PATHS }) {
  const snapshot = await captureSnapshot({ label, reason, paths });
  if (!snapshot.ok) {
    return {
      ok: false,
      error:
        `Could not create a restore point, so nothing was changed. ${snapshot.error ?? ""}`.trim(),
    };
  }
  return { ok: true, snapshotId: snapshot.id, bytes: snapshot.bytes };
}

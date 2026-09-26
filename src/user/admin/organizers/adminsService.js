import { ref, get } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../../firebase.js";
import { applyAdminAction } from "../adminAction.js";

/**
 * Who is an organizer.
 *
 * The rules give root access only to uids under /admins, and writing to
 * /admins requires being an admin already. Nothing in the app can break that
 * cycle -- docs/deployment.md bootstraps the first one by hand in the Firebase console.
 *
 * So a revoke that empties /admins locks everyone out permanently, with no way
 * back except the console. revokeGuard is the whole reason this module exists,
 * and it is enforced here rather than in the dialog so a stale page cannot slip
 * past it.
 */

/** The reason this revoke must not happen, or null if it may. Pure. */
export function revokeGuard({ uid, currentUid, adminUids }) {
  if (!adminUids.includes(uid)) {
    return "That person is not an admin.";
  }
  if (adminUids.length <= 1) {
    return (
      "That is the last admin. Removing them would lock everyone out -- " +
      "/admins can only be written by an admin, so nothing in the app could add one back. " +
      "Grant someone else first."
    );
  }
  if (uid === currentUid) {
    return "You cannot remove your own admin access. Ask another admin to do it.";
  }
  return null;
}

export async function listAdmins() {
  const snap = await get(ref(database, "admins"));
  return snap.exists() ? Object.keys(snap.val() ?? {}) : [];
}

export async function grantAdmin({ uid, name }) {
  if (!uid) return { ok: false, error: "Pick a person first." };

  const adminUids = await listAdmins();
  if (adminUids.includes(uid)) {
    return { ok: false, error: `${name || uid} is already an admin.` };
  }

  return applyAdminAction({
    action: "admin.grant",
    summary: `Made ${name || uid} an admin`,
    changes: [{ path: `admins/${uid}`, before: null, after: true }],
  });
}

export async function revokeAdmin(uid, { name } = {}) {
  const adminUids = await listAdmins();
  const currentUid = getAuth().currentUser?.uid ?? null;

  const refusal = revokeGuard({ uid, currentUid, adminUids });
  if (refusal) return { ok: false, error: refusal };

  return applyAdminAction({
    action: "admin.revoke",
    summary: `Removed admin access from ${name || uid}`,
    changes: [{ path: `admins/${uid}`, before: true, after: null }],
  });
}

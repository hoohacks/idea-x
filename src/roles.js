import { ref, get } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "./firebase.js";

/**
 * A role is membership of a top-level node named after it: /admins/{uid},
 * /judges/{uid}, /competitors/{uid}. Roles are additive — one account can be
 * all three — so this is always a list, never a single value.
 */
export const ROLES = ["competitor", "judge", "admin"];

/**
 * `userTypes` is an array that is empty while the session is still resolving
 * and undefined before the provider mounts. Callers kept re-deriving that
 * contract inline, and two of them had grown their own `Array.isArray` guard,
 * which is the usual sign nobody was sure what they were being handed.
 */
export function hasRole(userTypes, role) {
  return Array.isArray(userTypes) && userTypes.includes(role);
}

/** The roles as a list that is always safe to map over. */
export function roleList(userTypes) {
  return Array.isArray(userTypes) ? userTypes : [];
}

/**
 * One profile from the records of every role a person holds, merged in ROLES
 * order.
 *
 * The rule is that a later record never blanks a field an earlier one filled
 * in. Records are written with their fields present and empty rather than
 * absent -- granting someone a second role from the control panel writes
 * `firstName: ""`, not nothing -- so a plain spread let the record they were
 * given second erase the name and email on the one they registered with. To
 * that person their account looked wiped: no name, no email, and a password
 * reset that refused because there was no address on file.
 *
 * An empty value still lands when no record supplies a better one, so a field
 * nobody has filled in reads the same as it always did.
 */
export function mergeRoleProfiles(profiles) {
  const filled = (value) => value !== undefined && value !== null && value !== "";

  let merged = null;
  for (const profile of profiles) {
    if (!profile) continue;
    merged = merged ?? {};
    for (const [key, value] of Object.entries(profile)) {
      if (!filled(value) && filled(merged[key])) continue;
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * A person's name for display, or a fallback.
 *
 * Never interpolate the two fields directly. Records are written with their
 * fields present and empty rather than absent -- granting someone a role from
 * the control panel seeds `firstName: ""` -- so the raw join produces " " for a
 * real person, and "undefined undefined" for a record missing the fields
 * entirely. The first renders as a blank row in a team roster and a blank
 * verdict on the check-in screen, where somebody is trying to confirm they just
 * checked in the right person.
 */
export function personName(person, fallback = "Unnamed") {
  return [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() || fallback;
}

export function isAdmin(userTypes) {
  return hasRole(userTypes, "admin");
}

export function isJudge(userTypes) {
  return hasRole(userTypes, "judge");
}

/**
 * Confirm against the database that the caller is an admin.
 *
 * The React role checks are advisory: `userTypes` is client state, so anyone
 * can set it in DevTools and render an admin page. The rules are what actually
 * stop them. This exists for the handful of service functions that rewrite the
 * whole schedule or the final round — operations destructive enough that
 * failing early with a clear message beats firing a multi-path update and
 * getting a bare PERMISSION_DENIED halfway through.
 *
 * It is a guard rail, not a security boundary. The security boundary is
 * database.rules.json.
 */
export async function requireAdmin(action = "perform this action") {
  const user = getAuth().currentUser;
  if (!user) throw new Error(`Must be signed in to ${action}`);

  const snap = await get(ref(database, `admins/${user.uid}`));
  if (!snap.exists()) throw new Error(`Only an admin can ${action}`);

  return user;
}

/**
 * Team membership is stored as a keyed set:
 *
 *   teams/{teamId}/members/{uid} = true
 *
 * not as an array. The database rules decide who may read a team and who may
 * edit its submission with `members.hasChild(auth.uid)`, and that only matches
 * when the uid is the child *key*. An array is stored under numeric keys
 * ("0", "1", ...), so every one of those checks was silently false and the
 * member-scoped rules never applied.
 *
 * Teams created before that change still hold an array, so reads accept both.
 *
 * A team can also end up MIXED. `joinTeam` writes only `members/{uid}: true`
 * -- it never rewrites the rest of the node, because the rules grant it write
 * access to its own key alone, not to every other member's -- so joining a
 * team nobody has run scripts/migrate-team-members.mjs on yet lands that one
 * well-formed entry on top of the old array untouched. Realtime Database
 * turns the whole node into a plain object the moment a non-numeric key (a
 * uid) is added, so a still-live, still-unmigrated team can be read back as
 * `{"0": "dave", "1": "carol", "erin": true}`: two leftover array slots next
 * to one real keyed entry. A value of `true` marks a keyed entry, where the
 * uid is the KEY; a string value marks a leftover array slot, where the uid
 * is the VALUE and the numeric key means nothing. Telling them apart by the
 * shape of the value is what lets this keep reading such a team correctly
 * without ever needing to rewrite it -- see teamMembership.js for why
 * `joinTeam` itself does not attempt that rewrite.
 */
export function memberIds(members) {
  if (!members) return [];
  if (Array.isArray(members)) return members.filter(Boolean);
  if (typeof members !== "object") return [];
  return Object.entries(members)
    .filter(([, value]) => value)
    .map(([key, value]) => (typeof value === "string" ? value : key));
}

export function isMember(members, uid) {
  return Boolean(uid) && memberIds(members).includes(uid);
}

/**
 * Where to clear one uid out of a `members` node, whichever shape it is
 * stored in -- pure keyed, pure legacy array, or the mixed shape a join onto
 * an unmigrated team produces.
 *
 * A keyed entry lives at `members/{uid}` and holds `true`; a leftover array
 * slot lives at `members/{index}` and the VALUE is the uid, the index being
 * meaningless. Nulling `members/{uid}` on a legacy node deletes nothing,
 * because that key was never there -- the uid only ever appears as a value.
 * Callers that need to remove someone must ask this which child to null out
 * rather than assuming the keyed shape, the way `hasOwnProperty(members, uid)`
 * used to.
 *
 * Returns `{ key, before }` -- the real child to write `null` to, and the
 * value it holds right now (so an admin-log undo can restore it) -- or `null`
 * if this uid is not on the roster at all.
 */
export function memberRemovalPath(members, uid) {
  if (!uid || !members || typeof members !== "object") return null;
  for (const [key, value] of Object.entries(members)) {
    if (value === true && key === uid) return { key, before: true };
    if (typeof value === "string" && value === uid) return { key, before: value };
  }
  return null;
}

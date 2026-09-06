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

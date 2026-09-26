# 0002. Sets are keyed, never arrays

Status: accepted

## Context

Team members were stored as an array. Rules check membership with
`hasChild(auth.uid)`, which matches a child *key*; an array stores its values
under the keys `0`, `1`, `2`, so no rule could ask "is this person a member".

## Decision

Every set is an object keyed by id with `true` as the value:
`members: { uidA: true, uidB: true }`.

## Consequences

- Membership, assignments and similar checks become one `hasChild()` in a rule.
- Adding or removing yourself is a write to one key, which a rule can allow for
  your own uid and nobody else's.
- Older data needed a one-time migration (`scripts/migrate-team-members.mjs`),
  and `memberIds()` still reads the array shape defensively.

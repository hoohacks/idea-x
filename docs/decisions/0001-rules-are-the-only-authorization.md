# 0001. The database rules are the only authorization

Status: accepted

## Context

The app is a static site on GitHub Pages that talks to Firebase directly from
the browser. There is no server of our own to hold secrets or check permissions,
and anyone can open the browser console and call Firebase with their own
credentials.

## Decision

`database.rules.json` (and `storage.rules` for files) is the whole of the
authorization model. Role checks in React only decide what to show; they are never
relied on to stop anything.

## Consequences

- Every permission has to be expressible as a rule, which shapes the data model
  (see [0002](0002-keyed-sets-not-arrays.md), [0003](0003-scores-live-outside-teams.md),
  [0004](0004-denormalise-for-readers-who-cannot-read-the-source.md)).
- Some limits cannot be enforced at all: rules cannot count children, so the team
  size cap is advisory.
- The rules are tested on their own against the emulator (`npm run test:rules`),
  and the emulator must enforce them locally, or development runs wide open.
- Rules are deployed by hand, so the app records and checks which version is live
  ([security rules](../security-rules.md#versioning)).

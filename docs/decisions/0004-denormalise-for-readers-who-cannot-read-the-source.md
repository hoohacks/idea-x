# 0004. Copy values to readers who cannot read the source

Status: accepted

## Context

Because reads cascade ([0003](0003-scores-live-outside-teams.md)), nobody but
an admin can read `/teams` as a whole or the final standings. But a judge still
needs their schedule, and a team needs its final round slot.

## Decision

Write a copy where its reader can see it, in the same atomic update as the
original: the schedule on the team and on each judge's record, the final slot on
the team. Each copied value has an explicit rule for whether renames fan out to
the copies ([data model](../data-model.md#values-stored-more-than-once)).

## Consequences

- Readers never need a broader grant than the data they are shown.
- Every rename or delete has to update every copy, so those go through services
  that write them together.
- Judge names are the exception: never fanned out, always resolved from the judge
  record, with the cached name as a fallback.

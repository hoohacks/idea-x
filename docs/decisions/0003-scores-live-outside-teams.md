# 0003. Scores live at /scores, not under the team

Status: accepted

## Context

Scores were stored at `teams/{id}/scores`. Rules cascade and cannot be revoked
deeper, so the read a team member holds on their own team reached every judge's
numbers and private notes.

## Decision

Score cards live at `/scores/{round}/{teamId}/{judgeUid}`, a node no team
member can read. Each judge reads and writes only their own card.

## Consequences

- Teams cannot see their scores or notes before results are announced.
- Moving live data needed a staged cutover with a temporary ruleset
  ([migrations](../migrations.md#moving-scores-off-the-team-node)).
- The dashboard blocks the event while any cards remain in the old location,
  because the app no longer reads them.

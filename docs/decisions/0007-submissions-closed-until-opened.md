# 0007. Submissions stay closed until organizers open them

Status: accepted

## Context

Teams form weeks ahead. Submitting marks a team submitted, and a submitted team
takes no new members, so an early placeholder submission would lock out a friend
who registers later. An ideathon's pitch is also meant to be built on the day.

## Decision

`config/submissionsOpen` must be `true` for a team to submit, and an absent key
means closed. An optional `config/submissionsCloseAt` closes the form by itself.
Both are enforced by the rules, the deadline against the server's clock, and
organizers are exempt so they can fix a record by hand.

## Consequences

- A fresh deploy takes no submissions until someone opens them on the day.
- Teams can still form, invite and share their ID the whole time, and the team
  page says when the form arrives.
- The checks are `.validate` rules, because the team-creation rule cascades over
  the whole team node.
- Storage rules cannot read the flag, so a pitch deck can still be uploaded while
  closed; the submission that references it is refused.

# Security rules

`database.rules.json` is the only real authorization. The app talks to Firebase
straight from the browser, so every role check in React is a convenience; the
rules are what actually refuse ([ADR 0001](decisions/0001-rules-are-the-only-authorization.md)).
`storage.rules` does the same job for uploaded files.

## Who can do what

| Actor | Can |
| --- | --- |
| Anyone signed in | Read their own record, `config`, `/announcements`, `/resources`, `finalRound/active`, and any team's `name` |
| Competitor | Edit their own record except check-in; create a team; join or leave one that has **not** submitted; read their team; write their team's submission **while submissions are open and before the deadline** |
| Judge | Read their own record and assignments; read the submissions of teams they are assigned; write and read back their own scores |
| Organizer | Read `firstName`, `lastName`, `checkedIn`, `foodCheckIn` on `/competitors/{uid}` and `/judges/{uid}`; write `checkedIn` and `foodCheckIn` on `/competitors/{uid}` and `/judges/{uid}`; read `/organizers/{auth.uid}`. Denied access everywhere else |
| Admin | Everything, through the root rule |

- An organizer cannot read or write any other fields on competitors or judges, cannot read the rest of the database (scores, teams, config, logs), and cannot grant or revoke any role (including organizer or admin).
- A judge cannot set their own `isRound1Judge`, `checkedIn` or assignments. The
  last one is load-bearing: the score rules treat an assignment as proof that the
  judge was assigned.
- A judge can revise a score but not delete one.
- Nobody but an admin can read the standings.
- **Submissions**: while `config/submissionsOpen` is not `true`, or once
  `config/submissionsCloseAt` has passed by the server's clock, a member can
  neither write the submission nor mark the team submitted. This is a `.validate`,
  not part of `.write`, because the team-creation rule applies to the whole team
  node and would otherwise let a team arrive with a submission already in it.
  Admins are not bound by either.
- **Announcements** are posted by admins only, and the shape (text up to 280
  characters, one of three audiences) is held even for them.
- **Resources** are links posted by admins only, readable by anyone signed in (the home
  page decides when to show them). The shape (https link, title up to 80 characters,
  optional description up to 140) is held even for admins.
- **There is no team size cap in the rules, and there cannot be.** `numChildren()`
  is a client SDK method, and a rule calling it stops the whole file loading. The
  app's `MAX_TEAM_SIZE` is advisory.

## Rules cascade

Granting `.read` or `.write` at a path grants it for everything underneath, and a
deeper rule can never take it back. That is why there is no blanket
`".read": "auth != null"` on `/teams`, `/competitors` or `/scores`, and why scores
moved out from under the team ([ADR 0003](decisions/0003-scores-live-outside-teams.md)).
`.validate` does not cascade that way and cannot be bypassed by a grant higher up,
which is what the submission and announcement checks rely on.

## Joining a team

This is the sharp edge. Only `teams/{id}/name` is readable by somebody who is not
yet a member, and that is exactly who is joining. So the policy lives in the write
rule: `joinTeam` attempts the write and turns a refusal into a sentence.
`test/rules/teams.test.mjs` pins the denial, so nothing reintroduces a dependency
on a read that cannot succeed.

## Uploads

The registration form uploads the résumé **before the account exists**, so
`storage.rules` allows an unauthenticated write on that path, capped at 5 MB and
document types ([ADR 0006](decisions/0006-anonymous-resume-upload.md)). Pitch decks
need a signed-in member, with the uploader's uid in the path, because storage
rules cannot read the database to ask whether someone is on a team. For the same
reason they cannot see the submissions switch: a deck can be uploaded while
submissions are closed, but the submission that points to it is still refused.

A file's download URL carries its own access token, so **the link is the
secret**: anyone holding it can open the file, whatever the rules say.

## Versioning

The rules file starts with `// rulesVersion: N`. Bump it together with
`REQUIRED_RULES_VERSION` in `src/user/admin/eventReadiness.js` when the app comes
to depend on a rules change; `npm test` fails if the two disagree.

The deploy workflow publishes the rules on every release and records the number
at `config/rulesVersion`, because the app cannot read the deployed rules. The
dashboard compares it with `REQUIRED_RULES_VERSION` and shows a red warning until
they match. If you deploy the rules by hand, set `config/rulesVersion` yourself
(Control panel, Event setup, Advanced).

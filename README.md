# Idea X

Registration, check-in, team submission and judging for the HooHacks Ideathon.

React + Firebase Realtime Database, no server. **`database.rules.json` is the
only real authorization** — every role check in React is advisory.

---

## Quick start

```
npm install
npm run emulators        # terminal 1: database, auth, storage
npm run seed             # terminal 2: a plausible event
npm run start:emulator   # terminal 3: the app, on local data
```

Sign in as `admin@example.com` / `testtest`. Judges are `judge1@example.com`
upward, competitors `competitor1@example.com` upward, same password.

`npm start` (without `:emulator`) talks to the **live** project. Use it only
when you mean to.

| Command | Does |
| --- | --- |
| `npm run start:emulator` | app on local data |
| `npm run emulators` | database, auth, storage emulators |
| `npm run seed` | fill the emulator with an event |
| `npm run test:ci` | unit tests once — 43 suites, 910 tests, no JVM |
| `npm run test:rules` | rules executed against the emulator (needs JDK 17+) |
| `npm run test:e2e` | 45 browser journeys, desktop and phone (needs JDK 17+) |
| `npm run build` | production bundle |

`npm run seed` takes `--teams`, `--judges`, `--rooms`, `--batches`, `--scores`,
`--schedule`. It only ever writes to the emulator.

Two things that will confuse you:

- **Seeding recreates every account.** A tab that was signed in holds a
  credential for a uid that no longer exists. Sign in again.
- **Seed at least 8 teams** to exercise the final round. Below about six, every
  judge sees every team in round one, so all are excluded from the final and
  activation produces no assignments. That is the data, not a bug.

---

## Before sign-ups open

The site goes live weeks before the event, so registration and sign-in are
**closed by default** — a build with nothing set produces a closed site.

Both public forms and the login page become a "not open yet" page.
**`#/login?staff`** still reaches the sign-in form, so organizers can work.

**Organizers who need an account** use **`#/judge-registration?staff`**, which
reaches the judge and mentor form while the doors are shut. An organizer is a
judge record with the admin flag set on top, so that is the form they want; an
existing organizer then grants admin from the control panel. The competitor
form has no staff entrance, deliberately.

The very first organizer is the exception, because writing `/admins` requires
being an admin already. Bootstrap that one by hand: Firebase console →
Authentication → add a user, then Realtime Database → `admins/{uid}: true`.

**To open it:** set the repository variable `REGISTRATION_OPEN` to `true`
(Settings → Secrets and variables → Actions → Variables), then run Deploy. No
code change. The deploy summary says which way the doors are.

It is a build-time flag (`src/registrationWindow.js`), not a `config` key: the
rules grant `config` to `auth != null`, so a logged-out visitor could never read
one. It hides the forms; it is **not security**. Someone who forced an account
into existence would hold no role and see nothing.

## First-time Firebase setup

Only needed once per project.

1. Enable **Email/Password** auth.
2. Publish `database.rules.json` (Realtime Database → Rules).
3. Publish `storage.rules`. Without it, resume and pitch deck uploads fail.
4. **Create the first admin by hand.** Register an account, copy its uid from
   the Authentication tab, then add `admins/<uid>: true` in the database.

Step 4 cannot be done in the app: writing `/admins` requires already being an
admin.

---

## Running the event

Everything below is in the app. You should not need the Firebase console.

### The two public pages

Neither needs a login, and neither is linked from anywhere in the app. Send the
URL. **The app is a HashRouter, so routes live after a `#`.**

| Page | Send them |
| --- | --- |
| Competitor registration | `https://hoohacks.github.io/idea-x/` |
| Judge and mentor sign-up | `https://hoohacks.github.io/idea-x/#/judge-registration` |

A path-shaped URL without the `#` used to serve the **competitor** form — an
empty hash matches `/`. `src/hashRedirect.js` and `public/404.html` now rewrite
it, so both work; the `#` one is still the one to send.

Judge sign-up creates the account and the `/judges/{uid}` record. It does **not**
mark them a first-round judge — a judge cannot grant themselves that, since the
score rules treat an assignment as proof of assignment. Mark them in People and
roles, or Judge Search, when they turn up.

### Before the day

| Do | Where |
| --- | --- |
| Add the rooms you booked | Control panel → Judging rooms |
| Set batch count, times, final round room | Control panel → Judging schedule |
| Set the event date | Control panel → Event |
| Add admins, judges, competitors | Control panel → People and roles |
| Mark first-round judges | People and roles, or Judge Search |

Judging rooms have **no built-in list**. Add them or building a plan refuses.

### On the day

The dashboard at `/user/home` tracks this for you: it shows which phase the
event is in, what is not ready with the real number beside it, and the two or
three things worth doing next.

1. Check people in with the scanner, or in bulk from People and roles.
2. **Plan schedule** → build, review, hand-edit, **Publish**.
3. Judges score from their assignment cards.
4. Watch **Judging progress** — teams with no scores sort to the top in red.
5. **Plan final round** → build the cut, fix the order and panels, **Publish**.
6. **Results** (`/user/admin/results`) ranks the final round and names a winner
   once every expected card is in — not before.

Scoring is out of 40: problem, innovation and impact are worth 10 each,
viability and pitch quality 5 each. `fundable` is a tally, not a score.

**Room sheets** (`/user/admin/print`, linked from Judging progress) print one
page per room — batch, time, team, panel, and a blank score column — for when
the wifi gives out.

### When something goes wrong

| Problem | Do this |
| --- | --- |
| A judge did not turn up | **Judges** on the team row → add or swap. Rewrites one team, not the schedule. Spares first. |
| A team or room name is wrong | **Edit** on the Teams dashboard, or Control panel → Judging rooms. The name is cached in several places; renaming rewrites all of them. |
| A judge scored on paper | **Record score** on the team row. Filed under them, stamped with you. |
| A judge says they submitted, nothing shows | Ask if their card says "Saved on device". Queued scores send on reconnect — the page must stay open. **Retry now** forces it. |
| A team submitted after the schedule was published | Open the team on the Teams dashboard → pick batch, room and judges. **Do not publish a new schedule** — that replaces every assignment and strands collected scores. |
| A team submitted while a plan is open, unpublished | Publish catches it as drift and offers **Place**. |
| A team has no scores, time is short | Assign a spare judge, or record the score yourself. |
| Scores from an unassigned judge | Expected after republishing. They still count, so Judging progress lists them. |
| You published a bad schedule or cleared it | Control panel → **Restore points**. |
| You want a copy of everything | Control panel → **Export**. |

---

## The control panel

`/user/admin/control`, in four tabs. The tab is in the URL (`?tab=recovery`), so
a readiness check can link straight to the section that fixes it.

| Tab | Sections |
| --- | --- |
| Event setup | judging rooms; batch count and times; final round room; event date; write any config key |
| People | roles, accounts, password resets, bulk check-in, delete |
| Data and activity | exports; recent activity, with undo |
| Recovery | restore points; danger zone (clear the schedule, optionally with every score) |

Per-record editing lives on the Competitors, Judges and Teams dashboards
(**Edit** on each row).

### People and roles

A role is membership of a node: `/judges/{uid}` or `/competitors/{uid}`. **One
account holds exactly one of them**, picked from the dropdown on each row.

**Admin is a flag on top, not one of them.** `/admins/{uid}` is `true` and
nothing else, with its own switch. It has to sit on top: an admin who judges
needs the judge record, because being scheduled, seeing cards and filing a score
under your own name all key off it.

Changing a role deletes the old record and creates the new one, carrying name,
email and company across. The confirmation names what goes with it — their team,
resume, assignments, round-one mark. Scores are kept. **The deleted record is
archived** to `/archive/people/{uid}/{ts}-{role}` in the same write, and
**History** on the row puts it back.

Accounts predating this hold more than one role; their dropdown reads
**Multiple — pick one** until you choose.

Two limits are real, and shown in the UI:

- **Deleting someone does not delete their login.** A browser cannot delete a
  Firebase Auth account. They can still sign in and will see an account with no
  role. Remove it in the console if it matters.
- **You cannot set a password.** Send a reset email instead.

Moving someone off judge also clears them from every schedule card and from the
final round exclusions. Deleting the last admin is refused.

### Restore points

Two recovery mechanisms, for different sizes of mistake.

| | Recent activity undo | Restore points |
| --- | --- | --- |
| Holds | one field, inside the log entry | whole subtrees, at `/snapshots` |
| For | a wrong room, name or flag | a bad publish, a wipe, an activation |
| Limit | drops the before-state past 50 KB | none at event scale |
| On drift | refuses, naming the path | overwrites |

One is taken automatically before publishing a schedule, activating the final
round, and anything in the danger zone — and the action is **abandoned** if it
cannot be written. Restoring saves the current state first. Fifteen are kept.

Restoring **overwrites**: anything written since, including scores submitted in
the meantime. It is not a merge.

---

## Judging supply

A judge visits at most one team per batch, so the largest batch —
`ceil(teams / batches)` — sets both limits.

| Rooms | Max teams (3 batches) | Min judges | Judges for a panel of 3 |
| --- | --- | --- | --- |
| 8 | 24 | 8 | 24 |
| 12 | 36 | 12 | 36 |
| 20 | 60 | 20 | 60 |

**Max teams = rooms × batches.** Nothing else caps you.

- **Too few judges** — building refuses and names both fixes: mark more, or
  raise the batch count so fewer teams present at once.
- **Too many judges** — panels cap at 3 (`config/targetJudgesPerTeam`); the rest
  become spares, rotated so a different group sits out each batch.
- **Batches that do not divide evenly** are the thing to avoid. With 20 teams
  over 3 batches (7/7/6), the smaller batch draws from a better ratio. Building
  says so and names a batch count that divides evenly.

The allocator (`src/user/judge/schedulePlan.js`) guarantees, for every
schedulable event: no judge in two rooms at once, no team without a judge,
panels within a batch differing by at most one, nobody idle while a team is
below target, and judges reshuffled between batches. Asserted across 1–60 teams
× 1–40 judges × 2/3/4/5 batches.

---

## Planning a schedule

`/user/admin/schedule`, also **Plan schedule** on the Judging page.

Build a plan (writes nothing) → review the grid of batches × rooms with live
stats above it → hand-edit → **Publish**, which takes a restore point and writes
every assignment in ONE atomic update.

The draft lives at `/scheduleDraft`, so it survives a reload and two admins see
each other's edits. **Undo** walks edits back to what the build produced.

Publishing requires typing a confirmation phrase whenever a schedule might
already exist: `config/eventName` if set, the team count otherwise. Set the event
name once and everyone types something readable.

**Publish refuses on drift** and offers a targeted repair rather than a rebuild:

| What moved | What you get |
| --- | --- |
| a team submitted since the plan was built | **Place** it into a named free slot |
| a team withdrew | **Drop** it from the plan |
| a judge on a panel lost their round-one mark | **Remove** them |
| a room the plan uses was removed | **Place** that team into a free room in the same batch |
| batch count or panel target changed | **Rebuild** — the shape of the day changed |

**A hand-edited plan no longer carries the allocator's guarantees.** Panel
balance and rotation are properties of a *generated* plan. Read the stats bar for
what the plan actually is.

## Planning the final round

The Final round tab on the same page, or **Plan final round** on Judging.

Build ranks every submitted team on its first-round average, cuts the top
`config/finalRoundSize` (default 4), and prefills each panel with every eligible
judge who did **not** score that team in round one. Correct the running order and
the panels, then publish.

The draft lives at `/finalRoundDraft`. **A judge who scored a team in round one
cannot judge it again** — the editor does not offer them and the edit is refused.

| What moved | What you get |
| --- | --- |
| any ranked team scored since the build | **Re-rank** — the averages the cut came from have moved |
| a finalist withdrew | **Drop** it |
| a judge is no longer a checked-in round-one judge | **Remove** them |
| the final round room changed | **Apply** it — advisory |

---

## Schema

```
/admins/{uid}              true
/config                    judgingRooms[] batchCount batchTimes eventStart
                           finalRoundRoom finalRoundSize rulesVersion eventName
/competitors/{uid}         name, email, major, checkedIn, foodCheckIn, teamId, …
/judges/{uid}              name, email, company, checkedIn, isRound1Judge, …
                           teamAssignments/{teamId}   room time batch judges[]
                           finalAssignments/{teamId}  room timeslot
/teams/{teamId}            name createdBy submitted
                           members/{uid}   true
                           submission      ideaName problemStatement deck…
                           schedule        room time batch judges[]
                           finalSlot       room timeslot
/scores/{round}/{teamId}/{judgeUid}   the rubric, judgeUid, enteredBy, notes
/finalRound                active, teams/{id} (standings), archive/{ts}
/scheduleDraft             the in-progress schedule. Deleted on publish
/finalRoundDraft           the in-progress final round. Deleted on publish
/adminLog/{entryId}        what changed, with before and after
/snapshotIndex, /snapshots restore points
/archive/people/{uid}/{ts}-{role}   a role record deleted by a role change
```

The drafts and `/archive` get **no rule of their own** — they inherit the
admin-only root grant, and `src/schema.test.js` asserts they stay that way.

Four decisions worth knowing:

**Sets are keyed, never arrays.** Rules match a child *key*, and `hasChild()`
cannot see into an array.

**The schedule is written twice.** Once on the team, once per judge, in one
atomic update. A judge cannot read `/teams`, so they need their own copy.

**Scores live at `/scores`, not under the team.** Rules cascade and cannot be
revoked deeper — a team member's read on their own team would otherwise reach
the judges' notes.

**`judgeUid` is whose card it is; `enteredBy` is who typed it.** `enteredBy` is
pinned to `auth.uid` for everyone except admins, which is what lets a restore put
a card back with its original author.

### Denormalised copies

A judge cannot read `/teams` and a competitor cannot read the standings, so
several values are stored more than once. The rules are not the same:

| Value | Rule |
| --- | --- |
| Team name | **fanned out** on rename — schedule, both sets of judge cards, standings |
| Room | **fanned out** on rename and remap — schedule, `finalSlot`, both sets of cards, standings |
| A team's existence | **fanned out** on delete, standings included |
| Judge name | **not** fanned out — every reader resolves from the judge record and treats the cached name as a fallback |

`finalRound/archive` is never rewritten. It records what the standings were when
the round closed.

---

## Database rules

`database.rules.json` is the only real authorization. Paste it into the console,
or `firebase deploy --only database`. **Nothing deploys it for you.**

`npm test` fails if the rules change without bumping `// rulesVersion:` — that
failure is the reminder to republish. Current version: **5**.

| Actor | Can |
| --- | --- |
| anyone signed in | read their own record, `config`, `finalRound/active`, any team's `name` |
| competitor | edit own record except check-in; create a team; join or leave one that has **not** submitted; read and write their own team's submission |
| judge | read own record and assignments; read submissions for assigned teams; write and read back their own scores |
| admin | everything, via the root rule |

- A judge cannot set their own `isRound1Judge`, `checkedIn` or assignments. That
  last is load-bearing: the score rules treat an assignment as proof of one.
- A judge can revise a score but not delete one.
- Nobody but an admin can read the standings.
- **There is no team size cap in the rules, and there cannot be.**
  `numChildren()` is a client SDK method, and a rule calling it stops the whole
  file loading. `MAX_TEAM_SIZE` is advisory.

**Joining a team** is the sharp edge. Only `teams/{id}/name` is readable by
somebody who is not yet a member — and that is exactly who is joining. So the
policy lives in the write rule, and `joinTeam` attempts the write and turns a
refusal into a sentence. `test/rules/teams.test.mjs` pins the denial so nothing
re-introduces a dependency on a read that cannot succeed.

---

## Testing

| Layer | Runs | Blind to |
| --- | --- | --- |
| Pure logic | the arithmetic, no I/O | the database and the screen |
| Service tests | the shape of each write, database mocked | **permission denials — every read succeeds** |
| Render smoke | each page in jsdom | **layout: jsdom has no viewport** |
| `test:rules` | the real rules engine, as different users | the app |
| `test:e2e` | a real browser, real rules, real routing | nothing above it, but slow |

Three bugs shipped because of the two "blind to" rows: joining a team failed on
a read the rules always refuse; the planner stacked two full-height page frames
so its content sat below the fold; the room sheets had no link to them.

The browser suite covers both public forms, joining a team and submitting a
pitch, a judge scoring, publishing a schedule through its typed confirmation,
the final round end to end, restore points, and the control panel's mutating
controls. It runs twice: **desktop** and **mobile** (Pixel 5), where the phone
specs assert there is no sideways scroll.

Four habits it taught, each learned by getting it wrong:

- **Scope every locator to its section** — a page-wide `"Admin"` matched the
  nav's dropdown.
- **Wait for the page to settle, do not probe it** — `isVisible()` on an
  unrendered control returns false and the step is silently skipped.
- **An input's value is not text on the page** — `toHaveValue`, not `getByText`.
- **Give each scoring spec its own judge** — a card cannot be scored twice, and
  sharing one lets an assertion pass on some other spec's work.

`test:e2e` runs the app on port **3010**, never reusing an existing server:
Playwright's default would adopt whatever dev server is running, and if that one
was not in emulator mode the specs would sign in against the **live project**.

**The emulator namespace is `demo-ideathon-default-rtdb`** — pinned in
`src/firebase.js`, `scripts/seed-event.mjs` and `e2e/helpers.mjs`. It must be the
project's *default instance*: `emulators:exec` applies the rules to that
namespace and no other, and any other is created wide open. This was wrong for a
long time, so local development enforced no authorization at all — which is
exactly how the join bug survived. Fixtures written over REST now need
`Authorization: Bearer owner`.

On Windows, `firebase emulators:exec` sometimes leaves its Java process holding
port 9000 and the next run fails with "port taken". Kill it and re-run.

---

## Judge resilience

Judges need no instructions — their side degrades on its own:

- every keystroke is drafted to the device
- a submit that cannot reach the database is queued, not lost
- a hung write times out after eight seconds
- the queue survives a refresh and drains on reconnect, and the cards are re-read
  when it does

The pitch form is seeded from the database **once per team**, not on every
snapshot — it is a live subscription, and re-seeding overwrote whatever the
person was typing whenever a teammate joined.

One caveat: **a queued score only syncs while that page is open.** If a judge
closes the tab, the card sits on their device and Judging progress shows the team
as unjudged. The browser's leave warning is armed whenever something is queued,
and only then.

---

## Deploying

Served from `gh-pages` at `hoohacks.github.io/idea-x`.

**Publishing a GitHub Release deploys.** Merging to `main` does not. CI runs on
**pull requests only** — a direct push to main runs nothing, so merging through a
PR is what keeps that from being a gap. Both workflows take `workflow_dispatch`
for when something must go out now.

1. Open a PR, let CI go green, merge.
2. If `database.rules.json` changed, publish it in the console.
3. If `storage.rules` changed, publish it. Nothing checks this one, and
   forgetting it silently breaks uploads.
4. Publish a release.

**Pages URLs do not redirect on rename.** The old `/ideathon-registration/` and
`/IdeaX/` addresses are hard 404s.

---

## Migrations

Two one-time migrations. Run them only against a database that predates them.

```
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/migrate-team-members.mjs
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/migrate-scores.mjs
```

Both are dry-run by default; add `--apply`. `migrate-scores` writes a timestamped
backup to `scripts/backups/` (gitignored — it holds judges' notes) and reverses
with `--rollback <file> --apply`.

**Read the dry run.** Each migration is one atomic update, so a single malformed
record rejects all of it, and Realtime Database reports `PERMISSION_DENIED` for
the lot.

The app reads scores only from `/scores`. On a database that predates
`migrate-scores`, cards under `teams/{id}/scores` count for nothing until they
are moved — the control panel blocks the event and counts the teams affected.

---

## Notes

**Anonymous resume upload.** The registration form uploads the resume before the
account exists, so `storage.rules` allows one unauthenticated write on that path.
Capped at 5 MB and document content types.

**Autofill.** Chrome writes saved profiles into the DOM before React attaches its
listeners, so a controlled form can look full and still refuse to submit.
`src/formKit.js` re-reads the fields on mount, on the `onAutofill` keyframe, on
first focus, and before submitting. If you rename that keyframe, rename it in
`index.css` too.

**The root `CNAME` is inert** — its value contains a path and it sits outside
`public/`, so the build never copies it.

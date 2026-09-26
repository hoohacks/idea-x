# Running the event

Everything here is done in the app. You should not need the Firebase console
once the project is set up (see [deployment](deployment.md)).

The organizer dashboard at `/user/home` tracks the day for you: which phase the
event is in, what is not ready yet with the real number beside it, and the two or
three things worth doing next.

## The public pages

Neither needs a login, and neither is linked from inside the app. Send people the
URL. The app uses hash routing, so routes live after a `#`.

| Page | Send them |
| --- | --- |
| Competitor registration | `https://hoohacks.github.io/idea-x/` |
| Judge and mentor sign-up | `https://hoohacks.github.io/idea-x/#/judge-registration` |

A path-shaped URL without the `#` is rewritten to the right page, but the `#` one
is the one to send.

Judge sign-up creates the account and the judge record. It does **not** mark
anyone a first-round judge: a judge cannot grant themselves that. Mark them in the
control panel's People tab, or on the Judges page, when they turn up.

## Before sign-ups open

Registration and sign-in are **closed by default**, because the site goes live
weeks before the event. While closed, both forms and the login page show a "not
open yet" page, and two staff entrances still work:

- `#/login?staff` reaches the sign-in form.
- `#/judge-registration?staff` reaches the judge form, for organizers who need an
  account. An organizer is a judge record with the admin flag on top; an existing
  organizer grants admin from the control panel.

Opening registration is a deploy setting, not an in-app switch. See
[deployment](deployment.md#opening-registration).

## Before the day

| Do | Where |
| --- | --- |
| Add the rooms you booked | Control panel, Event setup, Judging rooms |
| Set batch count, batch times and the final round room | Control panel, Event setup |
| Set the event date | Control panel, Event setup, Event |
| Optionally set a submission deadline | Control panel, Event setup, Event |
| Add admins, judges and competitors | Control panel, People |
| Mark first-round judges | Control panel, People, or the Judges page |

Judging rooms have **no built-in list**. Add them, or building a schedule refuses.

**Project submissions stay closed until you open them.** Teams can form, invite
people and share their Team ID the whole time; the team page tells them the form
arrives on the day, and that they can find teammates on the day too. This stops
an early "submit" from closing a team (a submitted team takes no new members)
before a friend registers.

## On the day

1. **Check people in** with the scanner, or in bulk from People.
2. **Open submissions**: Control panel, Event, Project submissions. The form
   appears on every team page straight away, with no reload.
3. If you set a deadline, teams see a countdown, then a warning in the last half
   hour. At the deadline the form closes by itself. The Teams page's **Not
   submitted** filter is the list to chase, with each team's members.
4. **Plan the schedule**: build, review, hand-edit, publish. See
   [judging](judging.md#planning-a-schedule).
5. Judges score from their assignment cards.
6. Watch **Judging progress**. Teams with no scores sort to the top.
7. **Plan the final round**: build the cut, fix the order and panels, publish.
8. **Results** (`/user/admin/results`) ranks the final round and names a winner
   once every expected card is in, not before.

**Announcements** are how you tell the room something: "Lunch is in the atrium",
"Rice 340 has moved to 342". Post one from the dashboard to everyone,
competitors or judges. It shows at the top of every signed-in page for those
people, live, until you take it down. Readers can dismiss one in their own
browser.

**Room sheets** (`/user/admin/print`, linked from Judging progress) print one page
per room, with batch, time, team, panel and a blank score column, for when the
wifi gives out.

## When something goes wrong

| Problem | Do this |
| --- | --- |
| A judge did not turn up | **Judges** on the team's row in Judging progress, then add or swap. It rewrites one team, not the schedule. Use spares first. |
| A team or room name is wrong | **Edit** on the Teams page, or Control panel, Judging rooms. The name is cached in several places; renaming rewrites all of them. |
| A judge scored on paper | **Record score** on the team's row. It is filed under the judge and stamped with you. |
| A judge says they submitted but nothing shows | Ask whether their card says "Saved on device". Queued scores send when the connection returns, while the page is open. **Retry now** forces it. |
| A team missed the deadline | Enter their submission from **Edit** on the Teams page. Organizers are not bound by the switch or the deadline. |
| A team submitted after the schedule was published | Open the team on the Teams page and pick a batch, room and judges. **Do not publish a new schedule**: that replaces every assignment and strands scores already collected. |
| A team submitted while a plan is open but unpublished | Publishing catches it and offers **Place**. |
| A team has no scores and time is short | Assign a spare judge, or record the score yourself. |
| Scores from an unassigned judge | Expected after republishing. They still count, so Judging progress lists them. |
| You published a bad schedule, or cleared it | Control panel, Recovery, **Restore points**. |
| You need a door list, catering numbers or resumes | Control panel, Data and activity, **Export**, Competitors. Print it before doors open. |
| You want a copy of everything | Control panel, Data and activity, **Export**. |

## Scoring

Each card is out of 40: problem, innovation and impact are worth 10 each, and
viability and pitch quality 5 each. "Worth funding?" is a tally, not part of the
score.

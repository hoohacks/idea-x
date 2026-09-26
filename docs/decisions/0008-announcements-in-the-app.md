# 0008. Announcements are shown in the app

Status: accepted

## Context

On the day, organizers need to reach people quickly: a room change, lunch,
a deadline. There is no server, so there is nothing to send email or push
notifications from.

## Decision

Organizers post announcements to `/announcements`, addressed to everyone,
competitors or judges. They show at the top of every signed-in page through a
live subscription, until taken down, and readers can dismiss them in their own
browser.

## Consequences

- It reaches only people with the app open, which on the day is most of them.
- Anyone signed in can read every announcement, whichever audience it is
  addressed to; the audience only decides where it is shown. Nothing secret goes
  in an announcement.
- Posts and takedowns go through the activity log, so they can be undone.

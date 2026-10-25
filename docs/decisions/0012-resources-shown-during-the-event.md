# 0012. Resources are shown during the event

Status: accepted

## Context

Organizers want to hand competitors the judging rubric and pitching advice on
the day, without it getting lost in a chat or an announcement that gets
dismissed.

## Decision

Organizers post link cards to `/resources`: a title, an https link and an
optional description. Competitors see all of them on their home page, in the
order organizers set; judges see only those marked for judges. They show from
the start of the event until the end of that day, or earlier when an organizer
switches on "Show now".

## Consequences

- Links only, no uploads. Host the file on Drive and post the link.
- Anyone signed in can read the links whenever; the window and the judges flag
  decide what is shown, not who may read. Nothing secret goes in a resource.
- Adds, edits and removals go through the activity log, so they can be undone.

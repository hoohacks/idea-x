# 0010. Two recovery mechanisms: undo and restore points

Status: accepted

## Context

Organizer mistakes come in two sizes: a wrong room or flag, and a bad schedule
publish or a wipe. One mechanism sized for the second is clumsy for the first, and
one sized for the first cannot hold the second.

## Decision

Every admin action records its before and after in `/adminLog`, and can be
undone from there if nothing has changed since. Before large actions (publishing
a schedule, activating the final round, the danger zone) a restore point of the
affected subtrees is written to `/snapshots`, and the action is abandoned if it
cannot be.

## Consequences

- Undo is precise and refuses if the data moved, naming the path.
- Restoring overwrites everything since, including scores submitted in the
  meantime. It is not a merge, and the UI says so.
- Undo entries larger than 50 KB drop their before-state; those actions rely on
  restore points instead.

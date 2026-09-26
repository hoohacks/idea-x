# Control panel

`/user/admin/control`, in four tabs. The tab is in the URL (`?tab=recovery`), so a
readiness check on the dashboard can link straight to the section that fixes it.

| Tab | Sections |
| --- | --- |
| Event setup | Judging rooms; batch count and times; final round room; event start; project submissions switch and deadline; Advanced (write any `config` key) |
| People | Roles, admin access, accounts, password resets, bulk check-in, delete |
| Data and activity | Exports; recent activity, with undo |
| Recovery | Restore points; danger zone (clear the schedule, optionally with every score) |

Per-record editing lives on the Competitors, Judges and Teams pages (**Edit** on
each row). Announcements are posted from the dashboard at `/user/home`.

## People and roles

A role is membership of a node: `/judges/{uid}` or `/competitors/{uid}`. **One
account holds exactly one of them**, picked from the role dropdown on each row.

**Admin is a flag on top, not a role.** `/admins/{uid}` is `true` and nothing else,
with its own switch. It has to sit on top: an admin who also judges needs the
judge record, because being scheduled, seeing cards and filing a score under your
own name all key off it.

Changing a role deletes the old record and creates the new one, carrying name,
email and company across. The confirmation names what goes with it: their team,
resume, assignments and round-one mark. Scores are kept. **The deleted record is
archived** to `/archive/people/{uid}/{ts}-{role}` in the same write, and
**History** on the row puts it back.

Accounts from before this rule can hold more than one role; their dropdown reads
**Multiple, pick one** until you choose.

Two limits are real, and shown in the UI:

- **Deleting someone does not delete their login.** A browser cannot delete a
  Firebase Auth account. They can still sign in, and will see an account with no
  role. Remove it in the console if it matters.
- **You cannot set a password.** Send a reset email instead.

Moving someone off judge also clears them from every schedule card and from the
final round exclusions. Deleting the last admin is refused.

## Undo and restore points

Two recovery mechanisms, for different sizes of mistake.

| | Recent activity undo | Restore points |
| --- | --- | --- |
| Holds | the change itself, inside its log entry | whole subtrees, at `/snapshots` |
| For | a wrong room, name, flag or announcement | a bad publish, a wipe, an activation |
| Limit | drops the before-state past 50 KB | none at event scale |
| If the data moved since | refuses, naming the path | overwrites it |

A restore point is taken automatically before publishing a schedule, activating
the final round, and anything in the danger zone, and the action is **abandoned**
if the restore point cannot be written. Restoring saves the current state first.
Fifteen are kept.

Restoring **overwrites** everything written since, including scores submitted in
the meantime. It is not a merge.

See [ADR 0010](decisions/0010-two-recovery-mechanisms.md) for why there are two.

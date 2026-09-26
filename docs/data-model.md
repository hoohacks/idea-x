# Data model

Everything lives in one Firebase Realtime Database tree.

```
/admins/{uid}              true
/config                    judgingRooms[] batchCount batchTimes eventStart eventName
                           finalRoundRoom finalRoundSize targetJudgesPerTeam
                           submissionsOpen submissionsCloseAt rulesVersion scheduleMeta
/competitors/{uid}         name, email, major, school, dietary, resume,
                           checkedIn, foodCheckIn, teamId
/judges/{uid}              name, email, company, checkedIn, isRound1Judge,
                           isFinalRoundJudge
                           teamAssignments/{teamId}   room time batch judges[]
                           finalAssignments/{teamId}  room timeslot
/teams/{teamId}            name createdBy submitted
                           members/{uid}   true
                           submission      ideaName problemStatement targetIndustry pitchDeck…
                           schedule        room time batch judges[]
                           finalSlot       room timeslot
/scores/{round}/{teamId}/{judgeUid}   the rubric, judgeUid, enteredBy, notes
/finalRound                active, teams/{id} (standings), archive/{ts}
/announcements/{id}        text audience postedAt active
/scheduleDraft             the schedule being planned; deleted on publish
/finalRoundDraft           the final round being planned; deleted on publish
/adminLog/{entryId}        what changed, with before and after
/snapshotIndex, /snapshots restore points
/archive/people/{uid}/{ts}-{role}   a role record removed by a role change
```

The drafts and `/archive` have **no rule of their own**: they inherit the
admin-only root grant, and `src/schema.test.js` asserts they stay that way.

## Config keys worth knowing

| Key | Means |
| --- | --- |
| `submissionsOpen` | `true` lets teams submit. Absent means closed. |
| `submissionsCloseAt` | Optional deadline, as epoch milliseconds, compared with the server's clock by the rules |
| `eventStart` | Overrides the start date compiled into `src/eventInfo.js`, so the date can move without a deploy |
| `eventName` | The phrase typed to confirm publishing over an existing schedule |
| `targetJudgesPerTeam`, `finalRoundSize` | Panel size (default 3) and finalists (default 4) |
| `rulesVersion` | The rules version an organizer says is published; see [security rules](security-rules.md#versioning) |

Keys without a screen of their own are set from Control panel, Event setup,
Advanced, which checks the type of the known ones.

## Decisions baked into the shape

- **Sets are keyed, never arrays** ([ADR 0002](decisions/0002-keyed-sets-not-arrays.md)).
- **Scores live at `/scores`, not under the team** ([ADR 0003](decisions/0003-scores-live-outside-teams.md)).
- **The schedule is written twice**, once on the team and once per judge, in one
  atomic update ([ADR 0004](decisions/0004-denormalise-for-readers-who-cannot-read-the-source.md)).
- **`judgeUid` is whose card it is; `enteredBy` is who typed it.** `enteredBy` is
  pinned to the signed-in user for everyone except admins, which is what lets a
  paper score be filed under the judge, and a restore put a card back with its
  original author.

## Values stored more than once

A judge cannot read `/teams` and a competitor cannot read the standings, so some
values are copied to where their readers can see them. Each copy has a rule:

| Value | Rule |
| --- | --- |
| Team name | **Fanned out** on rename: schedule, both sets of judge cards, standings |
| Room | **Fanned out** on rename and remap: schedule, `finalSlot`, both sets of cards, standings |
| A team's existence | **Fanned out** on delete, standings included |
| Judge name | **Not** fanned out: every reader resolves it from the judge record, and treats the cached name as a fallback |

`finalRound/archive` is never rewritten. It records what the standings were when
the round closed.

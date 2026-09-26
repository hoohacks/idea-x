# Architecture decision records

Short notes on choices that look odd until you know why they were made. Each
says what prompted it, what was decided, and what that costs.

To add one, copy the shape of an existing record, give it the next number,
and link it here. Records are not rewritten when a decision changes; a new
one supersedes the old and says so.

| # | Decision |
| --- | --- |
| 0001 | [The database rules are the only authorization](0001-rules-are-the-only-authorization.md) |
| 0002 | [Sets are keyed, never arrays](0002-keyed-sets-not-arrays.md) |
| 0003 | [Scores live at /scores, not under the team](0003-scores-live-outside-teams.md) |
| 0004 | [Copy values to readers who cannot read the source](0004-denormalise-for-readers-who-cannot-read-the-source.md) |
| 0005 | [The registration window is a build-time flag](0005-registration-window-is-a-build-flag.md) |
| 0006 | [Résumés upload before the account exists](0006-anonymous-resume-upload.md) |
| 0007 | [Submissions stay closed until organizers open them](0007-submissions-closed-until-opened.md) |
| 0008 | [Announcements are shown in the app](0008-announcements-in-the-app.md) |
| 0009 | [No custom domain](0009-no-custom-domain.md) |
| 0010 | [Two recovery mechanisms: undo and restore points](0010-two-recovery-mechanisms.md) |
| 0011 | [Hash routing on GitHub Pages](0011-hash-routing.md) |

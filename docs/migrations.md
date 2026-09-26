# Migrations

Two one-time migrations. Run them only against a database that predates them.

```
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/migrate-team-members.mjs
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/migrate-scores.mjs
```

| Script | Moves |
| --- | --- |
| `migrate-team-members` | team members from an array to a keyed set ([ADR 0002](decisions/0002-keyed-sets-not-arrays.md)) |
| `migrate-scores` | score cards from `teams/{id}/scores` to `/scores` ([ADR 0003](decisions/0003-scores-live-outside-teams.md)) |

Both are dry runs by default; add `--apply`. `migrate-scores` writes a timestamped
backup to `scripts/backups/` (gitignored, because it holds judges' notes) and
reverses with `--rollback <file> --apply`.

**Read the dry run.** Each migration is one atomic update, so a single malformed
record rejects all of it, and Realtime Database reports `PERMISSION_DENIED` for
the lot.

## Moving scores off the team node

The rules and the client are coupled here: the write path itself moves, so there
is no order in which old-client/new-rules and new-client/old-rules both work. The
cutover runs through a temporary ruleset that permits both locations.

1. `npm run rules:cutover` writes `database.rules.cutover.json`. Publish it: both
   locations are now writable.
2. Ship the new build.
3. `npm run rules:cutover -- --freeze` and publish that: the old path becomes
   read-only. Without this, a judge who submits between the migration's read and
   its write has their card silently lost.
4. Run `migrate-scores` with `--apply`.
5. Publish the real `database.rules.json`, and delete the generated file.

The app reads scores only from `/scores`. On a database that predates the move,
cards under `teams/{id}/scores` count for nothing until they are moved, and the
dashboard blocks the event and counts the teams affected.

/**
 * What a restore point would change, computed against the live database.
 *
 * Restoring OVERWRITES -- it is not a merge. Everything currently under a
 * restored path that the snapshot does not also hold is gone, including any
 * score a judge filed since the snapshot was taken. This is the "before"
 * half of that: the counts an organizer sees while the destructive click is
 * still undecided, not the summary they get afterward.
 *
 * PURE by design: no database, no React, so it can be pinned with plain
 * fixtures. `entries` mirrors what `snapshots.js` actually stores -- each
 * value is a JSON STRING, not a parsed value, because Realtime Database
 * drops nulls on write. A path that did not exist when the snapshot was
 * taken is encoded as the literal string "null", and `JSON.parse("null")`
 * correctly comes back as `null` -- there is no special case for that below,
 * the ordinary "not an object, so it has no keys" handling already does the
 * right thing: everything live under that path shows up as removed.
 */

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Snapshot vs. live, from the snapshot's point of view: "added" is a key the
 * snapshot has that live does not (restoring adds it back); "removed" is a
 * key live has that the snapshot does not (restoring removes it); "changed"
 * is a key both have with a different value.
 */
function diffKeys(snapshotValue, liveValue) {
  const snapshotObj = asObject(snapshotValue);
  const liveObj = asObject(liveValue);

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const key of Object.keys(snapshotObj)) {
    if (!(key in liveObj)) {
      added++;
    } else if (JSON.stringify(snapshotObj[key]) !== JSON.stringify(liveObj[key])) {
      changed++;
    }
  }
  for (const key of Object.keys(liveObj)) {
    if (!(key in snapshotObj)) removed++;
  }

  return { added, changed, removed };
}

const SCORES_ROOT = "scores";

function pairKey(teamId, judgeUid) {
  return `${teamId} ${judgeUid}`;
}

function roundPairKey(round, teamId, judgeUid) {
  return `${round} ${teamId} ${judgeUid}`;
}

/**
 * `{ teamId: { judgeUid: card } }` -> pairKey -> `{ teamId, judgeUid, card }`.
 * The card itself rides along so callers can tell a changed card from an
 * unchanged one, not just spot which team/judge pairs exist.
 */
function teamJudgeCards(value) {
  const cards = new Map();
  const teams = asObject(value);
  for (const teamId of Object.keys(teams)) {
    const judges = asObject(teams[teamId]);
    for (const judgeUid of Object.keys(judges)) {
      cards.set(pairKey(teamId, judgeUid), { teamId, judgeUid, card: judges[judgeUid] });
    }
  }
  return cards;
}

/**
 * The same map, for a path's raw value. The bare "scores" path -- what
 * `JUDGING_PATHS` actually snapshots -- is `{ round: { team: { judge: card } } }`,
 * one level deeper than a round-scoped path, so each round's cards are
 * collected here and re-keyed by round+team+judge before merging.
 *
 * The round has to be part of the key: a team+judge pair can appear in more
 * than one round, and now always does where a team reaches the final -- the
 * organizers judge both rounds. Keying by team+judge
 * alone (fine for a round-scoped path, which only ever has one round) would
 * let the second round processed silently overwrite the first round's entry
 * for that same pair, independently in both the snapshot map and the live
 * map -- so a card genuinely destroyed in one round could hide behind an
 * unrelated, unchanged card surviving in the other.
 *
 * A round-scoped path (e.g. "scores/first") is already team-first, has no
 * round to collide across, and is walked directly with `teamJudgeCards` --
 * its entries stay exactly `{ teamId, judgeUid }`, the shape the tests above
 * pin. Only the bare "scores" path's entries carry `round`, because only
 * there can two different cards share the same team+judge.
 */
function scoreCardMap(path, value) {
  if (path !== SCORES_ROOT) return teamJudgeCards(value);

  const cards = new Map();
  const rounds = asObject(value);
  for (const round of Object.keys(rounds)) {
    for (const { teamId, judgeUid, card } of teamJudgeCards(rounds[round]).values()) {
      cards.set(roundPairKey(round, teamId, judgeUid), { teamId, judgeUid, round, card });
    }
  }
  return cards;
}

function isScoresPath(path) {
  return path === SCORES_ROOT || path.startsWith(`${SCORES_ROOT}/`);
}

/**
 * Card-level counts for a scores-ish path, at the same team+judge
 * granularity as `lostScores` -- not the path's raw top-level keys, which
 * for the bare "scores" path are round names ("first"/"final") and would
 * make "changed" flip to 1 the moment a single card anywhere in a round
 * differs, telling an organizer nothing about how much is actually at
 * stake. `removed` here is deliberately the same set `lostScores` reports:
 * every card live now that the snapshot does not have is both "one line
 * removed from this path's count" and "one score card named below."
 */
function diffScoreCards(snapshotCards, liveCards) {
  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const [key, entry] of snapshotCards) {
    if (!liveCards.has(key)) {
      added++;
    } else if (JSON.stringify(entry.card) !== JSON.stringify(liveCards.get(key).card)) {
      changed++;
    }
  }
  for (const key of liveCards.keys()) {
    if (!snapshotCards.has(key)) removed++;
  }

  return { added, changed, removed };
}

/**
 * `diffSnapshot(entries, live)` -> `{ byPath, lostScores }`.
 *
 * `entries` is the snapshot's `[{ path, value }]`, `value` a JSON string.
 * `live` is `{ [path]: value }` with values already parsed -- what a caller
 * gets back from reading each of the snapshot's paths directly.
 *
 * `byPath` is per-path counts: for an ordinary path (teams, judges,
 * finalRound, config/scheduleMeta), that is the path's own top-level keys.
 * For a scores-ish path it is card-level instead (see `diffScoreCards`),
 * so the number means the same thing as `lostScores` rather than counting
 * rounds. `lostScores` walks every scores-ish path -- team then judge, with
 * the bare "scores" path's extra round level flattened first -- and names
 * every card that exists live right now and would not survive a restore. A
 * card in the snapshot but not live is not a loss: it is not there to
 * destroy.
 */
export function diffSnapshot(entries, live) {
  const byPath = [];
  const lostScores = [];

  for (const { path, value } of entries) {
    const snapshotValue = safeParse(value);
    const liveValue = live[path];

    if (isScoresPath(path)) {
      const snapshotCards = scoreCardMap(path, snapshotValue);
      const liveCards = scoreCardMap(path, liveValue);
      byPath.push({ path, ...diffScoreCards(snapshotCards, liveCards) });
      for (const [key, entry] of liveCards) {
        if (snapshotCards.has(key)) continue;
        // round-scoped entries have no `round` field -- keep them exactly
        // `{ teamId, judgeUid }`, the shape pinned above. Only the bare
        // "scores" path's entries carry it, since only there can two
        // different cards share the same team+judge.
        lostScores.push(
          "round" in entry
            ? { teamId: entry.teamId, judgeUid: entry.judgeUid, round: entry.round }
            : { teamId: entry.teamId, judgeUid: entry.judgeUid }
        );
      }
    } else {
      byPath.push({ path, ...diffKeys(snapshotValue, liveValue) });
    }
  }

  return { byPath, lostScores };
}

/**
 * The rubric, defined once.
 *
 * It used to exist twice in code — the selects in ScoreSubmission and
 * SCORE_FIELDS in finalRoundService — plus a third time as the .validate ranges
 * in database.rules.json. Two of those three are collapsed here; schema.test.js
 * holds this file and the rules together.
 *
 * Drift between them is not a loud failure. A criterion missing from the
 * aggregate is collected from judges and silently thrown away; a range wider
 * here than in the rules is a score the judge submits and the database rejects.
 */

export const RUBRIC = {
  problem: {
    label: "Problem",
    range: 10,
    desc: "Does the submission identify and describe an addressable need, want, problem or opportunity in society? Does it identify a target customer base?",
  },
  innovation: {
    label: "Innovation",
    range: 10,
    desc: "Does the submission present a novel, original and compelling solution? Does it describe the alternatives while making a compelling case for how their idea improves on them?",
  },
  impact: {
    label: "Impact",
    range: 10,
    desc: "Does the submission discuss the impact it will make, and how large? How strongly did it cover how stakeholders and potential users could benefit?",
  },
  viability: {
    label: "Viability",
    range: 5,
    desc: "Is the submission feasible, and how hard would it be to implement? How well did it address risks, cost, timeframe or measures of success?",
  },
  pitch_quality: {
    label: "Pitch quality",
    range: 5,
    desc: "How well did they present? Were they confident and professional? Did they have appropriate evidence to support their idea?",
  },
};

// Each criterion and the maximum a judge can award for it.
export const SCORE_FIELDS = Object.fromEntries(
  Object.entries(RUBRIC).map(([field, spec]) => [field, spec.range])
);

export const SCORE_MAX_TOTAL = Object.values(SCORE_FIELDS).reduce((a, b) => a + b, 0);

// The 2000 character cap the rules enforce on `notes`. Held here so the field
// can stop the judge at the limit rather than letting the write fail.
export const NOTES_MAX_LENGTH = 2000;

/**
 * Score one judge's card out of SCORE_MAX_TOTAL. Criteria are summed rather
 * than averaged so a 10 point criterion counts twice as much as a 5 point one,
 * which is what the differing ranges are for. Fields the judge did not fill in
 * are left out of both the total and the denominator, so an older card that
 * predates a criterion is not penalised for it.
 */
export function scoreCard(entry) {
  let earned = 0;
  let possible = 0;

  for (const [field, max] of Object.entries(SCORE_FIELDS)) {
    const raw = entry?.[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    earned += value;
    possible += max;
  }

  if (possible === 0) return null;
  return (earned / possible) * SCORE_MAX_TOTAL;
}

export function calculateAverageScore(scores = {}) {
  const entries = Object.values(scores ?? {});
  if (!entries.length) return null;

  const cards = entries.map(scoreCard).filter((value) => value !== null);
  if (!cards.length) return null;

  return cards.reduce((a, b) => a + b, 0) / cards.length;
}

export function countFundableVotes(scores = {}) {
  const entries = Object.values(scores ?? {});
  return entries.filter((entry) => entry?.fundable === true).length;
}

/** How many judges actually filed a usable card for this team. */
export function scoredJudgeCount(scores = {}) {
  return Object.values(scores ?? {}).filter((entry) => scoreCard(entry) !== null).length;
}

/**
 * Rank teams for the final round cut.
 *
 * The average alone is not a total order — two teams tie often enough at this
 * scale to matter, and `Array.prototype.sort` on equal keys leaves the winner
 * to insertion order, i.e. to Firebase push-key order. That is a coin flip
 * deciding who gets on stage. The tiebreak is therefore explicit and total:
 *
 *   1. higher average score
 *   2. more judges calling it fundable
 *   3. more judges having seen it   (a 3-judge 32 is better evidenced than a 1-judge 32)
 *   4. team name, so the result is at least deterministic and explainable
 *   5. team id, because names are not unique
 *
 * Step 5 is what makes the order total rather than nearly total. Nothing stops
 * two groups calling themselves the same thing -- findTeamIdByName carries the
 * same warning -- and two teams matching on all four earlier keys put the sort
 * back on insertion order, which is Firebase push-key order: the coin flip this
 * function exists to remove. finalStandings relies on there always being a
 * first row, so "nearly total" is not enough.
 *
 * The name comparison is pinned to one locale. Left to the runtime's default it
 * is the viewer's, so two organizers looking at the same tie could be shown it
 * in two different orders.
 */
export function compareForRanking(a, b) {
  if (a.averageScore !== b.averageScore) return b.averageScore - a.averageScore;
  if (a.fundableVotes !== b.fundableVotes) return b.fundableVotes - a.fundableVotes;
  if (a.judgeCount !== b.judgeCount) return b.judgeCount - a.judgeCount;

  const byName = String(a.name ?? "").localeCompare(String(b.name ?? ""), "en");
  if (byName !== 0) return byName;

  const left = String(a.teamId ?? "");
  const right = String(b.teamId ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Build the ranking input for one team from its score cards, so the dashboard
 * and the final-round cut agree on what "best" means.
 */
export function rankingEntry(teamId, name, scores) {
  return {
    teamId,
    name: name ?? "Unnamed Team",
    averageScore: calculateAverageScore(scores),
    fundableVotes: countFundableVotes(scores),
    judgeCount: scoredJudgeCount(scores),
  };
}

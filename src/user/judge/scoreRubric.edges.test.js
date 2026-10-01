/**
 * The rubric's labels and the edges of scoring a card. scoreRubric is checked
 * against the rules in schema.test.js and for ranking in scoring.test.js; this
 * covers blanks, partial cards and every step of the tiebreak.
 */
import {
  RUBRIC,
  scoreCard,
  calculateAverageScore,
  countFundableVotes,
  scoredJudgeCount,
  compareForRanking,
} from "./scoreRubric";

test("each criterion's label, and a question to judge it by", () => {
  expect(Object.fromEntries(Object.entries(RUBRIC).map(([key, spec]) => [key, spec.label]))).toEqual({
    problem: "Problem",
    innovation: "Innovation",
    impact: "Impact",
    viability: "Viability",
    pitch_quality: "Pitch quality",
  });
  for (const spec of Object.values(RUBRIC)) expect(spec.desc).toMatch(/^[A-Z].{40,}\?$/);
});

describe("one card", () => {
  test("a blank, null or missing criterion is left out rather than counted as zero", () => {
    expect(scoreCard({ problem: "", innovation: 10 })).toBe(40);
    expect(scoreCard({ problem: null, innovation: 10 })).toBe(40);
    expect(scoreCard({ problem: undefined, innovation: 10 })).toBe(40);
  });

  test("a zero is a score", () => {
    expect(scoreCard({ problem: 0, innovation: 10 })).toBe(20);
    expect(scoreCard({ problem: "0" })).toBe(0);
  });

  test("something that is not a number is left out, and nothing usable is no score", () => {
    expect(scoreCard({ problem: "lots", innovation: 5 })).toBe(20);
    expect(scoreCard({ problem: "" })).toBeNull();
    expect(scoreCard(null)).toBeNull();
  });
});

describe("a team's cards", () => {
  test("no cards, or none usable, is no average", () => {
    expect(calculateAverageScore({})).toBeNull();
    expect(calculateAverageScore(undefined)).toBeNull();
    expect(calculateAverageScore({ a: {}, b: { problem: "" } })).toBeNull();
    expect(scoredJudgeCount({ a: {}, b: { problem: 5 } })).toBe(1);
  });

  test("unusable cards do not drag the average down", () => {
    expect(calculateAverageScore({ a: { problem: 10 }, b: {} })).toBe(40);
  });

  test("only a literal true is a fundable vote", () => {
    expect(countFundableVotes({ a: { fundable: true }, b: { fundable: "yes" }, c: null, d: {} })).toBe(1);
    expect(countFundableVotes(undefined)).toBe(0);
  });
});

describe("the tiebreak", () => {
  const team = (overrides) => ({ teamId: "t", name: "N", averageScore: 30, fundableVotes: 1, judgeCount: 3, ...overrides });
  const order = (...teams) => [...teams].sort(compareForRanking).map((t) => t.teamId);

  test("average, then fundable votes, then judges, then name, then id", () => {
    expect(order(team({ teamId: "b", averageScore: 29 }), team({ teamId: "a" }))).toEqual(["a", "b"]);
    expect(order(team({ teamId: "b", fundableVotes: 0 }), team({ teamId: "a" }))).toEqual(["a", "b"]);
    expect(order(team({ teamId: "b", judgeCount: 2 }), team({ teamId: "a" }))).toEqual(["a", "b"]);
    expect(order(team({ teamId: "a", name: "Zed" }), team({ teamId: "b", name: "Abe" }))).toEqual(["b", "a"]);
    expect(order(team({ teamId: "t2" }), team({ teamId: "t1" }))).toEqual(["t1", "t2"]);
  });

  test("the id comparison runs both ways and is zero for the same team", () => {
    expect(compareForRanking(team({ teamId: "a" }), team({ teamId: "b" }))).toBe(-1);
    expect(compareForRanking(team({ teamId: "b" }), team({ teamId: "a" }))).toBe(1);
    expect(compareForRanking(team({ teamId: "a" }), team({ teamId: "a" }))).toBe(0);
  });

  test("a missing name sorts before a named team, and a missing id before an id", () => {
    expect(order(team({ teamId: "x", name: "A" }), team({ teamId: "y", name: undefined }))).toEqual(["y", "x"]);
    expect(compareForRanking(team({ teamId: undefined }), team({ teamId: "A" }))).toBe(-1);
    expect(compareForRanking(team({ teamId: "A" }), team({ teamId: undefined }))).toBe(1);
    expect(compareForRanking(team({ name: "A" }), team({ name: undefined }))).toBeGreaterThan(0);
    expect(compareForRanking(team({ name: undefined }), team({ name: "A" }))).toBeLessThan(0);
  });
});

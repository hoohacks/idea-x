/**
 * The arithmetic that decides who wins.
 *
 * None of this was covered before: scoreCard, calculateAverageScore and the
 * top-four cut ran for the first time each year on live data, at the moment the
 * results were announced.
 */
import {
  RUBRIC,
  SCORE_FIELDS,
  SCORE_MAX_TOTAL,
  scoreCard,
  calculateAverageScore,
  countFundableVotes,
  scoredJudgeCount,
  compareForRanking,
  rankingEntry,
} from "./scoreRubric";

const full = (overrides = {}) => ({
  problem: 10,
  innovation: 10,
  impact: 10,
  viability: 5,
  pitch_quality: 5,
  fundable: true,
  ...overrides,
});

describe("scoreCard", () => {
  test("a perfect card is the maximum", () => {
    expect(scoreCard(full())).toBe(SCORE_MAX_TOTAL);
  });

  test("criteria are summed, not averaged, so the 10s count double the 5s", () => {
    // 10 on every 10-point criterion, 0 awarded on the 5s is not expressible,
    // so use the minimum: 10+10+10+1+1 = 32 of 40
    expect(scoreCard(full({ viability: 1, pitch_quality: 1 }))).toBe(32);
  });

  test("a criterion the judge did not fill in is left out of the denominator", () => {
    // an older card with no pitch_quality scores 10+10+10+5 = 35 of 35, which
    // normalises back to the full 40 rather than being penalised for the gap
    const partial = full();
    delete partial.pitch_quality;
    expect(scoreCard(partial)).toBe(SCORE_MAX_TOTAL);
  });

  test.each([[null], [undefined], [{}], [{ fundable: true }]])(
    "%p has nothing scorable and returns null",
    (entry) => {
      expect(scoreCard(entry)).toBeNull();
    }
  );

  test("non-numeric values are ignored rather than poisoning the total", () => {
    expect(scoreCard(full({ problem: "not a number" }))).not.toBeNaN();
  });

  test("string digits are accepted, because the form collects strings", () => {
    expect(scoreCard(full({ problem: "10" }))).toBe(SCORE_MAX_TOTAL);
  });
});

describe("calculateAverageScore", () => {
  test("averages across judges", () => {
    const scores = {
      a: full(),
      b: full({ problem: 1, innovation: 1, impact: 1, viability: 1, pitch_quality: 1 }),
    };
    // 40 and 5 -> 22.5
    expect(calculateAverageScore(scores)).toBeCloseTo(22.5);
  });

  test.each([[{}], [null], [undefined]])("%p has no average", (scores) => {
    expect(calculateAverageScore(scores)).toBeNull();
  });

  test("unscorable cards do not drag the average toward zero", () => {
    // the empty card is excluded entirely rather than counted as a 0
    expect(calculateAverageScore({ a: full(), b: {} })).toBe(SCORE_MAX_TOTAL);
  });
});

describe("counts", () => {
  test("fundable is a tally of true, not of truthiness", () => {
    expect(countFundableVotes({ a: full(), b: full({ fundable: false }), c: {} })).toBe(1);
  });

  test("the judge count only counts judges who filed something scorable", () => {
    expect(scoredJudgeCount({ a: full(), b: {}, c: full() })).toBe(2);
  });
});

describe("ranking is a total order", () => {
  const team = (name, averageScore, fundableVotes = 0, judgeCount = 1) => ({
    name,
    averageScore,
    fundableVotes,
    judgeCount,
  });

  test("higher average wins", () => {
    expect([team("low", 20), team("high", 30)].sort(compareForRanking)[0].name).toBe("high");
  });

  test("a tie on average is broken by fundable votes", () => {
    const sorted = [team("a", 30, 1), team("b", 30, 3)].sort(compareForRanking);
    expect(sorted[0].name).toBe("b");
  });

  test("then by how many judges saw it", () => {
    // a 32 from three judges is better evidenced than a 32 from one
    const sorted = [team("thin", 32, 2, 1), team("solid", 32, 2, 3)].sort(compareForRanking);
    expect(sorted[0].name).toBe("solid");
  });

  test("and finally by name, so the result is never insertion order", () => {
    const sorted = [team("zeta", 30, 1, 1), team("alpha", 30, 1, 1)].sort(compareForRanking);
    expect(sorted.map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  /**
   * Nothing makes team names unique -- findTeamIdByName carries the same
   * warning -- so two teams matching on every other key used to compare equal,
   * and the sort fell back to insertion order: Firebase push-key order, the
   * coin flip the tiebreak exists to remove. It decides who advances when the
   * tie straddles the final-round cut.
   */
  test("two teams with the same name still get a definite order", () => {
    const twins = (teamId) => ({ ...team("Lantern", 32, 2, 3), teamId });
    const a = twins("t-aaa");
    const b = twins("t-zzz");

    expect(compareForRanking(a, b)).toBeLessThan(0);
    expect([a, b].sort(compareForRanking).map((t) => t.teamId)).toEqual(["t-aaa", "t-zzz"]);
    expect([b, a].sort(compareForRanking).map((t) => t.teamId)).toEqual(["t-aaa", "t-zzz"]);
  });

  test("the same input always produces the same order", () => {
    // the whole point: without this the last podium place went to whichever
    // team Firebase happened to give the earlier push key
    const teams = [team("a", 30, 1, 2), team("b", 30, 1, 2), team("c", 30, 1, 2)];
    const once = [...teams].sort(compareForRanking).map((t) => t.name);
    const twice = [...teams].reverse().sort(compareForRanking).map((t) => t.name);
    expect(once).toEqual(twice);
  });
});

describe("rankingEntry", () => {
  test("carries everything the tiebreak needs", () => {
    const entry = rankingEntry("t1", "Team One", { j1: full(), j2: full({ fundable: false }) });
    expect(entry).toEqual({
      teamId: "t1",
      name: "Team One",
      averageScore: SCORE_MAX_TOTAL,
      fundableVotes: 1,
      judgeCount: 2,
    });
  });

  test("an unnamed team still ranks", () => {
    expect(rankingEntry("t1", undefined, { j1: full() }).name).toBe("Unnamed Team");
  });
});

describe("the rubric is one definition", () => {
  test("SCORE_FIELDS is derived from RUBRIC, so they cannot disagree", () => {
    for (const [field, spec] of Object.entries(RUBRIC)) {
      expect(SCORE_FIELDS[field]).toBe(spec.range);
    }
    expect(Object.keys(SCORE_FIELDS)).toEqual(Object.keys(RUBRIC));
  });

  test("the maximum is the sum of the criteria", () => {
    expect(SCORE_MAX_TOTAL).toBe(Object.values(SCORE_FIELDS).reduce((a, b) => a + b, 0));
  });
});

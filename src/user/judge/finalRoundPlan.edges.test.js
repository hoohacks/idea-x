/**
 * The edges of the final round plan's pure helpers.
 *
 * finalRoundPlan.test.js drives these through the service with a realistic
 * event. What it never reaches are the degenerate inputs the planner page can
 * still hand them: no plan yet, a cut larger than the ranking, a finalist whose
 * panel was emptied by hand, a pool nobody is seated from. Each of these is a
 * render of the planner, so each has to answer rather than throw.
 */
import { buildFinalPlan, finalStats, slotLabel, slotsOf } from "./finalRoundPlan";

const ranked = [
  { teamId: "a", name: "Almanac", judgeCount: 3 },
  { teamId: "b", name: "Beacon", judgeCount: 2 },
];
const pool = [
  { judgeId: "j1", judgeName: "Priya Raman" },
  { judgeId: "j2", judgeName: "Sam Whitaker" },
];

describe("slotLabel", () => {
  test("is one-based, because the order is not", () => {
    expect(slotLabel(0)).toBe("Slot 1");
    expect(slotLabel(3)).toBe("Slot 4");
  });
});

describe("buildFinalPlan", () => {
  test("with nothing at all, it is an empty plan rather than an error", () => {
    const plan = buildFinalPlan({});
    expect(plan.assignments).toEqual({});
    expect(plan.pool).toEqual([]);
    expect(plan.size).toBe(4);
    expect(plan.room).toBe("");
    expect(plan.basis).toEqual({ cardCounts: {}, eligibleJudges: {}, size: 4, room: "" });
  });

  test("a cut larger than the ranking takes everyone who is ranked", () => {
    const plan = buildFinalPlan({ ranked, pool, size: 10 });
    expect(Object.keys(plan.assignments)).toEqual(["a", "b"]);
  });

  test("a cut of zero takes nobody", () => {
    expect(buildFinalPlan({ ranked, pool, size: 0 }).assignments).toEqual({});
  });

  test("every panel is its own copy, so editing one does not edit the rest", () => {
    const plan = buildFinalPlan({ ranked, pool, size: 2 });
    plan.assignments.a.judges.pop();
    expect(plan.assignments.b.judges).toHaveLength(2);
    expect(plan.pool).toHaveLength(2);
  });

  test("the basis records what the ranking was built on", () => {
    const plan = buildFinalPlan({ ranked, pool, size: 1, room: "Rice 011" });
    expect(plan.basis.cardCounts).toEqual({ a: 3, b: 2 });
    expect(plan.basis.eligibleJudges).toEqual({ j1: true, j2: true });
    expect(plan.basis.room).toBe("Rice 011");
  });
});

describe("slotsOf", () => {
  test("no plan, or a plan with no finalists, has no slots", () => {
    expect(slotsOf(undefined)).toEqual([]);
    expect(slotsOf(null)).toEqual([]);
    expect(slotsOf({})).toEqual([]);
  });

  test("slots come back in running order, whatever order they are stored in", () => {
    const plan = { assignments: { b: { teamId: "b", order: 1 }, a: { teamId: "a", order: 0 } } };
    expect(slotsOf(plan).map((slot) => slot.teamId)).toEqual(["a", "b"]);
  });
});

describe("finalStats", () => {
  test("no plan reads as all zeros, not as a crash", () => {
    expect(finalStats(undefined)).toEqual({
      finalists: 0, ranked: 0, minPanel: 0, maxPanel: 0, unjudged: [], idle: 0, edits: 0,
    });
  });

  test("a full plan has no idle judges and one panel size", () => {
    const stats = finalStats(buildFinalPlan({ ranked, pool, size: 2 }));
    expect(stats).toMatchObject({ finalists: 2, ranked: 2, minPanel: 2, maxPanel: 2, unjudged: [], idle: 0, edits: 0 });
  });

  test("an emptied panel is named, and its judges count as idle only if seated nowhere else", () => {
    const plan = buildFinalPlan({ ranked, pool, size: 2 });
    plan.assignments.b.judges = [];
    plan.assignments.a.judges = [pool[0]];
    const stats = finalStats(plan);
    expect(stats.unjudged).toEqual(["Beacon"]);
    expect(stats.minPanel).toBe(0);
    expect(stats.maxPanel).toBe(1);
    expect(stats.idle).toBe(1);
  });

  test("a plan with no ranking, pool or edits recorded still reports", () => {
    const stats = finalStats({ assignments: { a: { teamName: "Almanac", order: 0, judges: [] } } });
    expect(stats).toMatchObject({ finalists: 1, ranked: 0, idle: 0, edits: 0, unjudged: ["Almanac"] });
  });

  test("hand edits are counted", () => {
    const plan = buildFinalPlan({ ranked, pool, size: 2 });
    plan.edits = [{}, {}, {}];
    expect(finalStats(plan).edits).toBe(3);
  });
});

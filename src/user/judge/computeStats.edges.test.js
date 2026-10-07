/**
 * The plan summary's counting edges: batch order, pairs counted once whichever
 * way round, and a plan with pieces missing.
 */
import { computeStats } from "./computeStats";

const judges = (...ids) => ids.map((judgeId) => ({ judgeId }));

test("batch sizes are listed in batch order however the plan stores them", () => {
  const plan = {
    assignments: {
      a: { id: "a", batch: 3, judges: judges("j1") },
      b: { id: "b", batch: 1, judges: judges("j2") },
      c: { id: "c", batch: 3, judges: judges("j3") },
      d: { id: "d", batch: 2, judges: judges("j4") },
      e: { id: "e", batch: 10, judges: judges("j5") },
    },
  };
  expect(computeStats(plan).batchSizes).toEqual([1, 1, 2, 1]);
});

test("the same two judges together again is one repeat, whichever order they are listed", () => {
  const plan = {
    assignments: {
      a: { id: "a", batch: 1, judges: judges("x", "y", "z") },
      b: { id: "b", batch: 2, judges: judges("y", "x") },
      c: { id: "c", batch: 3, judges: judges("z", "y") },
    },
  };
  expect(computeStats(plan).repeatPairings).toBe(2);
});

test("ids that would read alike once joined are still different pairs", () => {
  const plan = {
    assignments: {
      a: { id: "a", batch: 1, judges: judges("a-b", "c") },
      b: { id: "b", batch: 2, judges: judges("a", "b-c") },
    },
  };
  expect(computeStats(plan).repeatPairings).toBe(0);
});

test("a plan with nothing in it is all zeros, with the default target", () => {
  expect(computeStats({})).toEqual({
    teams: 0,
    judges: 0,
    batchSizes: [],
    roomsUsed: 0,
    minJudgesPerTeam: 0,
    maxJudgesPerTeam: 0,
    spareJudgeIds: [],
    belowTarget: [],
    unscheduledTeamIds: [],
    repeatPairings: 0,
  });
  const twoJudges = { assignments: { a: { id: "a", batch: 1, judges: judges("x", "y") } } };
  expect(computeStats(twoJudges).belowTarget).toEqual(["a"]);
  expect(computeStats({ basis: { teamIds: ["t1"] } }).unscheduledTeamIds).toEqual(["t1"]);
});

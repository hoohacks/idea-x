const { computeStats } = await import("./computeStats");

/** Two batches, three rooms, four judges. j3 is never assigned. */
const plan = () => ({
  assignments: {
    t1: { id: "t1", teamName: "A", batch: 1, room: "R1", time: "5:00 PM",
          judges: [{ judgeId: "j0" }, { judgeId: "j1" }] },
    t2: { id: "t2", teamName: "B", batch: 1, room: "R2", time: "5:00 PM",
          judges: [{ judgeId: "j2" }] },
    t3: { id: "t3", teamName: "C", batch: 2, room: "R1", time: "5:15 PM",
          judges: [{ judgeId: "j0" }, { judgeId: "j1" }] },
  },
  basis: {
    teamIds: ["t1", "t2", "t3", "t4"],
    judgeIds: ["j0", "j1", "j2", "j3"],
    rooms: ["R1", "R2", "R3"], batchCount: 2, batchTimes: {}, target: 2,
  },
  judgeNames: {}, teamNames: {}, onlyCheckedIn: false,
});

test("counts scheduled teams from the assignments and judges from the basis", () => {
  const stats = computeStats(plan());
  expect(stats.teams).toBe(3);
  expect(stats.judges).toBe(4);
});

test("a judge with no assignment is a spare", () => {
  expect(computeStats(plan()).spareJudgeIds).toEqual(["j3"]);
});

test("a submitted team with no slot is unscheduled", () => {
  expect(computeStats(plan()).unscheduledTeamIds).toEqual(["t4"]);
});

test("a team under target is named", () => {
  expect(computeStats(plan()).belowTarget).toEqual(["t2"]);
});

test("batch sizes and rooms used", () => {
  const stats = computeStats(plan());
  expect(stats.batchSizes).toEqual([2, 1]);
  expect(stats.roomsUsed).toBe(2);
});

test("panel range", () => {
  const stats = computeStats(plan());
  expect(stats.minJudgesPerTeam).toBe(1);
  expect(stats.maxJudgesPerTeam).toBe(2);
});

test("j0 and j1 sit together twice, so one repeat pairing", () => {
  expect(computeStats(plan()).repeatPairings).toBe(1);
});

test("an empty plan does not throw or return Infinity", () => {
  const stats = computeStats({
    assignments: {},
    basis: { teamIds: [], judgeIds: [], rooms: [], batchCount: 3, batchTimes: {}, target: 3 },
    judgeNames: {}, teamNames: {},
  });
  expect(stats.minJudgesPerTeam).toBe(0);
  expect(stats.maxJudgesPerTeam).toBe(0);
  expect(stats.roomsUsed).toBe(0);
});

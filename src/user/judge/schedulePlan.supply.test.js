/**
 * The supply check's every message, and the allocator's exact seating, worked
 * out by hand for small events.
 *
 * schedulePlan.test.js checks the invariants (nobody double-booked, panels
 * within one of each other); this pins the numbers and the wording at each
 * boundary, because the advice is only useful if the number in it is right.
 */
import { allocateBatch, describeSupply } from "./schedulePlan";

const ONE_JUDGE =
  "Some teams will be seen by only 1 judge. An average from one judge is that judge's opinion, and the final round is picked on averages.";
const SPARE_ADVICE =
  "Spare judges have no assignment card. Keep them on hand for a no-show, or add them to a team from Judging progress.";

describe("allocating one batch", () => {
  test("nothing to seat, or nobody to seat, gives empty panels", () => {
    expect(allocateBatch({ judgeCount: 0, batchSize: 2 })).toEqual([[], []]);
    expect(allocateBatch({ judgeCount: 3, batchSize: 0 })).toEqual([]);
  });

  test("the second batch rotates which judges sit, and where", () => {
    // rotation (1 * 3) % 5 = 3, stride 2: positions seat 3, 4, then 0, 1
    expect(allocateBatch({ judgeCount: 5, batchSize: 2, batchIndex: 1, target: 2 })).toEqual([
      [3, 0],
      [4, 1],
    ]);
  });

  test("the first batch seats judges in order", () => {
    expect(allocateBatch({ judgeCount: 3, batchSize: 2, target: 3 })).toEqual([[0], [1, 2]]);
  });
});

describe("refusals", () => {
  test("no judges at all", () => {
    expect(describeSupply({ teamCount: 3, judgeCount: 0, roomCount: 3 })).toEqual({
      ok: false,
      error: "No judges are available to schedule.",
      warnings: [],
      advice: [],
    });
  });

  test("too few rooms says how many more, or what batch count fits", () => {
    expect(describeSupply({ teamCount: 6, judgeCount: 6, roomCount: 2, batchCount: 2 })).toEqual({
      ok: false,
      error:
        "6 teams over 2 batches need 3 rooms at once, but only 2 are configured. Add 1 more room(s), or raise the batch count to 3 so fewer teams present at the same time.",
      warnings: [],
      advice: [],
    });
  });

  test("too few judges says how many more, or the smallest batch count that works", () => {
    expect(describeSupply({ teamCount: 6, judgeCount: 2, roomCount: 6, batchCount: 2 })).toEqual({
      ok: false,
      error:
        "2 judges cannot cover 3 teams presenting at once, and each judge can only be in one room. Either mark 1 more first-round judge(s), or raise the batch count to 3 so only 2 teams present at a time.",
      warnings: [],
      advice: [],
    });
  });

  test("the smallest batch count is the first that brings a batch within the judges", () => {
    expect(describeSupply({ teamCount: 7, judgeCount: 2, roomCount: 3, batchCount: 3 }).error).toBe(
      "2 judges cannot cover 3 teams presenting at once, and each judge can only be in one room. Either mark 1 more first-round judge(s), or raise the batch count to 4 so only 2 teams present at a time."
    );
  });
});

describe("what a schedulable event will look like", () => {
  test("exactly one judge per team in the largest batch is enough to run, with a warning", () => {
    expect(describeSupply({ teamCount: 3, judgeCount: 3, roomCount: 3, batchCount: 1 })).toEqual({
      ok: true,
      error: null,
      warnings: [ONE_JUDGE],
      advice: ["Mark 3 more first-round judge(s) to give every team at least 2."],
      batchSizes: [3],
      judgesPerTeam: { min: 1, max: 1 },
    });
  });

  test("two judges per team is not called thin", () => {
    expect(describeSupply({ teamCount: 2, judgeCount: 4, roomCount: 2, batchCount: 1 })).toEqual({
      ok: true,
      error: null,
      warnings: [],
      advice: [],
      batchSizes: [2],
      judgesPerTeam: { min: 2, max: 2 },
    });
  });

  test("a panel cap of one is thin even with judges to spare, but asks for nobody more", () => {
    expect(describeSupply({ teamCount: 2, judgeCount: 4, roomCount: 2, batchCount: 1, target: 1 })).toEqual({
      ok: true,
      error: null,
      warnings: [
        ONE_JUDGE,
        "4 judges is more than 2 teams need. Panels are capped at 1 and roughly 2 judge(s) are held back per batch as spares.",
      ],
      advice: [SPARE_ADVICE],
      batchSizes: [2],
      judgesPerTeam: { min: 1, max: 1 },
    });
  });

  test("uneven batches name the split and every batch count that divides evenly", () => {
    expect(describeSupply({ teamCount: 6, judgeCount: 3, roomCount: 6, batchCount: 4 })).toEqual({
      ok: true,
      error: null,
      warnings: [ONE_JUDGE],
      advice: [
        "Mark 1 more first-round judge(s) to give every team at least 2.",
        "Teams are split 2/2/1/1, so the smaller batches get more judges per team. A batch count of 2, 3 or 6 divides 6 teams evenly and removes that.",
      ],
      batchSizes: [2, 2, 1, 1],
      judgesPerTeam: { min: 1, max: 3 },
    });
  });

  test("one even option is named on its own", () => {
    const { advice } = describeSupply({ teamCount: 5, judgeCount: 3, roomCount: 3, batchCount: 2 });
    expect(advice).toContain(
      "Teams are split 3/2, so the smaller batches get more judges per team. A batch count of 5 divides 5 teams evenly and removes that."
    );
  });

  test("two options read 'a or b', and a batch count needing too many rooms is not offered", () => {
    const { advice } = describeSupply({ teamCount: 6, judgeCount: 2, roomCount: 2, batchCount: 4 });
    expect(advice).toContain(
      "Teams are split 2/2/1/1, so the smaller batches get more judges per team. A batch count of 3 or 6 divides 6 teams evenly and removes that."
    );
  });

  test("eight batches is the most offered, and only the first three are named", () => {
    const eight = describeSupply({ teamCount: 8, judgeCount: 3, roomCount: 8, batchCount: 3 }).advice;
    expect(eight).toContain(
      "Teams are split 3/3/2, so the smaller batches get more judges per team. A batch count of 2, 4 or 8 divides 8 teams evenly and removes that."
    );
    const ten = describeSupply({ teamCount: 10, judgeCount: 4, roomCount: 10, batchCount: 3 }).advice;
    expect(ten).toContain(
      "Teams are split 4/3/3, so the smaller batches get more judges per team. A batch count of 2 or 5 divides 10 teams evenly and removes that."
    );
  });

  test("uneven batch sizes that still give every team the same panel need no batch advice", () => {
    const { advice, judgesPerTeam } = describeSupply({ teamCount: 6, judgeCount: 12, roomCount: 6, batchCount: 4 });
    expect(judgesPerTeam).toEqual({ min: 3, max: 3 });
    expect(advice).toEqual([SPARE_ADVICE]);
  });

  test("uneven panels with no even batch count available say nothing about batches", () => {
    // eleven teams: nothing from 2 to 8 divides them
    const { advice, judgesPerTeam } = describeSupply({ teamCount: 11, judgeCount: 4, roomCount: 4, batchCount: 3 });
    expect(judgesPerTeam).toEqual({ min: 1, max: 2 });
    expect(advice).toEqual(["Mark 4 more first-round judge(s) to give every team at least 2."]);
  });

  test("spare judges are counted per batch", () => {
    expect(describeSupply({ teamCount: 2, judgeCount: 10, roomCount: 2, batchCount: 1 }).warnings).toEqual([
      "10 judges is more than 2 teams need. Panels are capped at 3 and roughly 4 judge(s) are held back per batch as spares.",
    ]);
    expect(describeSupply({ teamCount: 4, judgeCount: 10, roomCount: 2, batchCount: 2 }).warnings).toEqual([
      "10 judges is more than 4 teams need. Panels are capped at 3 and roughly 4 judge(s) are held back per batch as spares.",
    ]);
  });

  test("empty batches are left out of the shape", () => {
    expect(describeSupply({ teamCount: 2, judgeCount: 4, roomCount: 2, batchCount: 3 }).batchSizes).toEqual([1, 1]);
  });
});

/**
 * The final-round drift check's whole output, word for word, including the
 * advisory room and size changes and how it copes with missing pieces.
 * checkFinalDrift.test.js covers each kind on its own.
 */
import { checkFinalDrift, blockingOnly, BLOCKING, ADVISORY } from "./checkFinalDrift";

const plan = () => ({
  room: "Rice 011",
  ranked: [
    { teamId: "t1", name: "Lantern" },
    { teamId: "t2", name: "Circles" },
  ],
  assignments: {
    t1: { teamId: "t1", teamName: "Lantern", order: 0, judges: [{ judgeId: "j1", judgeName: "Ada" }] },
  },
  basis: { cardCounts: { t1: 3, t2: 2, t9: 1 }, room: "Rice 011", size: 1 },
});
const live = (overrides = {}) => ({
  cardCounts: { t1: 3, t2: 2, t9: 1 },
  submitted: { t1: true, t2: true },
  registeredJudges: { j1: true },
  room: "Rice 011",
  size: 1,
  ...overrides,
});

test("the levels", () => {
  expect([BLOCKING, ADVISORY]).toEqual(["blocking", "advisory"]);
});

test("nothing moved, nothing said", () => {
  expect(checkFinalDrift(plan(), live())).toEqual([]);
});

test("everything moved: each issue in full, in order", () => {
  const result = checkFinalDrift(
    plan(),
    live({ cardCounts: { t1: 4, t2: 2 }, submitted: {}, registeredJudges: {}, room: "Olsson 120", size: 2 })
  );
  expect(result).toEqual([
    {
      kind: "scores",
      level: "blocking",
      teamId: "t1",
      message: "Lantern has been scored since this ranking was computed, so the averages the cut was made from have moved.",
      repair: "rerank",
    },
    {
      kind: "scores",
      level: "blocking",
      teamId: "t9",
      message: "t9 has been scored since this ranking was computed, so the averages the cut was made from have moved.",
      repair: "rerank",
    },
    { kind: "team", level: "blocking", teamId: "t1", message: "Lantern is no longer a submitted team.", repair: "dropTeam" },
    {
      kind: "judge",
      level: "blocking",
      teamId: "t1",
      judgeId: "j1",
      message: "Ada is on Lantern's panel but is no longer a judge in this event.",
      repair: "removeJudge",
    },
    {
      kind: "room",
      level: "advisory",
      message: "The final round room was changed to Olsson 120 after this plan was built.",
      repair: "setRoom",
      room: "Olsson 120",
    },
    {
      kind: "size",
      level: "advisory",
      message: "The final round size was changed to 2. The cut in this plan is explicit, so publishing keeps the 1 teams you can see.",
    },
  ]);
  expect(blockingOnly(result).map((issue) => issue.kind)).toEqual(["scores", "scores", "team", "judge"]);
});

describe("the room", () => {
  test("a room change the organizer already applied to the plan is not reported", () => {
    expect(checkFinalDrift({ ...plan(), room: "Olsson 120" }, live({ room: "Olsson 120" }))).toEqual([]);
  });

  test("no live room, or no room in the basis, is not reported", () => {
    expect(checkFinalDrift(plan(), live({ room: "" }))).toEqual([]);
    expect(checkFinalDrift({ ...plan(), basis: { ...plan().basis, room: undefined } }, live({ room: "Elsewhere" }))).toEqual([]);
  });
});

describe("the size", () => {
  test("no live size, or none in the basis, is not reported", () => {
    expect(checkFinalDrift(plan(), live({ size: 0 }))).toEqual([]);
    expect(checkFinalDrift({ ...plan(), basis: { ...plan().basis, size: undefined } }, live({ size: 5 }))).toEqual([]);
  });
});

describe("missing pieces", () => {
  test("no live state at all reports every finalist as gone, and every card as moved", () => {
    expect(checkFinalDrift(plan(), undefined).map((issue) => issue.kind)).toEqual(["scores", "scores", "scores", "team", "judge"]);
  });

  test("no plan basis or ranking checks only what there is", () => {
    const bare = { assignments: plan().assignments };
    expect(checkFinalDrift(bare, live())).toEqual([]);
    expect(checkFinalDrift({ ...plan(), ranked: undefined }, live({ cardCounts: { t1: 9, t2: 2, t9: 1 } }))[0].message).toMatch(/^t1 has been scored/);
    expect(checkFinalDrift(undefined, live())).toEqual([]);
  });

  test("blockingOnly copes with nothing", () => {
    expect(blockingOnly(undefined)).toEqual([]);
    expect(blockingOnly([{ level: "advisory" }])).toEqual([]);
  });
});

/**
 * planFinalRound and publishFinalRound, with the database mocked.
 *
 * planFinalRound is the read-only half of the final-round plan/publish split:
 * it ranks every scored team, cuts the top `limit`, and reports what an
 * organizer needs to see about that cut -- without writing anything.
 * publishFinalRound is the writer: it takes a finalist set (as given, so an
 * organizer's override of the cut is honoured) and the `basis` the plan was
 * built from, and refuses to write if a card has arrived since.
 */
jest.mock("../../firebase", () => ({ database: {}, auth: {} }));

const mockUpdate = jest.fn();
const mockGet = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "generated-id" }),
  onValue: () => () => {},
  serverTimestamp: () => 1700000000000,
  // publishFinalRound takes a restore point first, and captureSnapshot prunes
  // /snapshotIndex through a real transaction now. Nothing here races two
  // captures, so the single-writer version -- read, run the updater, write --
  // is all this file needs. Same shape as dangerZone.test.js.
  runTransaction: async (reference, updater) => {
    const snap = await mockGet(reference);
    const current = snap.exists() ? snap.val() : null;
    const next = updater(current);
    if (next === undefined) {
      return { committed: false, snapshot: { val: () => current, exists: () => current != null } };
    }
    await mockUpdate({ path: "" }, { [reference.path]: next });
    return { committed: true, snapshot: { val: () => next, exists: () => true } };
  },
}));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
jest.mock("../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));

const { planFinalRound, publishFinalRound } = require("./finalRoundService");
const { slotsOf } = require("./finalRoundPlan");
const { applyFinalEdit } = require("./applyFinalEdit");
const { requireAdmin } = require("../../roles.js");

/**
 * Five submitted teams with first-round cards:
 *   t0  38 avg, 2 judges  -- clear first
 *   t1  36 avg, 1 judge   -- in the cut, but on a single card
 *   t2  34 avg, 2 judges
 *   t3  30 avg, 2 judges  -- last team in (tiebreak: more judges than t4)
 *   t4  30 avg, 1 judge   -- first team out, tied with t3 on average
 *
 * Each card carries only the `problem` field (max 10), scaled so a single
 * criterion decides the whole 40-point average -- simpler than filling every
 * field to hit a target number.
 *
 * `scoresData` is module-level and mutable on purpose: a test that wants a
 * card to "arrive" between `planFinalRound` and `publishFinalRound` mutates
 * it directly, and the next `get("scores/first")` sees the change -- `world`
 * always reads the current value, not a snapshot taken when it was built.
 */
let teamsData;
let judgesData;
let scoresData;

function resetWorld() {
  teamsData = {};
  for (let i = 0; i < 5; i++) {
    teamsData[`t${i}`] = { name: `Team ${i}`, submitted: true };
  }

  judgesData = {};
  for (let i = 0; i < 5; i++) {
    judgesData[`j${i}`] = {
      firstName: "Judge", lastName: String(i), isRound1Judge: true, checkedIn: true,
    };
  }

  scoresData = {
    t0: { j0: { problem: 9.5 }, j1: { problem: 9.5 } },
    t1: { j0: { problem: 9 } },
    t2: { j0: { problem: 8.5 }, j1: { problem: 8.5 } },
    t3: { j0: { problem: 7.5 }, j1: { problem: 7.5 } },
    t4: { j0: { problem: 7.5 } },
  };
}

async function world(r) {
  const table = {
    teams: teamsData,
    judges: judgesData,
    "scores/first": scoresData,
  };
  const value = table[r.path];
  return { exists: () => value !== undefined, val: () => value ?? null };
}

beforeEach(() => {
  resetWorld();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockImplementation(world);
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

test("planning writes nothing", async () => {
  const result = await planFinalRound({});
  expect(result.ok).toBe(true);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("it names a finalist that reached the cut on too few judges", async () => {
  const { warnings } = await planFinalRound({});
  expect(warnings.join(" ")).toMatch(/fewer than 2 judges/i);
});

test("it names a tie straddling the cut line", async () => {
  const { warnings } = await planFinalRound({});
  expect(warnings.join(" ")).toMatch(/tied on average/);
});

test("it records how many cards each team was ranked on", async () => {
  const { plan } = await planFinalRound({});
  expect(Object.keys(plan.basis.cardCounts).length).toBeGreaterThan(0);
});

test("the top four teams by average make the cut, in rank order", async () => {
  const { plan } = await planFinalRound({});
  expect(slotsOf(plan).map((s) => s.teamId)).toEqual(["t0", "t1", "t2", "t3"]);
});

test("every panel is prefilled with the judges who did not score that team", async () => {
  const { plan } = await planFinalRound({});
  // j0 scored every team, j1 scored t0, t2 and t3
  expect(plan.assignments.t0.judges.map((j) => j.judgeId)).toEqual(["j2", "j3", "j4"]);
  expect(plan.assignments.t1.judges.map((j) => j.judgeId)).toEqual(["j1", "j2", "j3", "j4"]);
});

test("the room comes from config, not the constant", async () => {
  const withRoom = async (r) => (r.path === "config/finalRoundRoom"
    ? { exists: () => true, val: () => "Rice 130" }
    : world(r));
  mockGet.mockImplementation(withRoom);

  const { plan } = await planFinalRound({});
  expect(plan.room).toBe("Rice 130");
});

test("the cut size comes from config", async () => {
  const withSize = async (r) => (r.path === "config/finalRoundSize"
    ? { exists: () => true, val: () => 2 }
    : world(r));
  mockGet.mockImplementation(withSize);

  const { plan } = await planFinalRound({});
  expect(slotsOf(plan)).toHaveLength(2);
});

describe("publishing", () => {
  const publishable = async () => (await planFinalRound({})).plan;

  // the publish is one update among several -- the restore point goes first and
  // the draft is cleared afterwards -- so address it by what it contains
  const publishPayload = () =>
    mockUpdate.mock.calls.map((call) => call[1]).find((payload) => "finalRound/active" in payload);

  test("refuses when a card arrived since the ranking", async () => {
    const plan = await publishable();
    scoresData.t0 = { ...scoresData.t0, j4: { problem: 5 } };

    const result = await publishFinalRound(plan);

    expect(result.ok).toBe(false);
    expect(result.drift.some((d) => d.repair === "rerank")).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("refuses when a team just outside the cut gains a card", async () => {
    // t4 is not a finalist, so nothing about the finalist list looks wrong --
    // but its average moved, and it can now be above a team that is in
    const plan = await publishable();
    scoresData.t4 = { ...scoresData.t4, j1: { problem: 10 } };

    const result = await publishFinalRound(plan);

    expect(result.ok).toBe(false);
    expect(result.drift.some((d) => d.teamId === "t4")).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("writes the running order the organizer confirmed, not the ranking", async () => {
    let plan = await publishable();
    plan = applyFinalEdit(plan, { type: "moveSlot", teamId: "t0", order: 3 }).plan;

    const result = await publishFinalRound(plan);
    expect(result.ok).toBe(true);

    const payload = publishPayload();
    expect(payload["teams/t0/finalSlot"].timeslot).toBe("Slot 4");
    expect(payload["teams/t1/finalSlot"].timeslot).toBe("Slot 1");
  });

  test("a dropped team keeps no slot and no assignment", async () => {
    let plan = await publishable();
    plan = applyFinalEdit(plan, { type: "dropTeam", teamId: "t1" }).plan;

    const result = await publishFinalRound(plan);
    expect(result.ok).toBe(true);

    const payload = publishPayload();
    expect(payload["teams/t1/finalSlot"]).toBeNull();
    expect(payload["finalRound/teams"].t1).toBeUndefined();
  });

  test("each judge is given exactly the teams the plan seats them on", async () => {
    let plan = await publishable();
    plan = applyFinalEdit(plan, { type: "removeJudge", teamId: "t0", judgeId: "j2" }).plan;

    await publishFinalRound(plan);

    const payload = publishPayload();
    expect(payload["judges/j2/finalAssignments"].t0).toBeUndefined();
    expect(payload["judges/j2/finalAssignments"].t1).toBeTruthy();
    // j0 scored every team in round one, so is on no panel at all
    expect(payload["judges/j0/finalAssignments"]).toBeNull();
  });

  test("the room on the plan is the room that is written", async () => {
    let plan = await publishable();
    plan = applyFinalEdit(plan, { type: "setRoom", room: "Old Cabell 100" }).plan;

    await publishFinalRound(plan);

    const payload = publishPayload();
    expect(payload["teams/t0/finalSlot"].room).toBe("Old Cabell 100");
    expect(payload["judges/j2/finalAssignments"].t0.room).toBe("Old Cabell 100");
  });

  test("a restore point is taken before anything is written", async () => {
    const plan = await publishable();
    await publishFinalRound(plan);

    // the snapshot has to land before the standings, or a failed publish
    // leaves nothing to go back to
    const paths = mockUpdate.mock.calls.map((call) => Object.keys(call[1]).join(","));
    const snapshotAt = paths.findIndex((p) => /snapshot/i.test(p));
    const publishAt = paths.findIndex((p) => p.includes("finalRound/active"));

    expect(snapshotAt).toBeGreaterThanOrEqual(0);
    expect(publishAt).toBeGreaterThan(snapshotAt);
  });

  test("an empty cut is refused rather than clearing the round", async () => {
    let plan = await publishable();
    for (const teamId of ["t0", "t1", "t2", "t3"]) {
      plan = applyFinalEdit(plan, { type: "dropTeam", teamId }).plan;
    }

    const result = await publishFinalRound(plan);
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

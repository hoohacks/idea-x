/**
 * publishPlan end to end, with the database mocked.
 *
 * publishPlan is the writer half of the plan/publish split: planSchedule
 * builds a plan with no writes, and this is the one place that replaces every
 * judge and team assignment in a live event. What is worth pinning is the
 * order (restore point before schedule), the refusal to write anything on
 * drift or an empty/unjudged plan, and that the payload actually written
 * matches what the plan decided.
 */
jest.mock("../../firebase", () => ({ database: {}, auth: {} }));

const mockUpdate = jest.fn();
const mockGet = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "generated-id" }),
  serverTimestamp: () => 1700000000000,
  // publishPlan takes a restore point first, and captureSnapshot prunes
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
// only requireAdmin is stubbed: the rest of the module is plain helpers this
// code genuinely uses, and replacing them wholesale made a name render as
// "personName is not a function" the first time one was added
jest.mock("../../roles.js", () => ({
  ...jest.requireActual("../../roles.js"),
  requireAdmin: jest.fn(async () => ({ uid: "admin-1" })),
}));

const { publishPlan } = require("./publishPlan");
const { planSchedule } = require("./planSchedule");
const { requireAdmin } = require("../../roles.js");

/** An event with `teams` submitted teams and `judges` round-one judges. */
function world({
  teams = 12, judges = 12, rooms = 10, batchCount = 3, checkedIn = true, unsubmitted = [],
} = {}) {
  const teamsData = {};
  for (let i = 0; i < teams; i++) {
    teamsData[`t${i}`] = {
      name: `Team ${i}`,
      submitted: !unsubmitted.includes(`t${i}`),
      members: { [`c${i}`]: true },
    };
  }
  const judgesData = {};
  for (let i = 0; i < judges; i++) {
    judgesData[`j${i}`] = {
      firstName: "Judge", lastName: String(i), isRound1Judge: true, checkedIn,
    };
  }

  return async (r) => {
    const table = {
      teams: teamsData,
      judges: judgesData,
      "config/judgingRooms": Array.from({ length: rooms }, (_, i) => `Room ${i}`),
      "config/batchCount": batchCount,
      "config/batchTimes": { 1: "5:00 PM", 2: "5:15 PM", 3: "5:30 PM" },
      scheduleDraft: undefined,
    };
    const value = table[r.path];
    return { exists: () => value !== undefined, val: () => value ?? null };
  };
}

/** The update that wrote the schedule, i.e. the one carrying scheduleMeta. */
const schedulePayload = () =>
  mockUpdate.mock.calls.map((call) => call[1]).find((p) => "config/scheduleMeta" in p);

const snapshotPayload = () =>
  mockUpdate.mock.calls.map((call) => call[1]).find((p) => p["snapshots/generated-id"]);

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockImplementation(world());
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

/** A plan built from the same mocked world we are about to publish into. */
async function built() {
  const { plan } = await planSchedule({});
  mockUpdate.mockClear();
  return plan;
}

describe("a restore point comes first", () => {
  test("the schedule is written only after a restore point exists", async () => {
    const result = await publishPlan(await built());
    expect(result.ok).toBe(true);
    // Taking a restore point is two writes now, not one: the index is pruned
    // through a transaction and the payload is written after it. Both belong
    // to the restore point, so both count as "snapshot" -- classifying the
    // index write as "schedule" would put a schedule write first and fail
    // this on a change that did not move the schedule at all.
    const order = mockUpdate.mock.calls.map(([, p]) =>
      p["snapshots/generated-id"] || p.snapshotIndex ? "snapshot" : "schedule"
    );
    expect(order.indexOf("snapshot")).toBeLessThan(order.indexOf("schedule"));
  });

  test("the restore point carries the state it is about to replace", async () => {
    await publishPlan(await built());
    const stored = snapshotPayload()["snapshots/generated-id"];
    expect(stored.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(["teams", "judges", "config/scheduleMeta"])
    );
  });

  test("nothing is replaced when the restore point cannot be written", async () => {
    const plan = await built();
    mockUpdate.mockRejectedValueOnce(new Error("network down"));
    const result = await publishPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/restore point/i);
    expect(schedulePayload()).toBeUndefined();
  });
});

describe("what gets written", () => {
  test("every team in the plan gets its slot", async () => {
    const plan = await built();
    await publishPlan(plan);
    const payload = schedulePayload();
    for (const teamId of Object.keys(plan.assignments)) {
      expect(payload[`teams/${teamId}/schedule`]).toMatchObject({ id: teamId });
    }
  });

  test("each judge gets their own copy, keyed by team", async () => {
    const plan = await built();
    await publishPlan(plan);
    const payload = schedulePayload();
    for (const a of Object.values(plan.assignments)) {
      for (const j of a.judges) {
        expect(payload[`judges/${j.judgeId}/teamAssignments`][a.id]).toMatchObject({
          id: a.id, room: a.room, batch: a.batch,
        });
      }
    }
  });

  test("a judge with no assignment has their old list cleared", async () => {
    // one team, twelve judges: the panel caps at 3, so most judges are spares
    mockGet.mockImplementation(world({ teams: 1, judges: 12 }));
    const plan = await built();
    await publishPlan(plan);
    const payload = schedulePayload();
    const assigned = new Set(plan.assignments.t0.judges.map((j) => j.judgeId));
    const spare = ["j0", "j11"].find((uid) => !assigned.has(uid));
    expect(payload[`judges/${spare}/teamAssignments`]).toBeNull();
  });

  test("a team not in the plan has its old slot cleared", async () => {
    // t11 never submitted, so the planner skips it and publish must clear it
    mockGet.mockImplementation(world({ teams: 12, unsubmitted: ["t11"] }));
    const plan = await built();
    expect(plan.assignments.t11).toBeUndefined();
    await publishPlan(plan);
    expect(schedulePayload()["teams/t11/schedule"]).toBeNull();
  });

  test("a judge who is no longer eligible has their stale assignment cleared", async () => {
    // "stale" is registered but not a round-one judge, so planSchedule never
    // sees them and live.judgeIds (the filtered set) excludes them too --
    // only the raw roster (live.allJudgeIds) still has their id. They carry
    // a teamAssignments entry left over from a previous publish, which is
    // what judges/{uid}/teamAssignments proves for score-writing: publish
    // must clear it, or the judge keeps write access to a team's scores.
    mockGet.mockImplementation(async (r) => {
      const base = await world({ teams: 12, judges: 12 })(r);
      if (r.path !== "judges") return base;
      const judges = { ...base.val() };
      judges.stale = {
        firstName: "Stale", lastName: "Judge", isRound1Judge: false,
        teamAssignments: { t0: { id: "t0" } },
      };
      return { exists: () => true, val: () => judges };
    });
    const plan = await built();
    await publishPlan(plan);
    expect(schedulePayload()["judges/stale/teamAssignments"]).toBeNull();
  });

  test("the draft is cleared in the same update as the schedule", async () => {
    await publishPlan(await built());
    expect(schedulePayload().scheduleDraft).toBeNull();
  });

  test("scheduleMeta records who published and from what", async () => {
    await publishPlan(await built());
    const meta = schedulePayload()["config/scheduleMeta"];
    expect(meta).toMatchObject({ generatedBy: "admin-1", teams: 12, judges: 12 });
  });

  test("the audit entry names the hand edits", async () => {
    const plan = await built();
    plan.edits = [{ op: { type: "addJudge" }, summary: "Added Di to B", before: null }];
    await publishPlan(plan);
    const entry = schedulePayload()["adminLog/generated-id"];
    expect(entry.action).toBe("schedule.publish");
    expect(entry.by).toBe("admin-1");
    expect(entry.summary).toMatch(/Added Di to B/);
    expect(entry.undoable).toBe(false);
  });

  test("the audit entry still records who published and that a restore point came first, with no edits", async () => {
    await publishPlan(await built());
    const entry = schedulePayload()["adminLog/generated-id"];
    expect(entry.action).toBe("schedule.publish");
    expect(entry.by).toBe("admin-1");
    expect(entry.summary).toMatch(/Restore point taken first/);
    expect(entry.undoable).toBe(false);
  });
});

describe("it refuses", () => {
  test("a plan whose teams have moved underneath it", async () => {
    const plan = await built();
    plan.basis.teamIds = plan.basis.teamIds.filter((id) => id !== "t3");
    const result = await publishPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.drift.blocking).not.toHaveLength(0);
    expect(schedulePayload()).toBeUndefined();
  });

  test("a plan containing a team with no judges", async () => {
    const plan = await built();
    plan.assignments.t0.judges = [];
    const result = await publishPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no judges/i);
    expect(schedulePayload()).toBeUndefined();
  });

  test("an empty plan", async () => {
    const plan = await built();
    plan.assignments = {};
    const result = await publishPlan(plan);
    expect(result.ok).toBe(false);
    expect(schedulePayload()).toBeUndefined();
  });
});

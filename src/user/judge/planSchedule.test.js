jest.mock("../../firebase", () => ({ database: {}, auth: {} }));

const mockUpdate = jest.fn();
const mockGet = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "generated-id" }),
  serverTimestamp: () => 1700000000000,
}));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
// only requireAdmin is stubbed: the rest of the module is plain helpers this
// code genuinely uses, and replacing them wholesale made a name render as
// "personName is not a function" the first time one was added
jest.mock("../../roles.js", () => ({
  ...jest.requireActual("../../roles.js"),
  requireAdmin: jest.fn(async () => ({ uid: "admin-1" })),
}));

const { planSchedule } = require("./planSchedule");
const { requireAdmin } = require("../../roles.js");

/** An event with `teams` submitted teams and `judges` round-one judges. */
function world({ teams = 12, judges = 12, rooms = 10, batchCount = 3, checkedIn = true } = {}) {
  const teamsData = {};
  for (let i = 0; i < teams; i++) {
    teamsData[`t${i}`] = { name: `Team ${i}`, submitted: true, members: { [`c${i}`]: true } };
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
    };
    const value = table[r.path];
    return { exists: () => value !== undefined, val: () => value ?? null };
  };
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockImplementation(world());
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

describe("planSchedule writes nothing", () => {
  test("no update is ever issued", async () => {
    const result = await planSchedule({});
    expect(result.ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("the plan it returns", () => {
  test("every submitted team gets a slot and at least one judge", async () => {
    const { plan } = await planSchedule({});
    for (let i = 0; i < 12; i++) {
      expect(plan.assignments[`t${i}`]).toMatchObject({
        id: `t${i}`,
        batch: expect.any(Number),
        room: expect.any(String),
      });
      expect(plan.assignments[`t${i}`].judges.length).toBeGreaterThan(0);
    }
  });

  test("no judge is in two rooms in one batch", async () => {
    const { plan } = await planSchedule({});
    const seen = new Map();
    for (const a of Object.values(plan.assignments)) {
      for (const j of a.judges) {
        const key = `${j.judgeId}:${a.batch}`;
        expect(seen.has(key)).toBe(false);
        seen.set(key, a.id);
      }
    }
  });

  test("the basis records what the plan was built from", async () => {
    const { plan } = await planSchedule({});
    expect(plan.basis.teamIds).toHaveLength(12);
    expect(plan.basis.judgeIds).toHaveLength(12);
    expect(plan.basis.rooms).toHaveLength(10);
    expect(plan.basis.batchCount).toBe(3);
  });

  test("names are carried so editing needs no database", async () => {
    const { plan } = await planSchedule({});
    expect(plan.judgeNames.j0).toBe("Judge 0");
    expect(plan.teamNames.t0).toBe("Team 0");
  });
});

describe("it refuses the same things generation refused", () => {
  test("no rooms configured", async () => {
    mockGet.mockImplementation(world({ rooms: 0 }));
    const result = await planSchedule({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no judging rooms are configured/i);
  });

  test("too few judges for the largest batch", async () => {
    mockGet.mockImplementation(world({ teams: 30, judges: 3, rooms: 20 }));
    const result = await planSchedule({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/each judge can only be in one room/i);
  });

  test("nobody marked as a first round judge", async () => {
    mockGet.mockImplementation(world({ judges: 0 }));
    const result = await planSchedule({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no judges/i);
  });

  test("onlyCheckedIn leaves absent judges out and says so", async () => {
    mockGet.mockImplementation(world({ checkedIn: false }));
    const result = await planSchedule({ onlyCheckedIn: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/checked in/i);
  });
});

/**
 * Event configuration.
 *
 * These were module constants and stay as fallbacks, because an event always
 * has some number of batches. The room list deliberately has no fallback --
 * there is no sensible default for which rooms a venue booked.
 */
jest.mock("../../../firebase", () => ({ database: {}, auth: {} }));

const mockUpdate = jest.fn(async () => {});
const mockGet = jest.fn(async () => ({ exists: () => false, val: () => null }));

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "entry-1" }),
  serverTimestamp: () => 0,
}));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
jest.mock("../../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));

const { readEventConfig, setBatchCount, setBatchTimes, setEventStart, setFinalRoundRoom, setSubmissionsOpen } =
  require("./eventConfig");
const { BATCH_COUNT, BATCH_TIMES } = require("../../judge/schedulePlan");
const { requireAdmin } = require("../../../roles.js");

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation off
 * every jest.fn before each test -- so an implementation passed to jest.fn() at
 * declaration is gone by the time the first test runs and the mock silently
 * returns undefined. Every implementation has to be re-established here.
 */
beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockResolvedValue({ exists: () => false, val: () => null });
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

describe("reading config falls back to the built-in values", () => {
  test("an empty database gives the compiled-in defaults", async () => {
    const config = await readEventConfig();
    expect(config.batchCount).toBe(BATCH_COUNT);
    expect(config.batchTimes).toEqual(BATCH_TIMES);
    expect(config.finalRoundRoom).toBe("Rice 011");
  });

  test("stored values win", async () => {
    mockGet.mockImplementation(async (r) => {
      const stored = {
        "config/batchCount": 4,
        "config/batchTimes": { 1: "6:00 PM", 2: "6:15 PM", 3: "6:30 PM", 4: "6:45 PM" },
        "config/finalRoundRoom": "Rice 130",
        "config/eventStart": "2026-10-18T09:00:00",
      }[r.path];
      return { exists: () => stored !== undefined, val: () => stored };
    });

    const config = await readEventConfig();
    expect(config.batchCount).toBe(4);
    expect(config.batchTimes[4]).toBe("6:45 PM");
    expect(config.finalRoundRoom).toBe("Rice 130");
  });
});

describe("writing config", () => {
  test("a batch count is written and logged", async () => {
    const result = await setBatchCount(4);
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["config/batchCount"]).toBe(4);
    expect(mockUpdate.mock.calls[0][1]["adminLog/entry-1"].action).toBe("config.batchCount");
  });

  test("a batch count below one is refused", async () => {
    expect((await setBatchCount(0)).ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a non-integer batch count is refused", async () => {
    expect((await setBatchCount(2.5)).ok).toBe(false);
  });

  test("batch times must cover every batch", async () => {
    mockGet.mockImplementation(async (r) => {
      const stored = { "config/batchCount": 3 }[r.path];
      return { exists: () => stored !== undefined, val: () => stored };
    });
    expect((await setBatchTimes({ 1: "5:00 PM", 2: "5:15 PM" })).ok).toBe(false);
  });

  test("an unparseable event start is refused", async () => {
    expect((await setEventStart("not a date")).ok).toBe(false);
  });

  test("a valid event start is written", async () => {
    const result = await setEventStart("2026-10-18T09:00:00");
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["config/eventStart"]).toBe("2026-10-18T09:00:00");
  });

  test("an empty final round room is refused", async () => {
    expect((await setFinalRoundRoom("   ")).ok).toBe(false);
  });
});

describe("project submissions", () => {
  test("opening writes true and logs who opened them", async () => {
    expect((await setSubmissionsOpen(true)).ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["config/submissionsOpen"]).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["adminLog/entry-1"].action).toBe("config.submissionsOpen");
  });

  test("an untouched database counts as closed, so closing it again writes nothing", async () => {
    expect((await setSubmissionsOpen(false)).ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("closing writes false", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => true });
    await setSubmissionsOpen(false);
    expect(mockUpdate.mock.calls[0][1]["config/submissionsOpen"]).toBe(false);
  });
});

/**
 * The schedule's configuration as read from config/*.
 *
 * The contract is the fallback: rooms have none on purpose (an empty list must
 * stop a generation), while batch count, times and panel size fall back to the
 * built-in constants whenever the stored value is missing or unusable.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);

const db = await import("../../testing/fakeDatabase");
const { fetchRooms, fetchBatchConfig, displayName, readScheduleMeta } = await import("./scheduleConfig");
const { BATCH_COUNT, BATCH_TIMES, TARGET_JUDGES_PER_TEAM } = await import("./schedulePlan");

const builtIn = { batchCount: BATCH_COUNT, batchTimes: BATCH_TIMES, target: TARGET_JUDGES_PER_TEAM };

beforeEach(() => {
  db.reset({});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("rooms", () => {
  test("are read from config/judgingRooms, as a list or a keyed set", async () => {
    db.setData("config/judgingRooms", ["Rice 340", "Rice 342"]);
    await expect(fetchRooms()).resolves.toEqual(["Rice 340", "Rice 342"]);
    db.setData("config/judgingRooms", { a: "Olsson 005", b: "Thornton E316" });
    await expect(fetchRooms()).resolves.toEqual(["Olsson 005", "Thornton E316"]);
  });

  test("drop blanks and anything that is not a name", async () => {
    db.setData("config/judgingRooms", { a: "Rice 340", b: "   ", c: "", d: 42, e: { name: "x" }, f: " Rice 011 " });
    await expect(fetchRooms()).resolves.toEqual(["Rice 340", " Rice 011 "]);
  });

  test("none configured is an empty list, not a built-in one, and not a warning", async () => {
    await expect(fetchRooms()).resolves.toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("a failed read is an empty list too", async () => {
    const error = new Error("PERMISSION_DENIED");
    vi.spyOn(db.module, "get").mockRejectedValueOnce(error);
    await expect(fetchRooms()).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("Could not read config/judgingRooms:", error);
  });
});

describe("batch config", () => {
  test("nothing stored gives the built-in values", async () => {
    await expect(fetchBatchConfig()).resolves.toEqual(builtIn);
  });

  test("stored values win, each read from its own key", async () => {
    const times = { 1: "6:00 PM", 2: "6:20 PM" };
    db.setData("config", { batchCount: 2, batchTimes: times, targetJudgesPerTeam: 4 });
    await expect(fetchBatchConfig()).resolves.toEqual({ batchCount: 2, batchTimes: times, target: 4 });
  });

  test("numbers stored as strings are accepted", async () => {
    db.setData("config", { batchCount: "5", targetJudgesPerTeam: "2" });
    await expect(fetchBatchConfig()).resolves.toMatchObject({ batchCount: 5, target: 2 });
  });

  test("one is the smallest usable count and panel", async () => {
    db.setData("config", { batchCount: 1, targetJudgesPerTeam: 1 });
    await expect(fetchBatchConfig()).resolves.toMatchObject({ batchCount: 1, target: 1 });
  });

  test.each([
    ["zero", 0],
    ["negative", -2],
    ["fractional", 2.5],
    ["not a number", "many"],
  ])("a %s count or panel size falls back to the built-in one", async (_label, bad) => {
    db.setData("config", { batchCount: bad, targetJudgesPerTeam: bad });
    await expect(fetchBatchConfig()).resolves.toEqual(builtIn);
  });

  test("times that are not a map fall back to the built-in ones", async () => {
    db.setData("config", { batchTimes: "5:00 PM" });
    await expect(fetchBatchConfig()).resolves.toEqual(builtIn);
  });

  test("a failed read gives the built-in values", async () => {
    const error = new Error("offline");
    vi.spyOn(db.module, "get").mockRejectedValueOnce(error);
    await expect(fetchBatchConfig()).resolves.toEqual(builtIn);
    expect(console.warn).toHaveBeenCalledWith("Could not read the batch config, using the built-in values:", error);
  });
});

test("displayName is the shared person name", () => {
  expect(displayName({ firstName: "Ada", lastName: "Byron" })).toBe("Ada Byron");
  expect(displayName({}, "Judge j1")).toBe("Judge j1");
});

describe("schedule meta", () => {
  test("is null before anything has been generated", async () => {
    db.setData("scores/first", { t1: { j1: {} } });
    await expect(readScheduleMeta()).resolves.toBeNull();
  });

  test("is the stored meta plus how many teams have first-round scores", async () => {
    db.setData("config/scheduleMeta", { generatedAt: 5, teams: 12 });
    db.setData("scores", { first: { t1: { j1: {} }, t2: { j2: {} } }, final: { t3: { j1: {} } } });
    await expect(readScheduleMeta()).resolves.toEqual({ generatedAt: 5, teams: 12, scoredTeams: 2 });
  });

  test("no scores yet counts zero", async () => {
    db.setData("config/scheduleMeta", { generatedAt: 5 });
    await expect(readScheduleMeta()).resolves.toEqual({ generatedAt: 5, scoredTeams: 0 });
  });
});

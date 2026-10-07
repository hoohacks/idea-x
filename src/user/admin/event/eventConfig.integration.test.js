/**
 * Event setup writes against an in-memory database with the real audit log and
 * admin check: the bounds on each value, what is stored, and the summary each
 * leaves in the activity feed.
 */
jest.mock("../../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../../testing/fakeDatabase");
const config = require("./eventConfig");
const { decodeChanges } = require("../adminAction");

beforeEach(() => db.reset({ admins: { "admin-1": true } }));
afterEach(() => jest.restoreAllMocks());

const lastLog = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  const entry = entries[entries.length - 1];
  return entry && { ...entry, changes: decodeChanges(entry.changes) };
};

describe("reading", () => {
  test("an empty database gives every built-in value", async () => {
    await expect(config.readEventConfig()).resolves.toEqual({
      batchCount: 3,
      batchTimes: { 1: "5:00 PM", 2: "5:15 PM", 3: "5:30 PM" },
      eventStart: "2026-10-25T10:00:00-04:00",
      finalRoundRoom: "Rice 011",
    });
  });

  test("each stored value is read from its own key", async () => {
    db.setData("config", { batchCount: 2, batchTimes: { 1: "a", 2: "b" }, eventStart: "2026-11-01T09:00", finalRoundRoom: "Olsson 120" });
    await expect(config.readEventConfig()).resolves.toEqual({
      batchCount: 2,
      batchTimes: { 1: "a", 2: "b" },
      eventStart: "2026-11-01T09:00",
      finalRoundRoom: "Olsson 120",
    });
  });

  test("a failed read falls back too", async () => {
    jest.spyOn(db.module, "get").mockRejectedValue(new Error("denied"));
    await expect(config.readEventConfig()).resolves.toMatchObject({ batchCount: 3, finalRoundRoom: "Rice 011" });
  });
});

describe("batch count", () => {
  test.each([1, 12])("accepts %p and logs the change from the old value", async (count) => {
    await expect(config.setBatchCount(count)).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/batchCount")).toBe(count);
    expect(lastLog()).toMatchObject({ action: "config.batchCount", summary: `Batch count 3 to ${count}` });
  });

  test.each([0, 13, 2.5, "4", undefined])("refuses %p", async (count) => {
    await expect(config.setBatchCount(count)).resolves.toEqual({
      ok: false,
      error: "The batch count must be a whole number between 1 and 12.",
    });
    expect(db.writes).toEqual([]);
  });
});

describe("batch times", () => {
  test("must cover every configured batch, naming the missing ones", async () => {
    db.setData("config/batchCount", 4);
    await expect(config.setBatchTimes({ 1: "5:00 PM", 2: "  ", 4: "6:00 PM" })).resolves.toEqual({
      ok: false,
      error: "Give every batch a time. Missing: 2, 3.",
    });
    await expect(config.setBatchTimes(undefined)).resolves.toEqual({ ok: false, error: "Give every batch a time. Missing: 1, 2, 3, 4." });
  });

  test("a complete set is written and logged against the old one", async () => {
    const times = { 1: "6:00 PM", 2: "6:20 PM", 3: "6:40 PM" };
    await expect(config.setBatchTimes(times)).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/batchTimes")).toEqual(times);
    expect(lastLog()).toMatchObject({
      action: "config.batchTimes",
      summary: "Batch times set for 3 batch(es)",
      changes: [{ path: "config/batchTimes", before: { 1: "5:00 PM", 2: "5:15 PM", 3: "5:30 PM" }, after: times }],
    });
  });
});

describe("event start", () => {
  test("a readable date is written and logged against the old one", async () => {
    await expect(config.setEventStart("2026-11-01T09:00:00-04:00")).resolves.toMatchObject({ ok: true });
    expect(lastLog()).toMatchObject({
      action: "config.eventStart",
      summary: "Event start 2026-10-25T10:00:00-04:00 to 2026-11-01T09:00:00-04:00",
    });
  });

  test("an unreadable one is refused", async () => {
    await expect(config.setEventStart("next sunday")).resolves.toEqual({ ok: false, error: "That is not a date the browser can read." });
  });
});

describe("submissions switch", () => {
  test("opening and closing each log a change, and repeating one does nothing", async () => {
    await expect(config.setSubmissionsOpen(true)).resolves.toMatchObject({ ok: true, entryId: expect.any(String) });
    expect(lastLog()).toMatchObject({ action: "config.submissionsOpen", summary: "Opened project submissions", changes: [{ before: false, after: true }] });

    const logged = Object.keys(db.getData("adminLog")).length;
    await expect(config.setSubmissionsOpen(true)).resolves.toEqual({ ok: true });
    expect(Object.keys(db.getData("adminLog"))).toHaveLength(logged);

    await config.setSubmissionsOpen(false);
    expect(lastLog()).toMatchObject({ summary: "Closed project submissions", changes: [{ before: true, after: false }] });
    expect(db.getData("config/submissionsOpen")).toBe(false);
  });

  test("only a literal true counts as open", async () => {
    db.setData("config/submissionsOpen", "yes");
    await expect(config.setSubmissionsOpen(false)).resolves.toEqual({ ok: true });
    await config.setSubmissionsOpen("yes");
    expect(db.writes.filter((w) => w.op === "update")).toEqual([]);
  });
});

describe("submission deadline", () => {
  const at = Date.UTC(2026, 9, 25, 19, 0, 0);

  test("is stored as a number and logged as a time", async () => {
    await expect(config.setSubmissionsCloseAt(String(at))).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/submissionsCloseAt")).toBe(at);
    expect(lastLog()).toMatchObject({
      action: "config.submissionsCloseAt",
      summary: "Submission deadline set to 2026-10-25T19:00:00.000Z",
      changes: [{ before: null, after: at }],
    });
  });

  test("setting the same deadline again does nothing, and removing it is logged", async () => {
    db.setData("config/submissionsCloseAt", at);
    await expect(config.setSubmissionsCloseAt(at)).resolves.toEqual({ ok: true });
    expect(db.getData("adminLog")).toBeNull();
    await config.setSubmissionsCloseAt(undefined);
    expect(lastLog()).toMatchObject({ summary: "Removed the submission deadline", changes: [{ before: at, after: null }] });
    expect(db.getData("config/submissionsCloseAt")).toBeNull();
  });

  test("removing a deadline that is not set does nothing", async () => {
    await expect(config.setSubmissionsCloseAt(null)).resolves.toEqual({ ok: true });
    expect(db.getData("adminLog")).toBeNull();
  });

  test("something that is not a time is refused", async () => {
    await expect(config.setSubmissionsCloseAt("tonight")).resolves.toEqual({ ok: false, error: "That is not a time the browser can read." });
    await expect(config.setSubmissionsCloseAt(Infinity)).resolves.toMatchObject({ ok: false });
  });
});

describe("final round room", () => {
  test("is trimmed, written and logged against the old one", async () => {
    await expect(config.setFinalRoundRoom("  Olsson 120 ")).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/finalRoundRoom")).toBe("Olsson 120");
    expect(lastLog()).toMatchObject({ action: "config.finalRoundRoom", summary: "Final round room Rice 011 to Olsson 120" });
  });

  test("a blank room is refused", async () => {
    await expect(config.setFinalRoundRoom("  ")).resolves.toEqual({ ok: false, error: "Give the final round a room." });
    await expect(config.setFinalRoundRoom(undefined)).resolves.toEqual({ ok: false, error: "Give the final round a room." });
  });
});

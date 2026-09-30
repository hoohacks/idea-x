/**
 * Posting and taking down announcements, through the real audit-log writer
 * over an in-memory database: what is refused, what is stored, and what the
 * log says about it.
 */
jest.mock("../../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../../testing/fakeDatabase");
const { postAnnouncement, takeDownAnnouncement } = require("./announcementsService");
const { decodeChanges } = require("../adminAction");

const NOW = Date.UTC(2026, 9, 25, 16, 0, 0);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(NOW));
  db.reset({ admins: { "admin-1": true }, judges: { "admin-1": { firstName: "Ada" } } });
});
afterEach(() => jest.useRealTimers());

const onlyLogEntry = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  expect(entries).toHaveLength(1);
  return entries[0];
};
const onlyAnnouncement = () => {
  const [[id, value]] = Object.entries(db.getData("announcements"));
  return { id, value };
};

describe("posting", () => {
  test("stores the trimmed message for its audience, live, stamped with the poster's clock", async () => {
    const result = await postAnnouncement({ text: "  Dinner at 6.  ", audience: "judges" });
    expect(result).toEqual({ ok: true, entryId: expect.any(String) });

    const { id, value } = onlyAnnouncement();
    expect(value).toEqual({ text: "Dinner at 6.", audience: "judges", postedAt: NOW, active: true });

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "announcement.post", summary: 'Announced to judges: "Dinner at 6."', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: `announcements/${id}`, before: null, after: value }]);
  });

  test("goes to everyone unless told otherwise", async () => {
    await postAnnouncement({ text: "Hello" });
    expect(onlyAnnouncement().value.audience).toBe("everyone");
    expect(onlyLogEntry().summary).toBe('Announced to everyone: "Hello"');
  });

  test("a long message is shortened in the log, not in the announcement", async () => {
    const long = "x".repeat(61);
    await postAnnouncement({ text: long, audience: "competitors" });
    expect(onlyAnnouncement().value.text).toBe(long);
    expect(onlyLogEntry().summary).toBe(`Announced to competitors: "${"x".repeat(57)}..."`);
  });

  test("a message of exactly sixty characters is logged whole", async () => {
    const sixty = "y".repeat(60);
    await postAnnouncement({ text: sixty });
    expect(onlyLogEntry().summary).toBe(`Announced to everyone: "${sixty}"`);
  });

  test.each([
    ["nothing", undefined],
    ["an empty message", ""],
    ["only spaces", "   "],
  ])("refuses %s", async (_label, text) => {
    await expect(postAnnouncement({ text })).resolves.toEqual({ ok: false, error: "Write the announcement first." });
    expect(db.writes).toEqual([]);
  });

  test("allows exactly 280 characters and refuses 281", async () => {
    await expect(postAnnouncement({ text: "z".repeat(281) })).resolves.toEqual({
      ok: false,
      error: "Keep it to 280 characters so it fits on a phone.",
    });
    expect(db.writes).toEqual([]);
    await expect(postAnnouncement({ text: "z".repeat(280) })).resolves.toMatchObject({ ok: true });
  });

  test("the length limit is on the trimmed message", async () => {
    await expect(postAnnouncement({ text: `  ${"z".repeat(280)}  ` })).resolves.toMatchObject({ ok: true });
  });

  test("refuses an audience that is not one of the choices", async () => {
    await expect(postAnnouncement({ text: "Hi", audience: "sponsors" })).resolves.toEqual({
      ok: false,
      error: "Pick who it is for.",
    });
    expect(db.writes).toEqual([]);
  });

  test.each(["everyone", "competitors", "judges"])("accepts the %s audience", async (audience) => {
    await expect(postAnnouncement({ text: "Hi", audience })).resolves.toMatchObject({ ok: true });
  });
});

describe("taking down", () => {
  beforeEach(() => {
    db.setData("announcements/a1", { text: "Lunch", audience: "everyone", postedAt: 1, active: true });
  });

  test("marks it inactive, keeps the rest, and logs an undoable change", async () => {
    await expect(takeDownAnnouncement("a1", "Lunch")).resolves.toMatchObject({ ok: true });
    expect(db.getData("announcements/a1")).toEqual({ text: "Lunch", audience: "everyone", postedAt: 1, active: false });

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "announcement.takeDown", summary: 'Took down: "Lunch"', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: "announcements/a1/active", before: true, after: false }]);
  });

  test("shortens a long message in the log, and copes with none", async () => {
    await takeDownAnnouncement("a1", "w".repeat(61));
    expect(onlyLogEntry().summary).toBe(`Took down: "${"w".repeat(57)}..."`);

    db.setData("adminLog", null);
    await takeDownAnnouncement("a1", "v".repeat(60));
    expect(onlyLogEntry().summary).toBe(`Took down: "${"v".repeat(60)}"`);

    db.setData("adminLog", null);
    await takeDownAnnouncement("a1");
    expect(onlyLogEntry().summary).toBe('Took down: ""');
  });
});

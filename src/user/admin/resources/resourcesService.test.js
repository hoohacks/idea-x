/**
 * Adding, editing, ordering and removing resources, through the real audit-log
 * writer over an in-memory database: what is refused, what is stored, and what
 * the log says about it.
 */
vi.mock("../../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../../testing/fakeDatabase")).module);
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = await import("../../../testing/fakeDatabase");
const { addResource, updateResource, deleteResource, moveResource, setResourcesShowNow } =
  await import("./resourcesService");
const { decodeChanges } = await import("../adminAction");

const NOW = Date.UTC(2026, 9, 25, 16, 0, 0);

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(new Date(NOW));
  db.reset({ admins: { "admin-1": true }, judges: { "admin-1": { firstName: "Ada" } } });
});
afterEach(() => vi.useRealTimers());

const onlyLogEntry = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  expect(entries).toHaveLength(1);
  return entries[0];
};
const onlyResource = () => {
  const [[id, value]] = Object.entries(db.getData("resources"));
  return { id, value };
};
const valid = { title: "Judging rubric", url: "https://example.com/rubric.pdf", description: "", forJudges: true };

describe("adding", () => {
  test("stores the trimmed fields, first in the list, stamped with the poster's clock", async () => {
    const result = await addResource(
      {
        title: "  Judging rubric ",
        url: " https://example.com/rubric.pdf ",
        description: "  How you are scored  ",
        forJudges: true,
      },
      []
    );
    expect(result).toEqual({ ok: true, entryId: expect.any(String) });

    const { id, value } = onlyResource();
    expect(value).toEqual({
      title: "Judging rubric",
      url: "https://example.com/rubric.pdf",
      description: "How you are scored",
      forJudges: true,
      order: 0,
      createdAt: NOW,
    });

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "resource.add", summary: 'Added resource: "Judging rubric"', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: `resources/${id}`, before: null, after: value }]);
  });

  test("leaves the description out when it is empty, and forJudges defaults to false", async () => {
    await addResource({ title: "Pitching", url: "https://youtu.be/abc", description: "   " }, []);
    expect(onlyResource().value).not.toHaveProperty("description");
    expect(onlyResource().value.forJudges).toBe(false);
  });

  test("goes after the last one", async () => {
    await addResource(valid, [
      { id: "r1", order: 0 },
      { id: "r2", order: 4 },
    ]);
    expect(onlyResource().value.order).toBe(5);
  });

  test.each([
    ["no title", { ...valid, title: "  " }, "Give the resource a title."],
    [
      "a title over 80 characters",
      { ...valid, title: "t".repeat(81) },
      "Keep the title to 80 characters so it fits on a phone.",
    ],
    ["an http link", { ...valid, url: "http://example.com" }, "The link has to start with https://."],
    ["a javascript link", { ...valid, url: "javascript:alert(1)" }, "The link has to start with https://."],
    ["no link", { ...valid, url: undefined }, "The link has to start with https://."],
    [
      "a description over 140 characters",
      { ...valid, description: "d".repeat(141) },
      "Keep the description to 140 characters so it fits on a phone.",
    ],
  ])("refuses %s", async (_label, fields, error) => {
    await expect(addResource(fields, [])).resolves.toEqual({ ok: false, error });
    expect(db.writes).toEqual([]);
  });

  test("allows exactly 80 and 140 characters", async () => {
    await expect(
      addResource({ ...valid, title: "t".repeat(80), description: "d".repeat(140) }, [])
    ).resolves.toMatchObject({ ok: true });
  });

  test("a long title is shortened in the log, not in the resource", async () => {
    const long = "x".repeat(70);
    await addResource({ ...valid, title: long }, []);
    expect(onlyResource().value.title).toBe(long);
    expect(onlyLogEntry().summary).toBe(`Added resource: "${"x".repeat(57)}..."`);
  });
});

describe("editing", () => {
  const stored = {
    title: "Old",
    url: "https://example.com/a",
    description: "Was here",
    forJudges: false,
    order: 3,
    createdAt: 7,
  };
  beforeEach(() => db.setData("resources/r1", stored));

  test("replaces the fields, keeps order and createdAt, and logs an undoable change", async () => {
    await expect(
      updateResource("r1", stored, { title: " New ", url: "https://example.com/b", description: "", forJudges: true })
    ).resolves.toMatchObject({ ok: true });

    const after = { title: "New", url: "https://example.com/b", forJudges: true, order: 3, createdAt: 7 };
    expect(db.getData("resources/r1")).toEqual(after);

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "resource.update", summary: 'Edited resource: "New"', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: "resources/r1", before: stored, after }]);
  });

  test("refuses what adding refuses", async () => {
    await expect(updateResource("r1", stored, { ...valid, url: "http://example.com" })).resolves.toEqual({
      ok: false,
      error: "The link has to start with https://.",
    });
    expect(db.writes).toEqual([]);
  });
});

describe("deleting", () => {
  test("removes it and logs the whole resource so it can be undone", async () => {
    const stored = { title: "Gone", url: "https://example.com", forJudges: false, order: 0, createdAt: 1 };
    db.setData("resources/r1", stored);

    await expect(deleteResource("r1", stored)).resolves.toMatchObject({ ok: true });
    expect(db.getData("resources/r1")).toBeNull();

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "resource.delete", summary: 'Deleted resource: "Gone"', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: "resources/r1", before: stored, after: null }]);
  });
});

describe("moving", () => {
  const list = [
    { id: "a", title: "A", order: 0 },
    { id: "b", title: "B", order: 1 },
    { id: "c", title: "C", order: 2 },
  ];
  beforeEach(() => {
    for (const { id, ...rest } of list) {
      db.setData(`resources/${id}`, { ...rest, url: "https://example.com", forJudges: false, createdAt: 1 });
    }
  });

  test("swaps the two orders in one logged action", async () => {
    await expect(moveResource(list, 1, -1)).resolves.toMatchObject({ ok: true });
    expect(db.getData("resources/a/order")).toBe(1);
    expect(db.getData("resources/b/order")).toBe(0);

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "resource.move", summary: 'Moved resource up: "B"', undoable: true });
    expect(decodeChanges(log.changes)).toEqual([
      { path: "resources/b/order", before: 1, after: 0 },
      { path: "resources/a/order", before: 0, after: 1 },
    ]);
  });

  test("moving down swaps with the next one", async () => {
    await moveResource(list, 1, 1);
    expect(db.getData("resources/b/order")).toBe(2);
    expect(db.getData("resources/c/order")).toBe(1);
    expect(onlyLogEntry().summary).toBe('Moved resource down: "B"');
  });

  test("does nothing at either end", async () => {
    await expect(moveResource(list, 0, -1)).resolves.toEqual({ ok: true });
    await expect(moveResource(list, 2, 1)).resolves.toEqual({ ok: true });
    expect(db.writes).toEqual([]);
  });

  test("pulls two equal orders apart so the move shows", async () => {
    const tied = [
      { id: "a", title: "A", order: 5 },
      { id: "b", title: "B", order: 5 },
    ];
    db.setData("resources/a/order", 5);
    db.setData("resources/b/order", 5);
    await moveResource(tied, 1, -1);
    expect(db.getData("resources/b/order")).toBeLessThan(db.getData("resources/a/order"));
  });
});

describe("showing them early", () => {
  test("switches it on and logs the change", async () => {
    await expect(setResourcesShowNow(undefined, true)).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/resourcesShowNow")).toBe(true);

    const log = onlyLogEntry();
    expect(log).toMatchObject({ action: "config.resourcesShowNow", undoable: true });
    expect(decodeChanges(log.changes)).toEqual([{ path: "config/resourcesShowNow", before: null, after: true }]);
  });

  test("and off again", async () => {
    db.setData("config/resourcesShowNow", true);
    await setResourcesShowNow(true, false);
    expect(db.getData("config/resourcesShowNow")).toBe(false);
    expect(decodeChanges(onlyLogEntry().changes)).toEqual([
      { path: "config/resourcesShowNow", before: true, after: false },
    ]);
  });
});

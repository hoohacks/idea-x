/**
 * Restore points end to end against an in-memory database: what a capture
 * records, what a restore puts back (and the safety copy it takes first), the
 * preview, the listing, and the guard every destructive action goes through.
 *
 * The pruning race has its own fixture in snapshots.test.js.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
const mockCurrentUser = { value: { uid: "admin-1" } };
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = await import("../../testing/fakeDatabase");
const {
  JUDGING_PATHS,
  captureSnapshot,
  guardWith,
  listSnapshots,
  previewSnapshot,
  readJudgeNames,
  restoreSnapshot,
  subscribeToSnapshots,
} = await import("./snapshots");

const teams = { t1: { name: "Lantern" } };

beforeEach(() => {
  mockCurrentUser.value = { uid: "admin-1" };
  db.reset({
    admins: { "admin-1": true },
    judges: { "admin-1": { firstName: "Ada", lastName: "Byron" }, j2: { firstName: "Grace" } },
    teams,
    config: { scheduleMeta: { rounds: 2 } },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const onlySnapshotId = () => Object.keys(db.getData("snapshotIndex"))[0];

describe("capturing", () => {
  test("by default copies every judging path, encoded so a missing one stays null", async () => {
    expect(JUDGING_PATHS).toEqual(["teams", "judges", "scores", "finalRound", "config/scheduleMeta"]);
    const result = await captureSnapshot({ label: "Before clearing" });
    expect(result).toEqual({ ok: true, id: expect.any(String), bytes: expect.any(Number) });

    const { entries } = db.getData(`snapshots/${result.id}`);
    expect(entries).toEqual([
      { path: "teams", value: JSON.stringify(teams) },
      { path: "judges", value: expect.stringContaining('"Grace"') },
      { path: "scores", value: "null" },
      { path: "finalRound", value: "null" },
      { path: "config/scheduleMeta", value: '{"rounds":2}' },
    ]);
    expect(result.bytes).toBe(entries.reduce((sum, entry) => sum + entry.value.length, 0));
  });

  test("indexes who took it, why, of what and how big", async () => {
    const result = await captureSnapshot({ label: "Manual", reason: "just in case", paths: ["teams"] });
    expect(db.getData(`snapshotIndex/${result.id}`)).toEqual({
      at: expect.any(Number),
      by: "admin-1",
      byName: "Ada Byron",
      label: "Manual",
      reason: "just in case",
      paths: ["teams"],
      bytes: JSON.stringify(teams).length,
    });
  });

  test("with no reason given, the reason is left out", async () => {
    const result = await captureSnapshot({ label: "Manual", paths: ["teams"] });
    expect(db.getData(`snapshotIndex/${result.id}/reason`)).toBeNull();
  });

  test("keeps the newest, pruning the oldest entry and its payload together", async () => {
    const index = {};
    const payloads = {};
    for (let i = 0; i < 15; i++) {
      index[`old-${i}`] = { at: 100 + i, label: `old ${i}` };
      payloads[`old-${i}`] = { entries: [{ path: "teams", value: "null" }] };
    }
    // an entry missing its time sorts as the oldest of all
    index.undated = { label: "undated" };
    payloads.undated = { entries: [] };
    db.setData("snapshotIndex", index);
    db.setData("snapshots", payloads);

    const result = await captureSnapshot({ label: "new", paths: ["teams"] });
    const kept = Object.keys(db.getData("snapshotIndex")).sort();
    expect(kept).toHaveLength(15);
    expect(kept).toContain(result.id);
    expect(kept).not.toContain("undated");
    expect(kept).not.toContain("old-0");
    expect(kept).toContain("old-1");
    expect(Object.keys(db.getData("snapshots")).sort()).toEqual(kept);
  });

  test("an index that will not commit is reported, and nothing is saved", async () => {
    vi.spyOn(db.module, "runTransaction").mockResolvedValue({ committed: false });
    await expect(captureSnapshot({ label: "x", paths: ["teams"] })).resolves.toEqual({
      ok: false,
      error: "Could not update the restore point list. Nothing was saved.",
    });
    expect(db.getData("snapshots")).toBeNull();
  });

  test("a failed read or write reports the reason, or a fallback when there is none", async () => {
    const realGet = db.module.get;
    const get = vi
      .spyOn(db.module, "get")
      .mockImplementation((ref) => (ref.path === "teams" ? Promise.reject(new Error("offline")) : realGet(ref)));
    await expect(captureSnapshot({ label: "x", paths: ["teams"] })).resolves.toEqual({ ok: false, error: "offline" });
    expect(console.error).toHaveBeenCalledWith("Could not create a restore point:", expect.any(Error));
    get.mockRestore();

    vi.spyOn(db.module, "update").mockRejectedValueOnce(new Error(""));
    await expect(captureSnapshot({ label: "x", paths: ["teams"] })).resolves.toEqual({
      ok: false,
      error: "The restore point could not be saved.",
    });
  });

  test("only an admin can take one", async () => {
    db.setData("admins", null);
    await expect(captureSnapshot({ label: "x" })).resolves.toEqual({
      ok: false,
      error: "Only an admin can create a restore point",
    });
    expect(db.writes).toEqual([]);
  });
});

describe("restoring", () => {
  async function takeThenChange() {
    const { id } = await captureSnapshot({ label: "Morning", paths: ["teams", "scores"] });
    db.setData("teams", { t9: { name: "Changed" } });
    db.setData("scores", { first: { t9: { j2: { idea: 1 } } } });
    return id;
  }

  test("puts every path back, including ones that did not exist, and logs it", async () => {
    const id = await takeThenChange();
    const result = await restoreSnapshot(id);

    expect(result).toEqual({ ok: true, restored: 2, safetyId: expect.any(String) });
    expect(db.getData("teams")).toEqual(teams);
    expect(db.getData("scores")).toBeNull();

    const [log] = Object.values(db.getData("adminLog"));
    expect(log).toEqual({
      at: expect.any(Number),
      by: "admin-1",
      byName: "Ada Byron",
      action: "snapshot.restore",
      summary: "Restored 2 path(s) from “Morning”. The previous state was saved as a new restore point first.",
      undoable: false,
    });
  });

  test("first saves the state it is about to overwrite, so the restore can be undone", async () => {
    const id = await takeThenChange();
    const { safetyId } = await restoreSnapshot(id);

    expect(db.getData(`snapshotIndex/${safetyId}`)).toMatchObject({
      label: "Before restoring “Morning”",
      reason: "taken automatically so a restore can itself be undone",
      paths: ["teams", "scores"],
    });
    expect(db.getData(`snapshots/${safetyId}/entries`)).toEqual([
      { path: "teams", value: JSON.stringify({ t9: { name: "Changed" } }) },
      { path: "scores", value: JSON.stringify({ first: { t9: { j2: { idea: 1 } } } }) },
    ]);
  });

  test("a restore point with no index entry is named by its id", async () => {
    const id = await takeThenChange();
    db.setData(`snapshotIndex/${id}`, null);
    const { safetyId } = await restoreSnapshot(id);
    expect(db.getData(`snapshotIndex/${safetyId}/label`)).toBe(`Before restoring “${id}”`);
    expect(Object.values(db.getData("adminLog"))[0].summary).toContain(`from “${id}”`);
  });

  test("reads entries stored as a keyed set as well as an array, and a missing value as null", async () => {
    db.setData("snapshots/keyed", {
      entries: { a: { path: "teams", value: '{"t5":{"name":"Keyed"}}' }, b: { path: "finalRound" } },
    });
    db.setData("finalRound", { active: true });
    await expect(restoreSnapshot("keyed")).resolves.toMatchObject({ ok: true, restored: 2 });
    expect(db.getData("teams")).toEqual({ t5: { name: "Keyed" } });
    expect(db.getData("finalRound")).toBeNull();
  });

  test("refuses a missing or empty restore point without writing", async () => {
    await expect(restoreSnapshot("gone")).resolves.toEqual({ ok: false, error: "That restore point no longer exists." });
    db.setData("snapshots/empty", { entries: [] });
    await expect(restoreSnapshot("empty")).resolves.toEqual({ ok: false, error: "That restore point is empty." });
    db.setData("snapshots/blank", { note: "no entries key" });
    await expect(restoreSnapshot("blank")).resolves.toEqual({ ok: false, error: "That restore point is empty." });
    expect(db.writes.filter((w) => w.path === "" || w.op === "transaction")).toEqual([]);
  });

  test("a failed read of the restore point reports why", async () => {
    vi.spyOn(db.module, "get").mockImplementation(async (ref) => {
      if (ref.path.startsWith("admins")) return { exists: () => true, val: () => true };
      throw new Error("");
    });
    await expect(restoreSnapshot("x")).resolves.toEqual({ ok: false, error: "Could not read that restore point." });
  });

  test("changes nothing when the safety copy cannot be taken", async () => {
    const id = await takeThenChange();
    vi.spyOn(db.module, "runTransaction").mockResolvedValue({ committed: false });
    await expect(restoreSnapshot(id)).resolves.toEqual({
      ok: false,
      error:
        "Could not take a restore point of the current state, so nothing was restored. " +
        "Could not update the restore point list. Nothing was saved.",
    });
    expect(db.getData("teams")).toEqual({ t9: { name: "Changed" } });
  });

  test("a failed write reports it, and nothing is half-applied", async () => {
    const id = await takeThenChange();
    const realUpdate = db.module.update;
    let calls = 0;
    vi.spyOn(db.module, "update").mockImplementation((ref, values) => {
      calls += 1;
      // the first update is the safety snapshot; the second is the restore
      return calls === 2 ? Promise.reject(new Error("")) : realUpdate(ref, values);
    });
    await expect(restoreSnapshot(id)).resolves.toEqual({
      ok: false,
      error: "The restore could not be applied. Nothing was changed.",
    });
    expect(console.error).toHaveBeenCalledWith("Restore failed:", expect.any(Error));
    expect(db.getData("teams")).toEqual({ t9: { name: "Changed" } });
  });

  test("a failed write passes on its own message when it has one", async () => {
    const id = await takeThenChange();
    const realUpdate = db.module.update;
    let calls = 0;
    vi.spyOn(db.module, "update").mockImplementation((ref, values) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("PERMISSION_DENIED")) : realUpdate(ref, values);
    });
    await expect(restoreSnapshot(id)).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
  });

  test("only an admin can restore", async () => {
    db.setData("admins", null);
    await expect(restoreSnapshot("x")).resolves.toEqual({
      ok: false,
      error: "Only an admin can restore from a restore point",
    });
  });
});

describe("previewing", () => {
  test("gives the saved entries next to what is live now", async () => {
    const { id } = await captureSnapshot({ label: "p", paths: ["teams", "scores"] });
    db.setData("teams", { t2: { name: "Now" } });
    await expect(previewSnapshot(id)).resolves.toEqual({
      ok: true,
      entries: [
        { path: "teams", value: JSON.stringify(teams) },
        { path: "scores", value: "null" },
      ],
      live: { teams: { t2: { name: "Now" } }, scores: null },
    });
  });

  test("reads keyed entries too", async () => {
    db.setData("snapshots/k", { entries: { a: { path: "teams", value: "null" } } });
    await expect(previewSnapshot("k")).resolves.toMatchObject({ ok: true, entries: [{ path: "teams", value: "null" }] });
  });

  test("refuses a missing or empty one, and reports a failed read", async () => {
    await expect(previewSnapshot("gone")).resolves.toEqual({ ok: false, error: "That restore point no longer exists." });
    db.setData("snapshots/empty", { note: "x" });
    await expect(previewSnapshot("empty")).resolves.toEqual({ ok: false, error: "That restore point is empty." });

    vi.spyOn(db.module, "get").mockRejectedValueOnce(new Error(""));
    await expect(previewSnapshot("x")).resolves.toEqual({ ok: false, error: "Could not read that restore point." });
    vi.spyOn(db.module, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(previewSnapshot("x")).resolves.toEqual({ ok: false, error: "offline" });
  });
});

describe("listing", () => {
  const index = { a: { at: 1, label: "A" }, c: { label: "undated" }, b: { at: 3, label: "B" } };

  test("the list is newest first, undated last", async () => {
    db.setData("snapshotIndex", index);
    expect((await listSnapshots()).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect((await listSnapshots())[0]).toEqual({ id: "b", at: 3, label: "B" });
  });

  test("nothing saved, or a failed read, is an empty list", async () => {
    await expect(listSnapshots()).resolves.toEqual([]);
    vi.spyOn(db.module, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(listSnapshots()).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith("Could not list restore points:", expect.any(Error));
  });

  test("the live list is newest first and follows new captures until stopped", () => {
    db.setData("snapshotIndex", index);
    const seen = [];
    const stop = subscribeToSnapshots((list) => seen.push(list.map((s) => s.id)));
    expect(seen[seen.length - 1]).toEqual(["b", "a", "c"]);
    expect(seen.length).toBe(1);

    db.setData("snapshotIndex/d", { at: 5 });
    expect(seen[seen.length - 1]).toEqual(["d", "b", "a", "c"]);

    stop();
    db.setData("snapshotIndex/e", { at: 9 });
    expect(seen[seen.length - 1]).toEqual(["d", "b", "a", "c"]);
  });

  test("the live list of nothing is empty", () => {
    const callback = vi.fn();
    subscribeToSnapshots(callback);
    expect(callback).toHaveBeenLastCalledWith([]);
  });

  test("a failed live read goes to onError, never to the list", () => {
    const denied = new Error("PERMISSION_DENIED");
    vi.spyOn(db.module, "onValue").mockImplementation((_ref, _ok, fail) => {
      fail(denied);
      return () => {};
    });
    const callback = vi.fn();
    const onError = vi.fn();
    subscribeToSnapshots(callback, onError);
    expect(onError).toHaveBeenCalledWith(denied);
    expect(callback).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Could not watch restore points:", denied);
    expect(() => subscribeToSnapshots(callback)).not.toThrow();
  });
});

describe("judge names for the preview", () => {
  test("full names, falling back to the uid when there is no name", async () => {
    db.setData("judges/j3", { email: "x@y.z" });
    db.setData("judges/j4", { firstName: "  ", lastName: "" });
    db.setData("judges/j5", { lastName: "Hopper" });
    await expect(readJudgeNames()).resolves.toEqual({
      ok: true,
      names: { "admin-1": "Ada Byron", j2: "Grace", j3: "j3", j4: "j4", j5: "Hopper" },
    });
  });

  test("no judges is an empty map, and a failed read still gives one", async () => {
    db.setData("judges", null);
    await expect(readJudgeNames()).resolves.toEqual({ ok: true, names: {} });
    vi.spyOn(db.module, "get").mockRejectedValueOnce(new Error(""));
    await expect(readJudgeNames()).resolves.toEqual({ ok: false, error: "Could not load judges.", names: {} });
    vi.spyOn(db.module, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(readJudgeNames()).resolves.toEqual({ ok: false, error: "offline", names: {} });
  });
});

describe("guarding a destructive action", () => {
  test("takes a restore point of the judging paths and hands back its id", async () => {
    const result = await guardWith({ label: "Clear the schedule", reason: "clear" });
    expect(result).toEqual({ ok: true, snapshotId: onlySnapshotId(), bytes: expect.any(Number) });
    expect(db.getData(`snapshotIndex/${result.snapshotId}`)).toMatchObject({
      label: "Clear the schedule",
      reason: "clear",
      paths: JUDGING_PATHS,
    });
  });

  test("can guard just the paths given", async () => {
    const { snapshotId } = await guardWith({ label: "x", reason: "y", paths: ["teams"] });
    expect(db.getData(`snapshotIndex/${snapshotId}/paths`)).toEqual(["teams"]);
  });

  test("refuses to let the action go ahead when the copy fails", async () => {
    db.setData("admins", null);
    await expect(guardWith({ label: "x", reason: "y" })).resolves.toEqual({
      ok: false,
      error: "Could not create a restore point, so nothing was changed. Only an admin can create a restore point",
    });
  });
});

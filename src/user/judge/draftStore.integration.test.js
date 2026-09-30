/**
 * The shared first-round schedule draft against an in-memory database with the
 * real admin check: the edit-list encoding, the save stamps, every refusal's
 * wording, and the read, clear and live subscription. draftStore.test.js and
 * draftConcurrency.test.js cover the version race against scripted reads.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../testing/fakeDatabase");
const { readDraft, saveDraft, clearDraft, subscribeDraft } = require("./draftStore");

const PATH = "scheduleDraft";
const plan = (overrides = {}) => ({
  version: 0,
  assignments: { t1: { id: "t1", room: "Rice 340", judges: [{ judgeId: "j1" }] } },
  basis: { teamIds: ["t1"], batchTimes: { 1: "5:00 PM" } },
  edits: [{ kind: "move", teamId: "t1" }],
  ...overrides,
});

beforeEach(() => {
  db.reset({ admins: { "admin-1": true }, judges: { "admin-1": { firstName: "Ada", lastName: "Byron" } } });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("saving and reading back", () => {
  test("a first save stamps who made it, and reads back as the same plan", async () => {
    await expect(saveDraft(plan())).resolves.toEqual({ ok: true, version: 1 });
    expect(db.getData(PATH)).toMatchObject({
      version: 1,
      createdAt: expect.any(Number),
      createdBy: "admin-1",
      createdByName: "Ada Byron",
      edits: { "0000": { kind: "move", teamId: "t1" } },
    });
    await expect(readDraft()).resolves.toEqual({
      ...plan(),
      version: 1,
      createdAt: expect.any(Number),
      createdBy: "admin-1",
      createdByName: "Ada Byron",
    });
  });

  test("more than ten edits keep their order", async () => {
    const edits = Array.from({ length: 12 }, (_, i) => ({ kind: "move", n: i }));
    await saveDraft(plan({ edits }));
    expect(Object.keys(db.getData(`${PATH}/edits`))[11]).toBe("0011");
    expect((await readDraft()).edits).toEqual(edits);
  });

  test("a plan with no edit list saves an empty one", async () => {
    await saveDraft(plan({ edits: undefined }));
    expect((await readDraft()).edits).toEqual([]);
  });

  test("a later save keeps the original stamp and bumps the version", async () => {
    db.setData(PATH, { version: 4, createdAt: 11, createdBy: "admin-2", createdByName: "Grace" });
    await expect(saveDraft(plan({ version: 4 }))).resolves.toEqual({ ok: true, version: 5 });
    expect(db.getData(PATH)).toMatchObject({ version: 5, createdAt: 11, createdBy: "admin-2", createdByName: "Grace" });
  });

  test("a plan with no version saves as version one", async () => {
    await expect(saveDraft(plan({ version: undefined }))).resolves.toEqual({ ok: true, version: 1 });
  });

  test("the save is a transaction that is not applied locally first", async () => {
    const transaction = jest.spyOn(db.module, "runTransaction");
    await saveDraft(plan());
    expect(transaction).toHaveBeenCalledWith(expect.objectContaining({ path: PATH }), expect.any(Function), { applyLocally: false });
  });
});

describe("what a stored draft decodes to", () => {
  const read = async (raw) => {
    db.setData(PATH, raw);
    return readDraft();
  };

  test("empty panels and a missing times map come back", async () => {
    await expect(read({ version: 1, assignments: { t1: { id: "t1" }, t2: null }, basis: { teamIds: ["t1"] } })).resolves.toEqual({
      version: 1,
      assignments: { t1: { id: "t1", judges: [] }, t2: null },
      basis: { teamIds: ["t1"], batchTimes: {} },
      edits: [],
    });
  });

  test("nothing but a version still decodes to a usable draft", async () => {
    await expect(read({ version: 2 })).resolves.toEqual({ version: 2, assignments: {}, basis: { batchTimes: {} }, edits: [] });
  });

  test("keyed edits come back in key order, with an edit's saved panel filled in", async () => {
    const draft = await read({ version: 1, edits: { "0001": { kind: "b" }, "0000": { kind: "a", before: { id: "t1" } } } });
    expect(draft.edits).toEqual([{ kind: "a", before: { id: "t1", judges: [] } }, { kind: "b" }]);
  });

  test("an edit list stored as an array is read in its own order, holes and all", async () => {
    const edits = Array.from({ length: 12 }, (_, i) => ({ kind: "move", n: i }));
    edits[3] = null;
    const draft = await read({ version: 1, edits });
    expect(draft.edits).toEqual(edits);
  });

  test("an edit list that is not a list at all is empty", async () => {
    await expect(read({ version: 1, edits: "corrupt" })).resolves.toMatchObject({ edits: [] });
  });

  test("no draft reads as null", async () => {
    await expect(readDraft()).resolves.toBeNull();
  });
});

describe("refusals", () => {
  test("a draft discarded while editing is not brought back", async () => {
    await expect(saveDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error:
        "This draft was discarded while you were editing it. Build a new plan -- your edits cannot be re-applied to a draft that no longer exists.",
    });
    expect(db.getData(PATH)).toBeNull();
  });

  test("a draft someone else moved on is refused, naming them or not", async () => {
    db.setData(PATH, { version: 3, createdByName: "Grace" });
    await expect(saveDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error: "Grace changed this draft while you were looking. Reload the preview to pick up their version.",
    });
    db.setData(PATH, { version: 3 });
    await expect(saveDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error: "Another organizer changed this draft while you were looking. Reload the preview to pick up their version.",
    });
    expect(db.getData(`${PATH}/version`)).toBe(3);
  });

  test("losing the race at the write names whoever won, or not", async () => {
    const real = db.module.runTransaction;
    const race = (winner) =>
      jest.spyOn(db.module, "runTransaction").mockImplementationOnce(async (ref, updater, options) => {
        db.setData(PATH, winner);
        return real(ref, updater, options);
      });

    race({ version: 1, createdByName: "Grace" });
    await expect(saveDraft(plan())).resolves.toEqual({
      ok: false,
      error: "Grace saved this draft first. Reload the preview to pick up their version.",
    });
    db.setData(PATH, null);
    race({ version: 1 });
    await expect(saveDraft(plan())).resolves.toEqual({
      ok: false,
      error: "Another organizer saved this draft first. Reload the preview to pick up their version.",
    });
  });

  test("only an admin can read, save or clear, each saying which", async () => {
    db.setData(PATH, { version: 1 });
    db.setData("admins", null);
    await expect(saveDraft(plan())).resolves.toEqual({ ok: false, error: "Only an admin can save the schedule draft" });
    await expect(clearDraft()).resolves.toEqual({ ok: false, error: "Only an admin can clear the schedule draft" });
    await expect(readDraft()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "Could not read the schedule draft:",
      expect.objectContaining({ message: "Only an admin can read the schedule draft" })
    );
    expect(db.getData(PATH)).toEqual({ version: 1 });
  });

  test("a failed save or clear is reported in words, or with the reason given", async () => {
    const realGet = db.module.get;
    jest.spyOn(db.module, "get").mockImplementation((ref) => (ref.path === PATH ? Promise.reject(new Error("")) : realGet(ref)));
    await expect(saveDraft(plan())).resolves.toEqual({ ok: false, error: "The draft could not be saved." });
    expect(console.error).toHaveBeenCalledWith("Could not save the schedule draft:", expect.any(Error));

    jest.spyOn(db.module, "update").mockRejectedValueOnce(new Error(""));
    await expect(clearDraft()).resolves.toEqual({ ok: false, error: "The draft could not be cleared." });
    expect(console.error).toHaveBeenCalledWith("Could not clear the schedule draft:", expect.any(Error));
    jest.spyOn(db.module, "update").mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    await expect(clearDraft()).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
  });
});

describe("clearing and watching", () => {
  test("clearing removes it", async () => {
    db.setData(PATH, { version: 1 });
    await expect(clearDraft()).resolves.toEqual({ ok: true });
    expect(db.getData(PATH)).toBeNull();
  });

  test("watching delivers each decoded version until stopped", () => {
    const seen = [];
    const stop = subscribeDraft((draft) => seen.push(draft && draft.version));
    db.setData(PATH, { version: 1 });
    db.setData(PATH, { version: 2, edits: { "0000": { kind: "a" } } });
    stop();
    db.setData(PATH, { version: 3 });
    expect(seen).toEqual([null, 1, 2]);
  });

  test("a failed watch delivers null, and logs it", () => {
    const denied = new Error("PERMISSION_DENIED");
    jest.spyOn(db.module, "onValue").mockImplementation((_ref, _ok, fail) => {
      fail(denied);
      return () => {};
    });
    const callback = jest.fn();
    subscribeDraft(callback);
    expect(callback).toHaveBeenCalledWith(null);
    expect(console.error).toHaveBeenCalledWith("Could not watch the schedule draft:", denied);
  });
});

/**
 * The audit log against an in-memory database with the real admin check: the
 * name it records for whoever acted, the oversize cut-off, and undo's every
 * refusal and its write. adminAction.test.js covers the same paths against
 * scripted reads.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "admin-uid-123456" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("../../testing/fakeDatabase");
const {
  UNDO_SIZE_CAP,
  decodeChanges,
  resolveName,
  applyAdminAction,
  findDrift,
  undoAdminAction,
} = require("./adminAction");

const ADMIN = "admin-uid-123456";
const realGet = db.module.get;

beforeEach(() => {
  mockCurrentUser.value = { uid: ADMIN };
  db.reset({ admins: { [ADMIN]: true }, teams: { t1: { name: "Lantern" } } });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const onlyLog = () => {
  const entries = Object.entries(db.getData("adminLog") ?? {});
  return entries.map(([id, entry]) => ({ id, ...entry }));
};

describe("who acted", () => {
  test("a judge record's full name", async () => {
    db.setData(`judges/${ADMIN}`, { firstName: "Ada", lastName: "Byron" });
    await expect(resolveName(ADMIN)).resolves.toBe("Ada Byron");
  });

  test("a competitor record when there is no judge one, and a padded name trimmed", async () => {
    db.setData(`competitors/${ADMIN}`, { firstName: " Grace ", lastName: "" });
    await expect(resolveName(ADMIN)).resolves.toBe("Grace");
  });

  test("a nameless judge record falls through to the competitor one", async () => {
    db.setData(`judges/${ADMIN}`, { email: "x@y.z" });
    db.setData(`competitors/${ADMIN}`, { lastName: "Hopper" });
    await expect(resolveName(ADMIN)).resolves.toBe("Hopper");
  });

  test("nobody on record is 'admin' and the start of the uid", async () => {
    await expect(resolveName(ADMIN)).resolves.toBe("admin admin-ui");
  });

  test("a denied read is skipped, not fatal", async () => {
    db.setData(`competitors/${ADMIN}`, { firstName: "Grace" });
    const realGet = db.module.get;
    jest.spyOn(db.module, "get").mockImplementation((ref) => (ref.path.startsWith("judges") ? Promise.reject(new Error("denied")) : realGet(ref)));
    await expect(resolveName(ADMIN)).resolves.toBe("Grace");
  });
});

describe("applying an action", () => {
  test("writes the change and an entry naming who did it", async () => {
    db.setData(`judges/${ADMIN}`, { firstName: "Ada" });
    const result = await applyAdminAction({
      action: "team.rename",
      summary: "Renamed it",
      changes: [{ path: "teams/t1/name", before: "Lantern", after: "Beacon" }],
    });
    expect(result).toEqual({ ok: true, entryId: expect.any(String) });
    expect(db.getData("teams/t1/name")).toBe("Beacon");
    const [entry] = onlyLog();
    expect(entry).toEqual({
      id: result.entryId,
      at: expect.any(Number),
      by: ADMIN,
      byName: "Ada",
      action: "team.rename",
      summary: "Renamed it",
      undoable: true,
      changes: [{ path: "teams/t1/name", before: '"Lantern"', after: '"Beacon"' }],
    });
  });

  test("with no changes it still logs, and can be marked not undoable", async () => {
    await applyAdminAction({ action: "note", summary: "Just a note", undoable: false });
    expect(onlyLog()[0]).toMatchObject({ undoable: false });
    // the real database drops an empty list; the fake keeps it
    expect(onlyLog()[0].changes ?? []).toEqual([]);
  });

  test("a summary is cut to 500 characters", async () => {
    await applyAdminAction({ action: "x", summary: "s".repeat(600), changes: [] });
    expect(onlyLog()[0].summary).toHaveLength(500);
  });

  test("right at the size cap the change is still recorded; one byte over, only counted", async () => {
    // encoded overhead for one change at path "p" with before null
    const overhead = JSON.stringify([{ path: "p", before: "null", after: JSON.stringify("") }]).length;
    const fill = (n) => "x".repeat(n);
    const atCap = fill(UNDO_SIZE_CAP - overhead);
    // JSON.stringify of a string inside a string escapes its quotes, so measure the real thing
    const size = (value) => JSON.stringify([{ path: "p", before: "null", after: JSON.stringify(value) }]).length;
    let value = atCap;
    while (size(value) > UNDO_SIZE_CAP) value = value.slice(1);
    while (size(value + "x") <= UNDO_SIZE_CAP) value += "x";
    expect(size(value)).toBe(UNDO_SIZE_CAP);

    await applyAdminAction({ action: "big", summary: "Big", changes: [{ path: "p", before: null, after: value }] });
    expect(onlyLog()[0]).toMatchObject({ summary: "Big", undoable: true });

    db.setData("adminLog", null);
    await applyAdminAction({ action: "big", summary: "Big", changes: [{ path: "p", before: null, after: value + "x" }] });
    expect(onlyLog()[0]).toMatchObject({ summary: "Big (1 paths, too large to undo)", undoable: false });
    expect(onlyLog()[0]).not.toHaveProperty("changes");
  });

  test("an oversize change with a restore point says where to undo it from", async () => {
    const big = "y".repeat(UNDO_SIZE_CAP);
    await applyAdminAction({ action: "big", summary: "Wiped", changes: [{ path: "a", after: big }, { path: "b", after: 1 }], hasRestorePoint: true });
    expect(onlyLog()[0]).toMatchObject({ summary: "Wiped (2 paths; undo from Restore points)", undoable: false });
  });

  test("an oversize note is also cut to 500 characters", async () => {
    await applyAdminAction({ action: "big", summary: "s".repeat(600), changes: [{ path: "a", after: "y".repeat(UNDO_SIZE_CAP) }] });
    expect(onlyLog()[0].summary).toHaveLength(500);
  });

  test("a non-admin is refused with the action named, and nothing is written", async () => {
    db.setData("admins", null);
    await expect(applyAdminAction({ action: "team.rename", summary: "x", changes: [{ path: "teams/t1/name", after: "B" }] })).resolves.toEqual({
      ok: false,
      error: "Only an admin can team.rename",
    });
    expect(db.getData("teams/t1/name")).toBe("Lantern");
  });

  test("a failed write is reported with its reason or a fallback, and logged", async () => {
    db.failWrites(1);
    await expect(applyAdminAction({ action: "a1", summary: "x", changes: [] })).resolves.toEqual({
      ok: false,
      error: "PERMISSION_DENIED: Client doesn't have permission",
    });
    expect(console.error).toHaveBeenCalledWith("Admin action a1 failed:", expect.any(Error));
    jest.spyOn(db.module, "update").mockRejectedValueOnce(new Error(""));
    await expect(applyAdminAction({ action: "a2", summary: "x", changes: [] })).resolves.toEqual({
      ok: false,
      error: "The change could not be saved.",
    });
  });
});

describe("the drift check", () => {
  test("names the path, what was expected and what is there, treating absent as null", () => {
    expect(findDrift([{ path: "p", after: undefined }], { p: 5 })).toEqual({ path: "p", expected: null, actual: 5 });
    expect(findDrift([{ path: "p", after: 5 }], {})).toEqual({ path: "p", expected: 5, actual: null });
  });
});

describe("undoing", () => {
  const rename = async () => {
    const { entryId } = await applyAdminAction({
      action: "team.rename",
      summary: "Renamed Lantern to Beacon",
      changes: [{ path: "teams/t1/name", before: "Lantern", after: "Beacon" }],
    });
    return entryId;
  };

  test("puts the value back, logs the undo, and marks the original", async () => {
    const id = await rename();
    const result = await undoAdminAction(id);
    expect(result).toEqual({ ok: true, entryId: expect.any(String) });
    expect(db.getData("teams/t1/name")).toBe("Lantern");
    expect(db.getData(`adminLog/${id}/undone`)).toEqual({ at: expect.any(Number), by: ADMIN });
    const undo = db.getData(`adminLog/${result.entryId}`);
    expect(undo).toMatchObject({ action: "undo:team.rename", summary: "Undid: Renamed Lantern to Beacon", undoable: false });
    expect(decodeChanges(undo.changes)[0]).toEqual({ path: "teams/t1/name", before: "Beacon", after: "Lantern" });
  });

  test("refuses a second undo", async () => {
    const id = await rename();
    await undoAdminAction(id);
    await expect(undoAdminAction(id)).resolves.toEqual({ ok: false, error: "That change has already been undone." });
  });

  test("refuses when the value has moved since, saying which path", async () => {
    const id = await rename();
    db.setData("teams/t1/name", "Compass");
    await expect(undoAdminAction(id)).resolves.toEqual({
      ok: false,
      error: "teams/t1/name has changed since this action, so undoing it would discard that edit. Nothing was changed.",
      drift: { path: "teams/t1/name", expected: "Beacon", actual: "Compass" },
    });
    expect(db.getData("teams/t1/name")).toBe("Compass");
  });

  test("refuses when the value moves in the last moment before the write", async () => {
    const id = await rename();
    const real = db.module.get;
    let adminChecks = 0;
    jest.spyOn(db.module, "get").mockImplementation((ref) => {
      if (ref.path.startsWith("admins/")) {
        adminChecks += 1;
        // the second admin check is applyAdminAction's own; land another edit just before it
        if (adminChecks === 2) db.setData("teams/t1/name", "Late edit");
      }
      return real(ref);
    });
    await expect(undoAdminAction(id)).resolves.toEqual({
      ok: false,
      error: "teams/t1/name has changed since this action, so undoing it would discard that edit. Nothing was changed.",
      drift: { path: "teams/t1/name", expected: "Beacon", actual: "Late edit" },
    });
    expect(db.getData("teams/t1/name")).toBe("Late edit");
  });

  test("refuses an entry that is gone, not undoable, or has no changes", async () => {
    await expect(undoAdminAction("nope")).resolves.toEqual({ ok: false, error: "That log entry no longer exists." });
    db.setData("adminLog/big", { action: "big", undoable: false });
    await expect(undoAdminAction("big")).resolves.toEqual({
      ok: false,
      error: "That change cannot be undone. It was too large to record in full.",
    });
    db.setData("adminLog/bare", { action: "bare", undoable: true });
    await expect(undoAdminAction("bare")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/cannot be undone/) });
  });

  test("a failed read of the entry or the current values is reported", async () => {
    jest.spyOn(db.module, "get").mockRejectedValueOnce(new Error(""));
    await expect(undoAdminAction("x")).resolves.toEqual({ ok: false, error: "Could not read that log entry." });
    jest.spyOn(db.module, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(undoAdminAction("x")).resolves.toEqual({ ok: false, error: "offline" });

    jest.restoreAllMocks();
    const id = await rename();
    jest.spyOn(db.module, "get").mockImplementation((ref) => (ref.path === "teams/t1/name" ? Promise.reject(new Error("")) : realGet(ref)));
    await expect(undoAdminAction(id)).resolves.toEqual({ ok: false, error: "Could not check the current values." });
  });

  test("only an admin can undo", async () => {
    const id = await rename();
    db.setData("admins", null);
    await expect(undoAdminAction(id)).resolves.toEqual({ ok: false, error: "Only an admin can undo a change" });
  });

  test("reads changes stored as a keyed set, with a missing side as null", async () => {
    db.setData("teams/t1/name", "Beacon");
    db.setData("adminLog/keyed", {
      action: "a",
      summary: "s",
      undoable: true,
      changes: { k0: { path: "teams/t1/name", before: '"Lantern"', after: '"Beacon"' }, k1: { path: "teams/t1/extra" } },
    });
    await expect(undoAdminAction("keyed")).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1")).toEqual({ name: "Lantern" });
  });
});

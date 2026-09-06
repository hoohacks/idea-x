/**
 * The primitive every admin write goes through.
 *
 * The property that matters: the change and its log entry are in ONE update
 * call. Two calls would let a change land with no record of it, which is
 * exactly the situation the log exists to explain.
 */
jest.mock("../../firebase", () => ({ database: {}, auth: {} }));

const mockUpdate = jest.fn(async () => {});
const mockGet = jest.fn(async () => ({ exists: () => false, val: () => null }));

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "entry-1" }),
  serverTimestamp: () => 1700000000000,
}));

jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "admin-1" } }),
}));

jest.mock("../../roles.js", () => ({
  requireAdmin: jest.fn(async () => ({ uid: "admin-1" })),
}));

const {
  encodeChanges,
  decodeChanges,
  applyAdminAction,
  UNDO_SIZE_CAP,
} = require("./adminAction");
const { requireAdmin } = require("../../roles.js");

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation off
 * every jest.fn before each test -- so an implementation passed to jest.fn() at
 * declaration is gone by the time the first test runs, and the mock silently
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

describe("encoding survives what Realtime Database does to values", () => {
  test("null round-trips, because RTDB drops a literal null on write", () => {
    const [encoded] = encodeChanges([{ path: "a/b", before: null, after: 3 }]);
    expect(encoded.before).toBe("null");
    expect(decodeChanges([encoded])[0].before).toBeNull();
  });

  test("objects and arrays round-trip", () => {
    const changes = [{ path: "config/judgingRooms", before: ["A", "B"], after: ["A"] }];
    expect(decodeChanges(encodeChanges(changes))).toEqual(changes);
  });

  test("false and empty string are preserved, not treated as absent", () => {
    const changes = [{ path: "t/submitted", before: true, after: false }];
    expect(decodeChanges(encodeChanges(changes))[0].after).toBe(false);
  });
});

describe("the change and its log entry land together", () => {
  test("one update call carries both", async () => {
    const result = await applyAdminAction({
      action: "team.rename",
      summary: "Alpha to Omega",
      changes: [{ path: "teams/t1/name", before: "Alpha", after: "Omega" }],
    });

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const payload = mockUpdate.mock.calls[0][1];
    expect(payload["teams/t1/name"]).toBe("Omega");
    expect(payload["adminLog/entry-1"]).toMatchObject({
      action: "team.rename",
      by: "admin-1",
      undoable: true,
    });
  });

  test("the entry records the author, never a caller-supplied one", async () => {
    await applyAdminAction({ action: "x", summary: "y", changes: [] });
    expect(mockUpdate.mock.calls[0][1]["adminLog/entry-1"].by).toBe("admin-1");
  });

  test("an oversized change-set logs counts only and refuses undo", async () => {
    const big = Array.from({ length: 400 }, (_, i) => ({
      path: `teams/t${i}/schedule`,
      before: { room: "Rice 110", notes: "x".repeat(200) },
      after: null,
    }));

    await applyAdminAction({ action: "schedule.clear", summary: "cleared", changes: big });

    const entry = mockUpdate.mock.calls[0][1]["adminLog/entry-1"];
    expect(entry.undoable).toBe(false);
    expect(entry.changes).toBeUndefined();
    expect(entry.summary).toContain("400");
    // the changes themselves are still applied -- only the record is trimmed
    expect(mockUpdate.mock.calls[0][1]["teams/t0/schedule"]).toBeNull();
  });

  test("the cap is a byte budget, not a count", () => {
    expect(UNDO_SIZE_CAP).toBe(50000);
  });
});

describe("failure is returned, never thrown", () => {
  test("a rejected write comes back as { ok: false }", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    const result = await applyAdminAction({ action: "x", summary: "y", changes: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
  });

  test("a non-admin caller comes back as { ok: false }", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("Only an admin can x"));
    const result = await applyAdminAction({ action: "x", summary: "y", changes: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Only an admin");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

const { reverseChanges, findDrift, undoAdminAction } = require("./adminAction");

describe("reversing a change-set", () => {
  test("before and after swap", () => {
    expect(reverseChanges([{ path: "a", before: 1, after: 2 }]))
      .toEqual([{ path: "a", before: 2, after: 1 }]);
  });

  test("a create reverses into a delete", () => {
    expect(reverseChanges([{ path: "a", before: null, after: { x: 1 } }]))
      .toEqual([{ path: "a", before: { x: 1 }, after: null }]);
  });
});

describe("the drift check", () => {
  /**
   * Undo restores a captured value. If someone else edited the same path since,
   * a naive undo silently discards their work -- so it refuses instead, and says
   * which path moved.
   */
  test("passes when nothing moved", () => {
    const changes = [{ path: "teams/t1/name", before: "Alpha", after: "Omega" }];
    expect(findDrift(changes, { "teams/t1/name": "Omega" })).toBeNull();
  });

  test("catches a later edit and names the path", () => {
    const changes = [{ path: "teams/t1/name", before: "Alpha", after: "Omega" }];
    const drift = findDrift(changes, { "teams/t1/name": "Something Else" });
    expect(drift.path).toBe("teams/t1/name");
    expect(drift.actual).toBe("Something Else");
  });

  test("compares structurally, not by reference", () => {
    const changes = [{ path: "config/judgingRooms", before: ["A"], after: ["A", "B"] }];
    expect(findDrift(changes, { "config/judgingRooms": ["A", "B"] })).toBeNull();
  });

  test("an absent path matches a null after-value", () => {
    const changes = [{ path: "teams/t1/schedule", before: { room: "A" }, after: null }];
    expect(findDrift(changes, { "teams/t1/schedule": null })).toBeNull();
  });
});

describe("undoing an entry", () => {
  const logged = {
    action: "team.rename",
    summary: "Alpha to Omega",
    undoable: true,
    changes: [{ path: "teams/t1/name", before: '"Alpha"', after: '"Omega"' }],
  };

  function whenLogSays(entry, currentValues = {}) {
    mockGet.mockImplementation(async (r) => {
      if (r.path.startsWith("adminLog/")) {
        return { exists: () => Boolean(entry), val: () => entry };
      }
      const value = currentValues[r.path];
      return { exists: () => value !== undefined, val: () => value };
    });
  }

  test("applies the reverse and marks the original undone", async () => {
    whenLogSays(logged, { "teams/t1/name": "Omega" });

    const result = await undoAdminAction("entry-0");
    expect(result.ok).toBe(true);

    const payload = mockUpdate.mock.calls[0][1];
    expect(payload["teams/t1/name"]).toBe("Alpha");
    expect(payload["adminLog/entry-0/undone"]).toMatchObject({ by: "admin-1" });
  });

  test("the undo is itself logged", async () => {
    whenLogSays(logged, { "teams/t1/name": "Omega" });
    await undoAdminAction("entry-0");
    expect(mockUpdate.mock.calls[0][1]["adminLog/entry-1"].action).toBe("undo:team.rename");
  });

  test("refuses when the value moved since, naming the path", async () => {
    whenLogSays(logged, { "teams/t1/name": "Edited By Someone Else" });

    const result = await undoAdminAction("entry-0");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("teams/t1/name");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("refuses an entry marked not undoable", async () => {
    whenLogSays({ ...logged, undoable: false });
    const result = await undoAdminAction("entry-0");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot be undone/i);
  });

  test("refuses an entry already undone", async () => {
    whenLogSays({ ...logged, undone: { at: 1, by: "admin-2" } });
    const result = await undoAdminAction("entry-0");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been undone/i);
  });

  test("refuses an entry that is not there", async () => {
    whenLogSays(null);
    const result = await undoAdminAction("missing");
    expect(result.ok).toBe(false);
  });

  /**
   * The drift check above runs once, early, using values read before
   * `requireAdmin` and `applyAdminAction`'s own work (resolving the acting
   * admin's name, building the log entry) are awaited. A write landing in
   * that window passed a check that was already stale by the time the
   * update actually went out -- undo would silently clobber it and still
   * report success.
   *
   * `requireAdmin` is where this test lands that write: undo awaits it
   * twice (once directly, once again inside `applyAdminAction`), which is
   * exactly the kind of gap a real second admin's action would land in.
   */
  test("a write landing while requireAdmin is pending is refused, not clobbered", async () => {
    let liveValue = "Omega"; // matches the log entry's `after` -- the early check passes
    mockGet.mockImplementation(async (r) => {
      if (r.path.startsWith("adminLog/")) return { exists: () => Boolean(logged), val: () => logged };
      if (r.path === "teams/t1/name") return { exists: () => true, val: () => liveValue };
      return { exists: () => false, val: () => null };
    });

    // Simulates another organizer's edit landing in the exact window the bug
    // names: after the early drift check passed, while undo is still waiting
    // on requireAdmin.
    requireAdmin.mockImplementation(async () => {
      liveValue = "Edited By Someone Else";
      return { uid: "admin-1" };
    });

    const result = await undoAdminAction("entry-0");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("teams/t1/name");
    expect(mockUpdate).not.toHaveBeenCalled();
    // the edit that landed mid-flight must survive, not be silently reverted
    expect(liveValue).toBe("Edited By Someone Else");
  });
});

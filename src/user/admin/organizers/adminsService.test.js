/**
 * Who is an organizer.
 *
 * /admins is only writable by an admin, so nothing in the app can create the
 * first one -- docs/deployment.md documents the bootstrap by hand in the Firebase
 * console. That makes emptying /admins unrecoverable from inside the app, which
 * is why revokeGuard exists and why it is a pure function with its own tests.
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

const { revokeGuard, grantAdmin, revokeAdmin } = require("./adminsService");
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

describe("the two revokes that must never go through", () => {
  test("you cannot revoke yourself", () => {
    const reason = revokeGuard({ uid: "a1", currentUid: "a1", adminUids: ["a1", "a2"] });
    expect(reason).toMatch(/yourself|your own/i);
  });

  test("you cannot revoke the last admin", () => {
    const reason = revokeGuard({ uid: "a1", currentUid: "a2", adminUids: ["a1"] });
    expect(reason).toMatch(/last/i);
  });

  test("revoking the last admin is refused even when it is you", () => {
    expect(revokeGuard({ uid: "a1", currentUid: "a1", adminUids: ["a1"] })).not.toBeNull();
  });

  test("revoking someone else while others remain is allowed", () => {
    expect(revokeGuard({ uid: "a2", currentUid: "a1", adminUids: ["a1", "a2"] })).toBeNull();
  });

  test("revoking someone who is not an admin is refused", () => {
    expect(revokeGuard({ uid: "nobody", currentUid: "a1", adminUids: ["a1", "a2"] }))
      .toMatch(/not an admin/i);
  });
});

describe("granting", () => {
  test("writes true at the uid and logs it", async () => {
    const result = await grantAdmin({ uid: "u9", name: "Sam Lee" });
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["admins/u9"]).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["adminLog/entry-1"].summary).toContain("Sam Lee");
  });

  test("granting someone who already has it is refused", async () => {
    mockGet.mockImplementation(async (r) =>
      r.path === "admins" ? { exists: () => true, val: () => ({ u9: true }) }
                          : { exists: () => false, val: () => null });

    const result = await grantAdmin({ uid: "u9", name: "Sam Lee" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("granting with no uid is refused", async () => {
    expect((await grantAdmin({ uid: "", name: "x" })).ok).toBe(false);
  });
});

describe("revoking", () => {
  test("removes the uid when the guards pass", async () => {
    mockGet.mockImplementation(async (r) =>
      r.path === "admins"
        ? { exists: () => true, val: () => ({ "admin-1": true, u9: true }) }
        : { exists: () => false, val: () => null });

    const result = await revokeAdmin("u9");
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["admins/u9"]).toBeNull();
  });

  test("the guard is enforced by the service, not just the UI", async () => {
    mockGet.mockImplementation(async (r) =>
      r.path === "admins"
        ? { exists: () => true, val: () => ({ "admin-1": true }) }
        : { exists: () => false, val: () => null });

    const result = await revokeAdmin("admin-1");
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

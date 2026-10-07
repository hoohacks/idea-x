/**
 * Granting and revoking organizer access against an in-memory database with
 * the real audit log and admin check: what is written, what the feed says, and
 * the two revokes that must never go through, word for word.
 */
jest.mock("../../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "a1" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("../../../testing/fakeDatabase");
const { listAdmins, grantAdmin, revokeAdmin, revokeGuard } = require("./adminsService");
const { decodeChanges } = require("../adminAction");

beforeEach(() => {
  mockCurrentUser.value = { uid: "a1" };
  db.reset({ admins: { a1: true, a2: true } });
});

const lastLog = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  const entry = entries[entries.length - 1];
  return { ...entry, changes: decodeChanges(entry.changes) };
};

test("lists the organizers, or nobody", async () => {
  await expect(listAdmins()).resolves.toEqual(["a1", "a2"]);
  db.setData("admins", null);
  await expect(listAdmins()).resolves.toEqual([]);
});

describe("granting", () => {
  test("sets the flag and logs it by name, or by uid", async () => {
    await expect(grantAdmin({ uid: "u3", name: "Grace" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("admins/u3")).toBe(true);
    expect(lastLog()).toMatchObject({
      action: "admin.grant",
      summary: "Made Grace an admin",
      changes: [{ path: "admins/u3", before: null, after: true }],
    });
    await grantAdmin({ uid: "u4" });
    expect(lastLog().summary).toBe("Made u4 an admin");
  });

  test("refuses nobody, or somebody who already is one", async () => {
    await expect(grantAdmin({ uid: "" })).resolves.toEqual({ ok: false, error: "Pick a person first." });
    await expect(grantAdmin({ uid: "a2", name: "Bo" })).resolves.toEqual({ ok: false, error: "Bo is already an admin." });
    await expect(grantAdmin({ uid: "a2" })).resolves.toEqual({ ok: false, error: "a2 is already an admin." });
  });
});

describe("revoking", () => {
  test("clears the flag and logs it by name, or by uid", async () => {
    db.setData("admins/a3", true);
    await expect(revokeAdmin("a2", { name: "Bo" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("admins/a2")).toBeNull();
    expect(lastLog()).toMatchObject({
      action: "admin.revoke",
      summary: "Removed admin access from Bo",
      changes: [{ path: "admins/a2", before: true, after: null }],
    });
    await revokeAdmin("a3");
    expect(lastLog().summary).toBe("Removed admin access from a3");
  });

  test("refuses the last organizer, yourself, or somebody who is not one", async () => {
    await expect(revokeAdmin("a1")).resolves.toEqual({
      ok: false,
      error: "You cannot remove your own admin access. Ask another admin to do it.",
    });
    await expect(revokeAdmin("u9")).resolves.toEqual({ ok: false, error: "That person is not an admin." });
    db.setData("admins", { a1: true });
    await expect(revokeAdmin("a1")).resolves.toEqual({
      ok: false,
      error:
        "That is the last admin. Removing them would lock everyone out -- /admins can only be written by an admin, so nothing in the app could add one back. Grant someone else first.",
    });
  });

  test("with nobody signed in, the guard still refuses the last organizer", () => {
    expect(revokeGuard({ uid: "a1", currentUid: null, adminUids: ["a1"] })).toMatch(/^That is the last admin/);
  });

  test("when signed out the check sees no current user, so it does not mistake anyone for you", async () => {
    mockCurrentUser.value = null;
    // the guard passes (a2 is not "you"), and the write is then refused by the admin check
    await expect(revokeAdmin("a2")).resolves.toEqual({ ok: false, error: "Must be signed in to admin.revoke" });
  });
});

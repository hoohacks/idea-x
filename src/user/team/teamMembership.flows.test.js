/**
 * The three things a competitor does with a team -- create, join, leave --
 * against an in-memory database. teamMembership.test.js covers joining in
 * depth against scripted reads; this covers creating and leaving, which had
 * no tests at all, and the join edges those scripted reads cannot reach.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "me" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("../../testing/fakeDatabase");
const { MAX_TEAM_SIZE, createTeam, joinTeam, leaveTeam } = require("./teamMembership");

beforeEach(() => {
  mockCurrentUser.value = { uid: "me" };
  db.reset({
    competitors: { me: { firstName: "Ada" } },
    teams: { "-abc": { name: "Lantern", members: { c1: true } } },
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("a team holds at most six", () => {
  expect(MAX_TEAM_SIZE).toBe(6);
});

describe("creating a team", () => {
  test("writes the team with this person as creator and only member, and points them at it", async () => {
    const result = await createTeam("  Beacon  ");
    expect(result).toEqual({ ok: true, teamId: expect.any(String) });
    expect(db.getData(`teams/${result.teamId}`)).toEqual({ name: "Beacon", createdBy: "me", members: { me: true } });
    expect(db.getData("competitors/me/teamId")).toBe(result.teamId);
    // both halves in one update
    expect(db.writes).toEqual([{ op: "update", path: "", value: expect.any(Object) }]);
  });

  test.each([undefined, "", "   "])("refuses a blank name (%p) without touching the database", async (name) => {
    await expect(createTeam(name)).resolves.toEqual({ ok: false, error: "Give the team a name." });
    expect(db.writes).toEqual([]);
  });

  test("refuses someone already on a team", async () => {
    db.setData("competitors/me/teamId", "-abc");
    await expect(createTeam("Beacon")).resolves.toEqual({
      ok: false,
      error: "You are already on a team. Leave it before creating another.",
    });
    expect(db.writes).toEqual([]);
  });

  test("an empty team id on the record does not count as being on a team", async () => {
    db.setData("competitors/me/teamId", "");
    await expect(createTeam("Beacon")).resolves.toMatchObject({ ok: true });
  });

  test("refuses when nobody is signed in, or the account has no uid", async () => {
    mockCurrentUser.value = null;
    await expect(createTeam("Beacon")).resolves.toEqual({ ok: false, error: "You must be signed in." });
    mockCurrentUser.value = {};
    await expect(createTeam("Beacon")).resolves.toEqual({ ok: false, error: "You must be signed in." });
    expect(db.writes).toEqual([]);
  });

  test("a failed write is reported in words, and logged", async () => {
    db.failWrites(1);
    await expect(createTeam("Beacon")).resolves.toEqual({ ok: false, error: "Could not create the team. Please try again." });
    expect(console.error).toHaveBeenCalledWith("Error creating team:", expect.any(Error));
  });
});

describe("leaving a team", () => {
  beforeEach(() => {
    db.setData("teams/-abc/members/me", true);
    db.setData("competitors/me/teamId", "-abc");
  });

  test("clears both halves of the membership together, and nobody else's", async () => {
    await expect(leaveTeam("-abc")).resolves.toEqual({ ok: true });
    expect(db.getData("teams/-abc/members")).toEqual({ c1: true });
    expect(db.getData("competitors/me/teamId")).toBeNull();
    expect(db.getData("competitors/me/firstName")).toBe("Ada");
    expect(db.writes).toHaveLength(1);
  });

  test("refuses when nobody is signed in", async () => {
    mockCurrentUser.value = null;
    await expect(leaveTeam("-abc")).resolves.toEqual({ ok: false, error: "You must be signed in." });
  });

  test("a failed write is reported in words, and logged", async () => {
    db.failWrites(1);
    await expect(leaveTeam("-abc")).resolves.toEqual({ ok: false, error: "Could not leave the team. Please try again." });
    expect(console.error).toHaveBeenCalledWith("Error leaving team:", expect.any(Error));
    expect(db.getData("competitors/me/teamId")).toBe("-abc");
  });
});

describe("joining, the edges", () => {
  test("joins, and says which team", async () => {
    await expect(joinTeam(" -abc ")).resolves.toEqual({ ok: true, teamId: "-abc", teamName: "Lantern" });
    expect(db.getData("teams/-abc/members")).toEqual({ c1: true, me: true });
    expect(db.getData("competitors/me/teamId")).toBe("-abc");
  });

  test("an empty id is refused in words", async () => {
    await expect(joinTeam("  ")).resolves.toEqual({ ok: false, error: "Enter a team ID." });
    await expect(joinTeam(undefined)).resolves.toEqual({ ok: false, error: "Enter a team ID." });
  });

  test("an empty team id on the record does not count as being on a team", async () => {
    db.setData("competitors/me/teamId", "");
    await expect(joinTeam("-abc")).resolves.toMatchObject({ ok: true });
  });

  test("an id typed with its dash that misses is not retried with a second dash", async () => {
    db.setData("teams/--xyz", { name: "Double" });
    await expect(joinTeam("-xyz")).resolves.toEqual({ ok: false, error: 'No team found with the ID "-xyz".' });
  });

  test("an id that ends in a dash is still retried with one in front", async () => {
    db.setData("teams/-xyz-", { name: "Trailing" });
    await expect(joinTeam("xyz-")).resolves.toMatchObject({ ok: true, teamId: "-xyz-" });
  });

  test("an id that matches as typed is not replaced by the dashed one", async () => {
    db.setData("teams/abc", { name: "Plain" });
    await expect(joinTeam("abc")).resolves.toMatchObject({ ok: true, teamId: "abc", teamName: "Plain" });
  });

  test("a submitted flag that is not exactly true does not close the team", async () => {
    db.setData("teams/-abc/submitted", "yes");
    await expect(joinTeam("-abc")).resolves.toMatchObject({ ok: true });
  });

  test("a submitted team is closed, and says how to get in anyway", async () => {
    db.setData("teams/-abc/submitted", true);
    await expect(joinTeam("-abc")).resolves.toEqual({
      ok: false,
      error: "Lantern has already submitted its project, so it is closed to new members. Ask an organizer if you need to be added.",
    });
  });

  test("a full team is refused and is not ok", async () => {
    db.setData("teams/-abc/members", { a: true, b: true, c: true, d: true, e: true, f: true });
    const result = await joinTeam("-abc");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Lantern already has 6 members/);
  });

  test("a read that is denied is treated as unknown, and the write decides", async () => {
    const realGet = db.module.get;
    jest.spyOn(db.module, "get").mockImplementation((ref) =>
      ref.path.endsWith("/submitted") || ref.path.endsWith("/members") ? Promise.reject(new Error("PERMISSION_DENIED")) : realGet(ref)
    );
    await expect(joinTeam("-abc")).resolves.toMatchObject({ ok: true });
  });

  test("refuses when nobody is signed in", async () => {
    mockCurrentUser.value = null;
    await expect(joinTeam("-abc")).resolves.toEqual({ ok: false, error: "You must be signed in." });
  });

  test("an unexpected failure is reported in words, and logged", async () => {
    jest.spyOn(db.module, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(joinTeam("-abc")).resolves.toEqual({ ok: false, error: "Could not join that team. Please try again." });
    expect(console.error).toHaveBeenCalledWith("Error joining team:", expect.any(Error));
  });
});

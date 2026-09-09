/**
 * Joining a team.
 *
 * This had no tests, which is how it shipped broken: `joinTeam` read `submitted`
 * and `members` before letting anyone in, and neither is readable by a
 * non-member — which is who is joining. Every attempt failed with "Could not
 * join that team. Please try again.", and retrying could never work.
 *
 * The reads are mocked per path here rather than wholesale, so a denial can be
 * expressed as what it really is: a rejection from one path while others
 * succeed.
 */
jest.mock("../../firebase", () => ({ database: {} }));

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "new-team" }),
}));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "me" } }) }));

const { joinTeam, MAX_TEAM_SIZE } = require("./teamMembership");
const { memberIds, isMember } = require("./teamMembers");

/** The world as the rules actually expose it to somebody who is not a member. */
function asNonMember({ name = "Lumen", denyWrite = false, competitor = { firstName: "Alex" } } = {}) {
  mockGet.mockImplementation(async ({ path }) => {
    if (path === "competitors/me/teamId") return snap(null);
    if (path === "competitors/me") return snap(competitor);
    if (path === `teams/t1/name`) return snap(name);
    // the two the rules refuse
    if (path === "teams/t1/submitted" || path === "teams/t1/members") {
      throw new Error("PERMISSION_DENIED: Client doesn't have permission");
    }
    return snap(null);
  });
  mockUpdate.mockImplementation(async () => {
    if (denyWrite) throw new Error("PERMISSION_DENIED: Client doesn't have permission");
  });
}

const snap = (value) => ({ exists: () => value !== null && value !== undefined, val: () => value });

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
});

test("a non-member can join, even though two of the three reads are denied", async () => {
  asNonMember();
  const result = await joinTeam("t1");

  expect(result.ok).toBe(true);
  expect(result.teamName).toBe("Lumen");
  expect(mockUpdate).toHaveBeenCalled();
});

test("both halves of the membership are written together", async () => {
  asNonMember();
  await joinTeam("t1");

  expect(mockUpdate.mock.calls.at(-1)[1]).toEqual({
    "teams/t1/members/me": true,
    "competitors/me/teamId": "t1",
  });
});

test("a refused write on a closed team becomes the sentence about closing", async () => {
  asNonMember({ denyWrite: true });
  const result = await joinTeam("t1");

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/already submitted its project/);
  expect(result.error).not.toMatch(/try again/i);
});

test("a refused write with no competitor record says that instead", async () => {
  asNonMember({ denyWrite: true, competitor: null });
  const result = await joinTeam("t1");

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Only competitors can join/);
});

test("an id nobody has is reported before anything is written", async () => {
  asNonMember({ name: null });
  const result = await joinTeam("t1");

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/No team found with the ID/);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("somebody already on a team is stopped first", async () => {
  mockGet.mockImplementation(async ({ path }) =>
    path === "competitors/me/teamId" ? snap("other") : snap(null)
  );
  const result = await joinTeam("t1");

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/already on a team/);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("an empty id is refused without a read", async () => {
  const result = await joinTeam("   ");
  expect(result.ok).toBe(false);
  expect(mockGet).not.toHaveBeenCalled();
});

/**
 * When the reader IS allowed — an organizer, or somebody rejoining a team they
 * can still see — the refusal is explained before the attempt rather than after.
 */
describe("when the reads happen to be permitted", () => {
  const asReader = (over) => {
    mockGet.mockImplementation(async ({ path }) => {
      if (path === "competitors/me/teamId") return snap(null);
      if (path === "teams/t1/name") return snap("Lumen");
      if (path === "teams/t1/submitted") return snap(over.submitted ?? null);
      if (path === "teams/t1/members") return snap(over.members ?? null);
      return snap(null);
    });
  };

  test("a submitted team is refused without attempting the write", async () => {
    asReader({ submitted: true });
    const result = await joinTeam("t1");

    expect(result.error).toMatch(/already submitted/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a full team is refused with the cap named", async () => {
    const members = Object.fromEntries(
      Array.from({ length: MAX_TEAM_SIZE }, (_, i) => [`u${i}`, true])
    );
    asReader({ members });
    const result = await joinTeam("t1");

    expect(result.error).toMatch(new RegExp(`${MAX_TEAM_SIZE} members`));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a team with room is joined", async () => {
    asReader({ members: { u0: true } });
    expect((await joinTeam("t1")).ok).toBe(true);
  });
});

/**
 * A team created before the array -> keyed-set migration stores `members` as
 * a real array: RTDB keys "0", "1" holding the uids as values. `joinTeam`'s
 * write -- `members/{uid}: true` -- lands on top of that array untouched
 * (nothing here may rewrite it: the rules grant a joiner write only at
 * `members/{their own uid}`, not at every other member's key, so `joinTeam`
 * cannot migrate the node itself). RTDB turns the whole node into a plain
 * object the moment a non-numeric key like a uid is added, so the result is
 * mixed: `{"0": "dave", "1": "carol", "erin": true}`.
 *
 * Before this fix, memberIds's object branch assumed every value was the
 * boolean flag of a keyed entry and returned the KEYS -- "0", "1", "erin" --
 * instead of the real uids. Pre-existing members then rendered as "Unknown
 * User" and isMember(members, "dave") came back false, on a team that is
 * currently live.
 */
describe("a legacy array survives being joined before it is migrated", () => {
  const mixed = { "0": "dave", "1": "carol", erin: true };

  test("memberIds reads the leftover array slots by their value, and the new entry by its key", () => {
    expect(memberIds(mixed)).toEqual(["dave", "carol", "erin"]);
  });

  test("a pre-existing member is still recognized as one", () => {
    expect(isMember(mixed, "dave")).toBe(true);
    expect(isMember(mixed, "carol")).toBe(true);
  });

  test("the newly-joined member is recognized too", () => {
    expect(isMember(mixed, "erin")).toBe(true);
  });

  test("pure shapes are unaffected -- schema.test.js pins this contract", () => {
    expect(memberIds({ a: true, b: true })).toEqual(["a", "b"]);
    expect(memberIds(["a", "b"])).toEqual(["a", "b"]);
    expect(memberIds({ a: true, b: null, c: false })).toEqual(["a"]);
  });
});

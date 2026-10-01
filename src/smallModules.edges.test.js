/**
 * Edge cases for the small shared helpers: merging a person's role records,
 * the admin check's wording, the activity feed's one-line change, the judge
 * picker's order, assignment lists, the staff link, past winners and the
 * restore-point diff.
 */
jest.mock("./firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("./testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "u1" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("./testing/fakeDatabase");
const { mergeRoleProfiles, personName, requireAdmin } = require("./roles");
const { describeChange } = require("./user/admin/activity/describeChange");
const { judgePickerOptions } = require("./user/judge/judgeRoles");
const { assignmentList, rosterOf } = require("./user/judge/assignmentList");
const { STAFF_PARAM, isStaffEntrance } = require("./registrationWindow");
const { diffSnapshot } = require("./user/admin/danger/snapshotDiff");

describe("merging a person's records", () => {
  test("a blank field never overwrites a filled one, whichever comes first", () => {
    expect(mergeRoleProfiles([{ firstName: "Ada", email: "" }, { firstName: "", email: "a@x.io" }])).toEqual({
      firstName: "Ada",
      email: "a@x.io",
    });
    expect(mergeRoleProfiles([{ firstName: "", email: null }, { firstName: "Ada" }])).toEqual({ firstName: "Ada", email: null });
  });

  test("a filled field replaces an earlier filled one", () => {
    expect(mergeRoleProfiles([{ company: "Old" }, { company: "New" }])).toEqual({ company: "New" });
  });

  test("a blank lands when nothing better exists, and a missing record is skipped", () => {
    expect(mergeRoleProfiles([null, { firstName: "" }, undefined])).toEqual({ firstName: "" });
    expect(mergeRoleProfiles([null, undefined])).toBeNull();
    expect(mergeRoleProfiles([{ checkedIn: false }, { checkedIn: undefined }])).toEqual({ checkedIn: false });
  });

  test("a name is trimmed, and falls back when blank", () => {
    expect(personName({ firstName: " Ada ", lastName: "" })).toBe("Ada");
    expect(personName({ firstName: "  " })).toBe("Unnamed");
    expect(personName(undefined, "Judge")).toBe("Judge");
  });
});

describe("the admin check", () => {
  beforeEach(() => {
    mockCurrentUser.value = { uid: "u1" };
    db.reset({ admins: { u1: true } });
  });

  test("an admin passes, and gets their account back", async () => {
    await expect(requireAdmin("do it")).resolves.toEqual({ uid: "u1" });
  });

  test("names the action it refused, with a default", async () => {
    db.setData("admins", { other: true });
    await expect(requireAdmin("clear the schedule")).rejects.toThrow("Only an admin can clear the schedule");
    await expect(requireAdmin()).rejects.toThrow("Only an admin can perform this action");
    mockCurrentUser.value = null;
    await expect(requireAdmin("clear the schedule")).rejects.toThrow("Must be signed in to clear the schedule");
    await expect(requireAdmin()).rejects.toThrow("Must be signed in to perform this action");
  });
});

describe("one line in the activity feed", () => {
  test.each([
    [{ path: "teams/t1/name", before: "Lantern", after: "Beacon" }, "name: Lantern → Beacon"],
    [{ path: "teams/t1/submitted", before: undefined, after: true }, "submitted: - → yes"],
    [{ path: "teams/t1/submitted", before: null, after: false }, "submitted: - → no"],
    [{ path: "judges/j1/skills", before: ["a"], after: [] }, "skills: 1 items → 0 items"],
    [{ path: "teams/t1/", before: { a: 1 }, after: { a: 1, b: 2 } }, "t1: 1 field → 2 fields"],
    [{ path: "", before: 0, after: 1 }, ": 0 → 1"],
  ])("%p", (change, line) => {
    expect(describeChange(change)).toBe(line);
  });

  test("text is cut at 28 characters, not at 28 exactly", () => {
    const exactly = "x".repeat(28);
    expect(describeChange({ path: "a", before: exactly, after: `${exactly}y` })).toBe(`a: ${exactly} → ${exactly}…`);
  });
});

describe("the judge picker", () => {
  test("checked-in judges first, then by name; only a literal true counts as checked in", () => {
    const options = judgePickerOptions({
      a: { firstName: "Zed", isRound1Judge: true, checkedIn: true },
      b: { firstName: "Abe", isRound1Judge: true, checkedIn: "yes" },
      c: { firstName: "Cal", isFinalRoundJudge: true },
      d: { firstName: "Ann", isRound1Judge: true, checkedIn: true },
      e: { firstName: "Out" },
    });
    expect(options).toEqual([
      { uid: "d", name: "Ann", checkedIn: true, finalOnly: false },
      { uid: "a", name: "Zed", checkedIn: true, finalOnly: false },
      { uid: "b", name: "Abe", checkedIn: false, finalOnly: false },
      { uid: "c", name: "Cal", checkedIn: false, finalOnly: true },
    ]);
  });
});

describe("assignment lists", () => {
  test("entries that are not records are dropped", () => {
    expect(assignmentList({ a: { id: "a", batch: 2 }, b: "junk", c: null, d: 3, e: { id: "e", batch: 1 } })).toEqual([
      { id: "e", batch: 1 },
      { id: "a", batch: 2 },
    ]);
  });

  test("a roster drops holes and entries naming nobody", () => {
    expect(rosterOf({ judges: [null, { judgeName: "Nobody" }, { judgeId: "j1" }] })).toEqual([{ judgeId: "j1" }]);
    expect(rosterOf({ judges: { a: { judgeId: "j2" }, b: null } })).toEqual([{ judgeId: "j2" }]);
    expect(rosterOf(undefined)).toEqual([]);
  });
});

describe("the staff link", () => {
  test("is ?staff, with or without a value, and nothing else", () => {
    expect(STAFF_PARAM).toBe("staff");
    expect(isStaffEntrance("?staff")).toBe(true);
    expect(isStaffEntrance("?a=1&staff=1")).toBe(true);
    expect(isStaffEntrance("?staffer")).toBe(false);
    expect(isStaffEntrance("")).toBe(false);
    expect(isStaffEntrance(undefined)).toBe(false);
  });
});

describe("past winners", () => {
  test("each with its prize, photo and a description of the photo", () => {
    jest.isolateModules(() => {
      const saved = process.env.PUBLIC_URL;
      process.env.PUBLIC_URL = "/idea-x";
      try {
        const { PAST_WINNERS, PAST_WINNERS_YEAR } = require("./winners");
        expect(PAST_WINNERS_YEAR).toBe(2025);
        expect(PAST_WINNERS).toEqual([
          { team: "Behind the Plate", prize: "$700", src: "/idea-x/photos/winner-behind-the-plate.jpg", width: 900, height: 863, alt: "Behind the Plate holding their $700 cheque at Ideathon 2025" },
          { team: "ClearCause", prize: "$450", src: "/idea-x/photos/winner-clearcause.jpg", width: 900, height: 656, alt: "ClearCause holding their $450 cheque at Ideathon 2025" },
          { team: "Tempo", prize: "$250", src: "/idea-x/photos/winner-tempo.jpg", width: 900, height: 993, alt: "Tempo holding their $250 cheque at Ideathon 2025" },
          { team: "Circles", prize: "$100", src: "/idea-x/photos/winner-circles.jpg", width: 900, height: 560, alt: "Circles holding their $100 cheque at Ideathon 2025" },
        ]);
      } finally {
        if (saved === undefined) delete process.env.PUBLIC_URL;
        else process.env.PUBLIC_URL = saved;
      }
    });
  });

  test("with no public URL the photos are served from the root", () => {
    jest.isolateModules(() => {
      const saved = process.env.PUBLIC_URL;
      delete process.env.PUBLIC_URL;
      try {
        expect(require("./winners").PAST_WINNERS[0].src).toBe("/photos/winner-behind-the-plate.jpg");
      } finally {
        if (saved !== undefined) process.env.PUBLIC_URL = saved;
      }
    });
  });
});

describe("the restore-point diff", () => {
  const entry = (path, value) => ({ path, value: JSON.stringify(value) });

  test("counts keys added back, changed and removed", () => {
    const { byPath } = diffSnapshot([entry("teams", { a: 1, b: 2, c: 3 })], { teams: { b: 2, c: 4, d: 5 } });
    expect(byPath).toEqual([{ path: "teams", added: 1, changed: 1, removed: 1 }]);
  });

  test("a value that is not an object counts as empty on either side", () => {
    expect(diffSnapshot([entry("config/x", "text")], { "config/x": { a: 1 } }).byPath).toEqual([
      { path: "config/x", added: 0, changed: 0, removed: 1 },
    ]);
    expect(diffSnapshot([{ path: "teams", value: "not json" }], { teams: "text" }).byPath).toEqual([
      { path: "teams", added: 0, changed: 0, removed: 0 },
    ]);
  });

  test("only scores and paths under it are compared card by card", () => {
    const { byPath } = diffSnapshot([entry("scoresheet", { a: 1 })], { scoresheet: { a: 2 } });
    expect(byPath).toEqual([{ path: "scoresheet", added: 0, changed: 1, removed: 0 }]);
    const cards = diffSnapshot([entry("scores/first", { t1: { j1: { problem: 1 } } })], { "scores/first": { t1: { j1: { problem: 2 } } } });
    expect(cards.byPath).toEqual([{ path: "scores/first", added: 0, changed: 1, removed: 0 }]);
  });
});

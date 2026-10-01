/**
 * Everything the People page does to a person, against an in-memory database
 * with the real audit-log writer and organizer service. Only the Firebase Auth
 * calls a browser makes (creating an account, sending a reset) are stubbed.
 *
 * peopleService.test.js covers the same functions against scripted reads;
 * this one reads back what actually landed and pins every message an organizer
 * sees.
 */
const mockAuth = { currentUser: { uid: "admin-1" } };
const mockEmulator = { on: false };
jest.mock("../../../firebase.js", () => ({
  database: {},
  auth: mockAuth,
  get USING_EMULATOR() {
    return mockEmulator.on;
  },
}));
jest.mock("../../../firebaseConfig.js", () => ({ firebaseConfig: { projectId: "demo" } }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/app", () => ({ initializeApp: jest.fn(), deleteApp: jest.fn() }));
jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(),
  connectAuthEmulator: jest.fn(),
}));

const db = require("../../../testing/fakeDatabase");
const firebaseApp = require("firebase/app");
const firebaseAuth = require("firebase/auth");
const people = require("./peopleService");
const { decodeChanges } = require("../adminAction");

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);

const ada = { firstName: "Ada", lastName: "Byron", email: "ada@x.io", teamId: "t1", resume: "https://r/ada.pdf" };
const grace = {
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@navy.mil",
  company: "Navy",
  isRound1Judge: true,
  teamAssignments: { t1: { id: "t1" } },
};

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(NOW));
  mockAuth.currentUser = { uid: "admin-1" };
  mockEmulator.on = false;
  delete process.env.REACT_APP_EMULATOR_HOST;
  db.reset({
    admins: { "admin-1": true, "admin-2": true },
    judges: { "admin-1": { firstName: "Org", lastName: "One" }, grace },
    competitors: { ada, bo: { firstName: "Bo", email: "bo@x.io", teamId: "t2" } },
    teams: {
      t1: {
        name: "Lantern",
        members: { ada: true },
        schedule: { judges: [{ judgeId: "grace", judgeName: "Grace Hopper" }, { judgeId: "zed" }] },
      },
      t2: { name: "Circles", members: { bo: true } },
    },
    scores: { first: { t1: { grace: { problem: 9 } } } },
    finalRound: { teams: { t1: { name: "Lantern", excludedJudges: { grace: true } } } },
  });
  firebaseApp.initializeApp.mockImplementation((_config, name) => ({ name }));
  firebaseApp.deleteApp.mockResolvedValue(undefined);
  // no argument is the main app, whose signed-in user the admin check reads
  firebaseAuth.getAuth.mockImplementation((app) => (app ? { app } : mockAuth));
  firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: "new-uid" } });
  firebaseAuth.signOut.mockResolvedValue(undefined);
  firebaseAuth.sendPasswordResetEmail.mockResolvedValue(undefined);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const logEntries = () => Object.values(db.getData("adminLog") ?? {});
const lastLog = () => {
  const entries = logEntries();
  const entry = entries[entries.length - 1];
  return { ...entry, changes: decodeChanges(entry.changes) };
};

describe("constants and blank records", () => {
  test("role nodes, labels and the swappable roles", () => {
    expect(people.ROLE_NODES).toEqual({ admin: "admins", judge: "judges", competitor: "competitors" });
    expect(people.ROLE_LABELS).toEqual({ admin: "Admin", judge: "Judge", competitor: "Competitor" });
    expect(people.PERSON_ROLES).toEqual(["judge", "competitor"]);
  });

  test("a blank judge has every field the app reads", () => {
    expect(people.blankJudge({ firstName: "A", lastName: "B", email: "a@b.c", company: "Co" })).toEqual({
      firstName: "A",
      lastName: "B",
      email: "a@b.c",
      company: "Co",
      withCompany: true,
      wantsToJudge: true,
      wantsToMentor: false,
      skills: [],
      timeslots: [],
      checkedIn: false,
      foodCheckIn: false,
      isRound1Judge: false,
      isFinalRoundJudge: false,
      registeredAt: NOW,
    });
    expect(people.blankJudge()).toMatchObject({ firstName: "", lastName: "", email: "", company: "", withCompany: false });
  });

  test("a blank competitor has every field the app reads", () => {
    expect(people.blankCompetitor({ firstName: "A", lastName: "B", email: "a@b.c" })).toEqual({
      firstName: "A",
      lastName: "B",
      email: "a@b.c",
      major: "",
      skills: "",
      learn: "",
      gender: "",
      schoolYear: "",
      uvaSchool: "",
      resume: "",
      dietaryRestriction: "none",
      checkedIn: false,
      foodCheckIn: false,
      registeredAt: NOW,
    });
    expect(people.blankCompetitor()).toMatchObject({ firstName: "", lastName: "", email: "" });
  });
});

describe("listing and searching", () => {
  test("one row per person, sorted by name, with every role they hold", async () => {
    db.setData("admins/nameless-admin-uid", true);
    db.setData("competitors/emailonly", { email: "e@x.io" });
    const list = await people.listPeople();
    expect(list.map(({ uid, name, email, roles }) => ({ uid, name, email, roles }))).toEqual([
      { uid: "nameless-admin-uid", name: "(no profile) nameless", email: "", roles: ["admin"] },
      { uid: "ada", name: "Ada Byron", email: "ada@x.io", roles: ["competitor"] },
      { uid: "bo", name: "Bo", email: "bo@x.io", roles: ["competitor"] },
      { uid: "emailonly", name: "e@x.io", email: "e@x.io", roles: ["competitor"] },
      { uid: "grace", name: "Grace Hopper", email: "grace@navy.mil", roles: ["judge"] },
      { uid: "admin-1", name: "Org One", email: "", roles: ["admin", "judge"] },
      { uid: "admin-2", name: "(no profile) admin-2", email: "", roles: ["admin"] },
    ].sort((a, b) => a.name.localeCompare(b.name)));
    expect(list.find((p) => p.uid === "grace").judge).toEqual(grace);
    expect(list.find((p) => p.uid === "ada").competitor).toEqual(ada);
    expect(list.find((p) => p.uid === "ada").judge).toBeNull();
  });

  test("a judge record's name and email are not overwritten by a competitor record's", async () => {
    db.setData("competitors/grace", { firstName: "Other", email: "other@x.io" });
    const grace2 = (await people.listPeople()).find((p) => p.uid === "grace");
    expect(grace2).toMatchObject({ name: "Grace Hopper", email: "grace@navy.mil", roles: ["judge", "competitor"] });
  });

  test("an organizer's missing name and email come from their newest useful archived record", async () => {
    db.setData("archive/people/admin-2", {
      "100-judge": { record: { firstName: "Old", email: "old@x.io" } },
      "300-competitor": { record: { firstName: "", lastName: "", email: "" } },
      "200-judge": { record: { firstName: "Rae", lastName: "Newer" } },
      "400-judge": {},
    });
    expect((await people.listPeople()).find((p) => p.uid === "admin-2")).toMatchObject({ name: "Rae Newer", email: "" });
  });

  test("an archived email fills in a live record that has a name but no email", async () => {
    db.setData("archive/people/admin-1", { "1-competitor": { record: { email: "org@x.io" } } });
    expect((await people.listPeople()).find((p) => p.uid === "admin-1")).toMatchObject({ name: "Org One", email: "org@x.io" });
  });

  test("the newest archived record is found by its key", () => {
    expect(people.latestArchivedRecord(undefined)).toBeNull();
    expect(people.latestArchivedRecord({ "1-a": { record: { lastName: "L" } }, "2-a": { record: {} } })).toEqual({ lastName: "L" });
    expect(people.latestArchivedRecord({ "1-a": { record: { email: "e" } }, "9-a": { record: { email: "f" } } })).toEqual({ email: "f" });
  });

  test("search matches name, email or uid, in any case, ignoring spaces around it", () => {
    const person = { name: "Grace Hopper", email: "Grace@Navy.mil", uid: "UID-42" };
    expect(people.matchesQuery(person, "  hopper ")).toBe(true);
    expect(people.matchesQuery(person, "NAVY")).toBe(true);
    expect(people.matchesQuery(person, "uid-4")).toBe(true);
    expect(people.matchesQuery(person, "ada")).toBe(false);
    expect(people.matchesQuery(person, "   ")).toBe(true);
    expect(people.matchesQuery(person, undefined)).toBe(true);
    expect(people.matchesQuery({ ...person, email: null }, "null")).toBe(true);
  });
});

describe("describing a switch", () => {
  test("a judge with assignments and both marks becoming a competitor", () => {
    const person = { roles: ["admin", "judge"], judge: { ...grace, isFinalRoundJudge: true, teamAssignments: { a: {}, b: {} } } };
    expect(people.describeSwitch({ person, role: "competitor" })).toEqual([
      "Deletes their judge record.",
      "Removes 2 judging assignments, and their name from those teams' cards.",
      "Clears their first-round judge mark.",
      "Clears their final-round judge mark.",
      "Scores they filed are kept, because they count toward averages.",
      "A copy of the record is archived, and can be put back.",
    ]);
  });

  test("one assignment, and a bare judge record", () => {
    expect(people.describeSwitch({ person: { roles: ["judge"], judge: { teamAssignments: { a: {} } } }, role: "none" })).toEqual([
      "Deletes their judge record.",
      "Removes 1 judging assignment, and their name from those teams' cards.",
      "Scores they filed are kept, because they count toward averages.",
      "A copy of the record is archived, and can be put back.",
    ]);
  });

  test("a competitor on a team with a resume becoming a judge", () => {
    expect(people.describeSwitch({ person: { roles: ["competitor"], competitor: ada }, role: "judge" })).toEqual([
      "Deletes their competitor record.",
      "Takes them off their team.",
      "Drops the resume on file.",
      "A copy of the record is archived, and can be put back.",
    ]);
  });

  test("nothing being left says nothing, and the role being kept is not described", () => {
    expect(people.describeSwitch({ person: { roles: ["admin"] }, role: "judge" })).toEqual([]);
    expect(people.describeSwitch({ person: { roles: ["judge"], judge: grace }, role: "judge" })).toEqual([]);
    expect(people.describeSwitch({ person: undefined, role: "judge" })).toEqual([]);
  });
});

describe("giving someone one role", () => {
  test("a competitor made a judge: archived, taken off the team, given a judge record with their identity", async () => {
    await expect(people.setSoleRole({ uid: "ada", name: "Ada Byron", role: "judge" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("competitors/ada")).toBeNull();
    expect(db.getData("teams/t1/members/ada")).toBeNull();
    expect(db.getData("judges/ada")).toEqual({
      ...people.blankJudge({ firstName: "Ada", lastName: "Byron", email: "ada@x.io" }),
      registeredAt: NOW,
    });
    expect(db.getData(`archive/people/ada/${NOW}-competitor`)).toEqual({
      role: "competitor",
      record: ada,
      archivedAt: NOW,
      archivedBy: "admin-1",
    });
    expect(lastLog()).toMatchObject({ action: "role.set", summary: "Made Ada Byron a judge" });
  });

  test("a judge made a competitor comes off every card and exclusion list, and keeps their scores", async () => {
    await people.setSoleRole({ uid: "grace", name: "", role: "competitor" });
    expect(db.getData("judges/grace")).toBeNull();
    expect(db.getData("teams/t1/schedule/judges")).toEqual([{ judgeId: "zed" }]);
    expect(db.getData("finalRound/teams/t1/excludedJudges")).toBeNull();
    expect(db.getData("scores/first/t1/grace")).toEqual({ problem: 9 });
    expect(db.getData("competitors/grace")).toMatchObject({ firstName: "Grace", lastName: "Hopper", email: "grace@navy.mil" });
    expect(lastLog().summary).toBe("Made grace a competitor");
  });

  test("scores go too when asked", async () => {
    await people.setSoleRole({ uid: "grace", name: "Grace", role: "none", includeScores: true });
    expect(db.getData("scores/first/t1/grace")).toBeNull();
    expect(lastLog().summary).toBe("Removed the role from Grace");
  });

  test("no role removes the one held, and writes no new record", async () => {
    await people.setSoleRole({ uid: "bo", name: "Bo", role: "none" });
    expect(db.getData("competitors/bo")).toBeNull();
    expect(db.getData("judges/bo")).toBeNull();
    expect(db.getData("teams/t2/members")).toBeNull();
  });

  test("an organizer with no record is given one, archiving nothing", async () => {
    await people.setSoleRole({ uid: "admin-2", name: "", role: "competitor" });
    expect(db.getData("competitors/admin-2")).toMatchObject({ firstName: "", email: "" });
    expect(db.getData("archive")).toBeNull();
    expect(db.getData("admins/admin-2")).toBe(true);
  });

  test.each([
    [{ uid: "", role: "judge" }, "Pick a person first."],
    [{ uid: "bo", role: "admin" }, 'Unknown role "admin".'],
    [{ uid: "bo", name: "Bo", role: "competitor" }, "Bo is already a competitor."],
    [{ uid: "grace", role: "judge" }, "grace is already a judge."],
    [{ uid: "admin-2", name: "Two", role: "none" }, "Two has no role to remove."],
    [{ uid: "admin-2", role: "none" }, "admin-2 has no role to remove."],
  ])("refuses %p", async (args, error) => {
    await expect(people.setSoleRole(args)).resolves.toEqual({ ok: false, error });
    expect(db.writes).toEqual([]);
  });

  test("someone holding both roles can be narrowed to one of them", async () => {
    db.setData("judges/bo", { firstName: "Bo" });
    await expect(people.setSoleRole({ uid: "bo", name: "Bo", role: "judge" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("judges/bo")).toEqual({ firstName: "Bo" });
    expect(db.getData("competitors/bo")).toBeNull();
  });
});

describe("the archive", () => {
  beforeEach(() => {
    db.setData("archive/people/ada", {
      "100-competitor": { role: "competitor", record: { firstName: "Old" } },
      "200-judge": { role: "judge", record: { firstName: "Ada", lastName: "Byron" } },
      "050-admin": { role: "admin", record: { firstName: "X" } },
      "010-judge": { role: "judge" },
    });
  });

  test("lists newest first", async () => {
    expect((await people.listArchived("ada")).map((e) => e.key)).toEqual(["200-judge", "100-competitor", "050-admin", "010-judge"]);
    expect((await people.listArchived("ada"))[0]).toEqual({ key: "200-judge", role: "judge", record: { firstName: "Ada", lastName: "Byron" } });
  });

  test("nothing archived, no uid, or a failed read is an empty list", async () => {
    await expect(people.listArchived("bo")).resolves.toEqual([]);
    await expect(people.listArchived("")).resolves.toEqual([]);
    jest.spyOn(db.module, "get").mockRejectedValueOnce(new Error("denied"));
    await expect(people.listArchived("ada")).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith("Could not read the archive:", expect.any(Error));
  });

  test("restores a record under its own role, and logs it by name", async () => {
    await expect(people.restoreArchived({ uid: "ada", key: "200-judge" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("judges/ada")).toEqual({ firstName: "Ada", lastName: "Byron" });
    expect(lastLog()).toMatchObject({ action: "archive.restore", summary: "Restored the judge record for Ada Byron" });
  });

  test("a nameless record is logged by uid", async () => {
    db.setData("archive/people/ada/300-judge", { role: "judge", record: { email: "a@b.c" } });
    await people.restoreArchived({ uid: "ada", key: "300-judge" });
    expect(lastLog().summary).toBe("Restored the judge record for ada");
  });

  test.each([
    [{ uid: "", key: "200-judge" }, "Pick an archived record to restore."],
    [{ uid: "ada", key: "" }, "Pick an archived record to restore."],
    [{ uid: "ada", key: "999-judge" }, "That archived record no longer exists."],
    [{ uid: "ada", key: "010-judge" }, "That archived record no longer exists."],
    [{ uid: "ada", key: "050-admin" }, 'Cannot restore a "admin" record.'],
    [
      { uid: "ada", key: "100-competitor" },
      "They already have a competitor record. Restoring would overwrite what is there now. change their role away from competitor first if you mean to replace it.",
    ],
  ])("refuses %p", async (args, error) => {
    await expect(people.restoreArchived(args)).resolves.toEqual({ ok: false, error });
    expect(db.getData("adminLog")).toBeNull();
  });
});

describe("organizer access", () => {
  test("is granted and revoked through the organizer service", async () => {
    await expect(people.setOrganizer({ uid: "bo", name: "Bo", enabled: true })).resolves.toMatchObject({ ok: true });
    expect(db.getData("admins/bo")).toBe(true);
    await expect(people.setOrganizer({ uid: "bo", name: "Bo", enabled: false })).resolves.toMatchObject({ ok: true });
    expect(db.getData("admins/bo")).toBeNull();
    expect(db.getData("competitors/bo")).toMatchObject({ firstName: "Bo" });
  });

  test("needs a person", async () => {
    await expect(people.setOrganizer({ uid: "", enabled: true })).resolves.toEqual({ ok: false, error: "Pick a person first." });
  });
});

describe("deleting a person", () => {
  const WARNING =
    "Their login still works. A browser cannot delete a Firebase Auth account, so they can sign in and will see an account with no role. Remove the account in the Firebase console if that matters.";

  test("removes every record and reference, keeps their scores, and warns the login survives", async () => {
    await expect(people.deletePerson({ uid: "grace", name: "Grace" })).resolves.toEqual({
      ok: true,
      entryId: expect.any(String),
      warning: WARNING,
    });
    expect(db.getData("judges/grace")).toBeNull();
    expect(db.getData("teams/t1/schedule/judges")).toEqual([{ judgeId: "zed" }]);
    expect(db.getData("scores/first/t1/grace")).toEqual({ problem: 9 });
    expect(lastLog()).toMatchObject({ action: "person.delete", summary: "Deleted every record for Grace" });
  });

  test("with scores when asked, and an organizer's flag too", async () => {
    await people.deletePerson({ uid: "admin-2", name: "" , includeScores: true });
    expect(db.getData("admins/admin-2")).toBeNull();
    expect(lastLog().summary).toBe("Deleted every record for admin-2");
    await people.deletePerson({ uid: "grace", includeScores: true });
    expect(db.getData("scores/first/t1/grace")).toBeNull();
  });

  test.each([
    [{ uid: "" }, "Pick a person first."],
    [{ uid: "admin-1" }, "You cannot delete your own records while signed in as them."],
    [{ uid: "nobody" }, "There is nothing recorded for that person."],
  ])("refuses %p", async (args, error) => {
    await expect(people.deletePerson(args)).resolves.toEqual({ ok: false, error });
  });

  test("refuses to remove the last organizer", async () => {
    db.setData("admins", { "admin-9": true });
    mockAuth.currentUser = { uid: "someone" };
    const result = await people.deletePerson({ uid: "admin-9" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^That is the last admin/) });
  });

  test("with nobody signed in, deleting an organizer is judged against no current user", async () => {
    mockAuth.currentUser = null;
    db.setData("admins", { "admin-9": true });
    await expect(people.deletePerson({ uid: "admin-9" })).resolves.toEqual({ ok: false, error: expect.stringMatching(/last admin/) });
  });
});

describe("creating an account", () => {
  const valid = { role: "judge", firstName: "Kat", lastName: "Johnson", email: " kat@nasa.gov ", password: "secret1", company: "NASA" };

  test("creates the login on a second app, signs it out, removes the app, and writes the record", async () => {
    const result = await people.createPerson(valid);
    expect(result).toEqual({ ok: true, entryId: expect.any(String), uid: "new-uid" });
    expect(firebaseApp.initializeApp).toHaveBeenCalledWith({ projectId: "demo" }, `admin-create-${NOW}`);
    expect(firebaseAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith({ app: { name: `admin-create-${NOW}` } }, "kat@nasa.gov", "secret1");
    expect(firebaseAuth.signOut).toHaveBeenCalledWith({ app: { name: `admin-create-${NOW}` } });
    expect(firebaseApp.deleteApp).toHaveBeenCalledWith({ name: `admin-create-${NOW}` });
    expect(firebaseAuth.connectAuthEmulator).not.toHaveBeenCalled();
    expect(db.getData("judges/new-uid")).toEqual({
      ...people.blankJudge({ firstName: "Kat", lastName: "Johnson", email: "kat@nasa.gov", company: "NASA" }),
      registeredAt: NOW,
    });
    expect(lastLog()).toMatchObject({ action: "person.create", summary: "Created judge Kat Johnson" });
  });

  test("a competitor gets a competitor record, and is named by email when nameless", async () => {
    await people.createPerson({ role: "competitor", email: "walkin@x.io", password: "secret1" });
    expect(db.getData("competitors/new-uid")).toMatchObject({ firstName: "", email: "walkin@x.io", dietaryRestriction: "none" });
    expect(lastLog().summary).toBe("Created competitor walkin@x.io");
  });

  test("against the emulator the second app is pointed at it too", async () => {
    mockEmulator.on = true;
    await people.createPerson(valid);
    expect(firebaseAuth.connectAuthEmulator).toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1:9099", { disableWarnings: true });
    process.env.REACT_APP_EMULATOR_HOST = "10.0.0.5";
    await people.createPerson(valid);
    expect(firebaseAuth.connectAuthEmulator).toHaveBeenLastCalledWith(expect.anything(), "http://10.0.0.5:9099", { disableWarnings: true });
  });

  test.each([
    [{ role: "admin" }, "Create a judge or a competitor; admin is a flag on top."],
    [{ role: "sponsor" }, "Create a judge or a competitor; admin is a flag on top."],
    [{ role: "judge", email: "no-at-sign" }, "Enter a valid email address."],
    [{ role: "judge", email: undefined }, "Enter a valid email address."],
    [{ role: "judge", email: "a@b.c", password: "12345" }, "The password must be at least 6 characters."],
    [{ role: "judge", email: "a@b.c" }, "The password must be at least 6 characters."],
  ])("refuses %p before creating anything", async (args, error) => {
    await expect(people.createPerson(args)).resolves.toEqual({ ok: false, error });
    expect(firebaseApp.initializeApp).not.toHaveBeenCalled();
  });

  test("an email already in use says to search for them instead, and still removes the app", async () => {
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValue({ code: "auth/email-already-in-use" });
    await expect(people.createPerson(valid)).resolves.toEqual({
      ok: false,
      error: "That email already has an account. Search for them instead and add the role.",
    });
    expect(firebaseApp.deleteApp).toHaveBeenCalled();
    expect(db.getData("judges/new-uid")).toBeNull();
  });

  test("any other failure passes its message on, or says it could not be created", async () => {
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValueOnce(new Error("weak password"));
    await expect(people.createPerson(valid)).resolves.toEqual({ ok: false, error: "weak password" });
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValueOnce({});
    await expect(people.createPerson(valid)).resolves.toEqual({ ok: false, error: "The account could not be created." });
    firebaseAuth.createUserWithEmailAndPassword.mockRejectedValueOnce(undefined);
    await expect(people.createPerson(valid)).resolves.toEqual({ ok: false, error: "The account could not be created." });
  });

  test("a second app that will not delete does not spoil the result", async () => {
    firebaseApp.deleteApp.mockRejectedValue(new Error("already deleted"));
    await expect(people.createPerson(valid)).resolves.toMatchObject({ ok: true, uid: "new-uid" });
  });

  test("an app that failed to start is not deleted", async () => {
    firebaseApp.initializeApp.mockImplementation(() => {
      throw new Error("bad config");
    });
    await expect(people.createPerson(valid)).resolves.toEqual({ ok: false, error: "bad config" });
    expect(firebaseApp.deleteApp).not.toHaveBeenCalled();
  });
});

describe("attaching a record to an existing login", () => {
  test("writes the record and logs it by name", async () => {
    await expect(people.attachRecord({ uid: "u9", role: "judge", firstName: "Lin", lastName: "Wu", email: "l@w.io", company: "Co" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("judges/u9")).toMatchObject({ firstName: "Lin", lastName: "Wu", company: "Co", withCompany: true });
    expect(lastLog()).toMatchObject({ action: "person.create", summary: "Added a judge record for Lin Wu" });
  });

  test("a competitor record, logged by uid when nameless", async () => {
    await people.attachRecord({ uid: "u9", role: "competitor", email: "l@w.io" });
    expect(db.getData("competitors/u9")).toMatchObject({ email: "l@w.io", dietaryRestriction: "none" });
    expect(lastLog().summary).toBe("Added a competitor record for u9");
  });

  test.each([
    [{ uid: "", role: "judge" }, "Enter the account's uid."],
    [{ uid: "u9", role: "admin" }, "Pick judge or competitor."],
    [{ uid: "u9", role: "sponsor" }, "Pick judge or competitor."],
    [{ uid: "grace", role: "judge" }, "That uid already has a judge record."],
  ])("refuses %p", async (args, error) => {
    await expect(people.attachRecord(args)).resolves.toEqual({ ok: false, error });
  });

  test("an existing record is left untouched", async () => {
    await people.attachRecord({ uid: "grace", role: "judge", firstName: "Imposter" });
    expect(db.getData("judges/grace")).toEqual(grace);
  });

  test("a failed transaction passes its message on, or a fallback", async () => {
    jest.spyOn(db.module, "runTransaction").mockRejectedValueOnce(new Error("offline"));
    await expect(people.attachRecord({ uid: "u9", role: "judge" })).resolves.toEqual({ ok: false, error: "offline" });
    jest.spyOn(db.module, "runTransaction").mockRejectedValueOnce(new Error(""));
    await expect(people.attachRecord({ uid: "u9", role: "judge" })).resolves.toEqual({ ok: false, error: "The record could not be saved." });
  });
});

describe("password resets", () => {
  test("sends to the trimmed address", async () => {
    await expect(people.sendReset("  ada@x.io ")).resolves.toEqual({ ok: true });
    expect(firebaseAuth.sendPasswordResetEmail).toHaveBeenCalledWith(mockAuth, "ada@x.io");
  });

  test("refuses without an address, and reports a failure", async () => {
    await expect(people.sendReset("")).resolves.toEqual({ ok: false, error: "That person has no email on file." });
    await expect(people.sendReset(undefined)).resolves.toEqual({ ok: false, error: "That person has no email on file." });
    firebaseAuth.sendPasswordResetEmail.mockRejectedValueOnce(new Error("too many requests"));
    await expect(people.sendReset("a@b.c")).resolves.toEqual({ ok: false, error: "too many requests" });
    firebaseAuth.sendPasswordResetEmail.mockRejectedValueOnce({});
    await expect(people.sendReset("a@b.c")).resolves.toEqual({ ok: false, error: "The reset email could not be sent." });
  });
});

describe("bulk edits", () => {
  test("sets the field on everyone who differs, in one logged change", async () => {
    db.setData("judges/admin-1/checkedIn", true);
    await expect(people.bulkSet({ uids: ["grace", "admin-1"], role: "judge", field: "checkedIn", value: true })).resolves.toMatchObject({ ok: true });
    expect(db.getData("judges/grace/checkedIn")).toBe(true);
    const log = lastLog();
    expect(log).toMatchObject({ action: "people.bulk", summary: "Set checkedIn to true for 1 judge(s)" });
    expect(log.changes).toEqual([{ path: "judges/grace/checkedIn", before: null, after: true }]);
  });

  test("every judge field and both competitor fields are allowed", async () => {
    for (const field of ["checkedIn", "foodCheckIn", "isRound1Judge", "isFinalRoundJudge"]) {
      await expect(people.bulkSet({ uids: ["grace"], role: "judge", field, value: "x" })).resolves.toMatchObject({ ok: true });
    }
    for (const field of ["checkedIn", "foodCheckIn"]) {
      await expect(people.bulkSet({ uids: ["bo"], role: "competitor", field, value: true })).resolves.toMatchObject({ ok: true });
    }
    expect(db.getData("competitors/bo")).toMatchObject({ checkedIn: true, foodCheckIn: true });
  });

  test.each([
    [{ uids: ["bo"], role: "competitor", field: "isRound1Judge", value: true }, "Cannot set isRound1Judge on a competitor."],
    [{ uids: ["bo"], role: "admin", field: "checkedIn", value: true }, "Cannot set checkedIn on a admin."],
    [{ uids: [], role: "judge", field: "checkedIn", value: true }, "Nobody is selected."],
    [{ uids: undefined, role: "judge", field: "checkedIn", value: true }, "Nobody is selected."],
    [{ uids: ["grace"], role: "judge", field: "isRound1Judge", value: true }, "They are all already set that way."],
  ])("refuses %p", async (args, error) => {
    await expect(people.bulkSet(args)).resolves.toEqual({ ok: false, error });
  });
});

describe("teams", () => {
  test("creates an empty team owned by the organizer", async () => {
    await expect(people.createTeam("  Walk-ins ")).resolves.toMatchObject({ ok: true });
    const [team] = Object.values(db.getData("teams")).filter((t) => t.name === "Walk-ins");
    expect(team).toEqual({ name: "Walk-ins", createdBy: "admin-1", submitted: false });
    expect(lastLog()).toMatchObject({ action: "team.create", summary: "Created the team Walk-ins" });
  });

  test("a blank name is refused", async () => {
    await expect(people.createTeam("  ")).resolves.toEqual({ ok: false, error: "Give the team a name." });
    await expect(people.createTeam(undefined)).resolves.toEqual({ ok: false, error: "Give the team a name." });
  });

  test("deleting one detaches its members, every judge copy and its standing", async () => {
    db.setData("judges/grace/finalAssignments", { t1: { teamId: "t1" }, t2: { teamId: "t2" } });
    db.setData("judges/other", { teamAssignments: { t2: { id: "t2" } } });
    await expect(people.deleteTeam({ teamId: "t1", teamName: "Lantern" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1")).toBeNull();
    expect(db.getData("competitors/ada/teamId")).toBeNull();
    expect(db.getData("competitors/bo")).toEqual({ firstName: "Bo", email: "bo@x.io", teamId: "t2" });
    expect(db.getData("judges/grace/teamAssignments")).toBeNull();
    expect(db.getData("judges/grace/finalAssignments")).toEqual({ t2: { teamId: "t2" } });
    expect(db.getData("judges/other/teamAssignments")).toEqual({ t2: { id: "t2" } });
    expect(db.getData("finalRound/teams/t1")).toBeNull();
    expect(lastLog()).toMatchObject({ action: "team.delete", summary: "Deleted the team Lantern" });
  });

  test("a team not in the final round, and no standings at all, are fine", async () => {
    db.setData("finalRound", null);
    await people.deleteTeam({ teamId: "t2" });
    expect(lastLog().summary).toBe("Deleted the team t2");
    expect(lastLog().changes.map((c) => c.path)).toEqual(["teams/t2", "competitors/bo/teamId"]);
  });

  test("a team that is already gone is refused", async () => {
    await expect(people.deleteTeam({ teamId: "gone" })).resolves.toEqual({ ok: false, error: "That team no longer exists." });
  });
});

describe("config values", () => {
  test("writes the key, logging what it replaced", async () => {
    db.setData("config/finalRoundSize", 4);
    await expect(people.setConfigValue(" finalRoundSize ", 6)).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/finalRoundSize")).toBe(6);
    expect(lastLog()).toMatchObject({ action: "config.set", summary: "Set config/finalRoundSize" });
    expect(lastLog().changes).toEqual([{ path: "config/finalRoundSize", before: 4, after: 6 }]);
  });

  test("a new key replaces nothing", async () => {
    await people.setConfigValue("newKey", "v");
    expect(lastLog().changes).toEqual([{ path: "config/newKey", before: null, after: "v" }]);
  });

  test.each(["", "  ", "a/b", undefined])("refuses the key %p", async (key) => {
    await expect(people.setConfigValue(key, 1)).resolves.toEqual({ ok: false, error: "Give a single config key, with no slashes." });
  });
});

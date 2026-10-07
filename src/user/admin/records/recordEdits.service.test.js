/**
 * Record edits end to end, through the real audit-log writer over an in-memory
 * database: what each edit writes, what the log says, and what is refused.
 *
 * recordEdits.test.js covers the pure change builders; this covers the reads
 * each edit makes first and the write that follows.
 */
jest.mock("../../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../../testing/fakeDatabase");
const {
  COMPETITOR_FIELDS,
  JUDGE_FIELDS,
  editCompetitor,
  editJudge,
  renameTeam,
  moveCompetitorToTeam,
  moveMemberChanges,
  renameTeamChanges,
} = require("./recordEdits");
const { decodeChanges } = require("../adminAction");

const UID = "competitor-uid-123456";
const JUDGE = "judge-uid-abcdefgh";

beforeEach(() => {
  db.reset({
    admins: { "admin-1": true },
    competitors: { [UID]: { firstName: "Ada", lastName: "Byron", teamId: "t1", checkedIn: false } },
    judges: {
      [JUDGE]: {
        firstName: "Grace",
        company: "Navy",
        teamAssignments: { t1: { id: "t1", teamName: "Lantern" } },
        finalAssignments: { t1: { teamId: "t1", teamName: "Lantern" } },
      },
      other: { firstName: "Other", teamAssignments: { t2: { id: "t2", teamName: "Circles" } } },
    },
    teams: {
      t1: { name: "Lantern", members: { [UID]: true, c2: true }, schedule: { teamName: "Lantern", room: "R" } },
      t2: { name: "Circles", members: { c3: true } },
      t3: { name: "Solo", members: { c9: true } },
    },
    finalRound: { teams: { t1: { name: "Lantern", averageScore: 30 } } },
  });
});

const onlyLog = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  expect(entries).toHaveLength(1);
  return { ...entries[0], changes: decodeChanges(entries[0].changes) };
};

describe("the allow-lists", () => {
  test("say exactly which fields each record may have edited", () => {
    expect(COMPETITOR_FIELDS).toEqual(["firstName", "lastName", "email", "dietaryRestriction", "checkedIn", "foodCheckIn"]);
    expect(JUDGE_FIELDS).toEqual([
      "firstName", "lastName", "email", "company", "withCompany", "wantsToMentor",
      "checkedIn", "foodCheckIn", "isRound1Judge", "isFinalRoundJudge",
    ]);
  });
});

describe("editing a competitor", () => {
  test("writes only the fields that changed, and logs each by name", async () => {
    const result = await editCompetitor(UID, { firstName: "Ada", lastName: "Lovelace", checkedIn: true, teamId: "t9" });
    expect(result).toMatchObject({ ok: true });
    expect(db.getData(`competitors/${UID}`)).toEqual({ firstName: "Ada", lastName: "Lovelace", teamId: "t1", checkedIn: true });

    const log = onlyLog();
    expect(log.action).toBe("competitor.edit");
    expect(log.summary).toBe("Edited competitor competit: lastName, checkedIn");
    expect(log.changes).toEqual([
      { path: `competitors/${UID}/lastName`, before: "Byron", after: "Lovelace" },
      { path: `competitors/${UID}/checkedIn`, before: false, after: true },
    ]);
  });

  test("a field that was never set counts as changed when given a value", async () => {
    await editCompetitor(UID, { email: "ada@x.io" });
    expect(onlyLog().changes).toEqual([{ path: `competitors/${UID}/email`, before: null, after: "ada@x.io" }]);
  });

  test("nothing allowed, or nothing different, is refused without a write", async () => {
    await expect(editCompetitor(UID, { teamId: "t9", uvaSchool: "law" })).resolves.toEqual({
      ok: false,
      error: "Nothing to change.",
    });
    await expect(editCompetitor(UID, undefined)).resolves.toEqual({ ok: false, error: "Nothing to change." });
    await expect(editCompetitor(UID, { firstName: "Ada", checkedIn: false })).resolves.toEqual({
      ok: false,
      error: "Nothing changed.",
    });
    expect(db.writes).toEqual([]);
  });
});

describe("editing a judge", () => {
  test("uses the judge allow-list and logs as a judge edit", async () => {
    await editJudge(JUDGE, { company: "Harvard", isFinalRoundJudge: true, teamAssignments: {} });
    expect(db.getData(`judges/${JUDGE}/company`)).toBe("Harvard");
    expect(db.getData(`judges/${JUDGE}/isFinalRoundJudge`)).toBe(true);
    expect(db.getData(`judges/${JUDGE}/teamAssignments`)).toEqual({ t1: { id: "t1", teamName: "Lantern" } });

    const log = onlyLog();
    expect(log.action).toBe("judge.edit");
    expect(log.summary).toBe("Edited judge judge-ui: company, isFinalRoundJudge");
  });

  test("a competitor-only field is not editable on a judge", async () => {
    await expect(editJudge(JUDGE, { dietaryRestriction: "none", uvaSchool: "law" })).resolves.toEqual({
      ok: false,
      error: "Nothing to change.",
    });
  });
});

describe("renaming a team", () => {
  test("rewrites every copy of the name in one logged change", async () => {
    await expect(renameTeam("t1", "  Beacon  ")).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1/name")).toBe("Beacon");
    expect(db.getData("teams/t1/schedule/teamName")).toBe("Beacon");
    expect(db.getData(`judges/${JUDGE}/teamAssignments/t1/teamName`)).toBe("Beacon");
    expect(db.getData(`judges/${JUDGE}/finalAssignments/t1/teamName`)).toBe("Beacon");
    expect(db.getData("finalRound/teams/t1/name")).toBe("Beacon");
    expect(db.getData("judges/other/teamAssignments/t2/teamName")).toBe("Circles");

    const log = onlyLog();
    expect(log.action).toBe("team.rename");
    expect(log.summary).toBe("Renamed Lantern to Beacon (4 denormalised copies)");
  });

  test("a team with no copies says nothing about them", async () => {
    await renameTeam("t3", "Duo");
    expect(onlyLog().summary).toBe("Renamed Solo to Duo");
  });

  test("a team that never had a name is called unnamed in the log", async () => {
    db.setData("teams/t3/name", null);
    await renameTeam("t3", "Named");
    expect(onlyLog().summary).toBe("Renamed an unnamed team to Named");
    expect(onlyLog().changes).toEqual([{ path: "teams/t3/name", before: null, after: "Named" }]);
  });

  test("works with no judges and no final round at all", async () => {
    db.setData("judges", null);
    db.setData("finalRound", null);
    await renameTeam("t1", "Beacon");
    expect(onlyLog().summary).toBe("Renamed Lantern to Beacon (1 denormalised copies)");
  });

  test("refuses a blank name, a missing team, or the name it already has", async () => {
    await expect(renameTeam("t1", "   ")).resolves.toEqual({ ok: false, error: "Give the team a name." });
    await expect(renameTeam("t1", undefined)).resolves.toEqual({ ok: false, error: "Give the team a name." });
    await expect(renameTeam("gone", "X")).resolves.toEqual({ ok: false, error: "That team no longer exists." });
    await expect(renameTeam("t1", " Lantern ")).resolves.toEqual({ ok: false, error: "That is already the name." });
    expect(db.writes).toEqual([]);
  });
});

describe("the rename change builder", () => {
  test("tolerates a missing team record and judge records with nothing assigned", () => {
    expect(
      renameTeamChanges({ teamId: "t1", from: "A", to: "B", teamData: undefined, judgesData: { j: {}, k: null }, finalRoundTeams: undefined })
    ).toEqual([{ path: "teams/t1/name", before: "A", after: "B" }]);
  });

  test("a judge assigned another team in either round is not touched", () => {
    const judgesData = { j: { teamAssignments: { t2: {} }, finalAssignments: { t2: {} } } };
    expect(renameTeamChanges({ teamId: "t1", from: "A", to: "B", teamData: {}, judgesData })).toHaveLength(1);
  });
});

describe("the move change builder", () => {
  test("a uid missing from a legacy roster writes no removal", () => {
    expect(moveMemberChanges({ uid: "u", fromTeamId: "t1", toTeamId: "t2", fromMembers: ["someone-else"] })).toEqual([
      { path: "teams/t2/members/u", before: null, after: true },
      { path: "competitors/u/teamId", before: "t1", after: "t2" },
    ]);
  });

  test("without the roster read, the keyed shape is assumed", () => {
    expect(moveMemberChanges({ uid: "u", fromTeamId: "t1" })).toEqual([
      { path: "teams/t1/members/u", before: true, after: null },
      { path: "competitors/u/teamId", before: "t1", after: null },
    ]);
  });

  test("no team either side still repoints the record, to null", () => {
    expect(moveMemberChanges({ uid: "u" })).toEqual([{ path: "competitors/u/teamId", before: null, after: null }]);
  });
});

describe("moving a competitor", () => {
  test("moves them in one logged change, naming both teams", async () => {
    const result = await moveCompetitorToTeam({ uid: UID, name: "Ada Byron", toTeamId: "t2" });
    expect(result).toEqual({ ok: true, entryId: expect.any(String), emptiedTeam: null });
    expect(db.getData("teams/t1/members")).toEqual({ c2: true });
    expect(db.getData("teams/t2/members")).toEqual({ c3: true, [UID]: true });
    expect(db.getData(`competitors/${UID}/teamId`)).toBe("t2");

    const log = onlyLog();
    expect(log.action).toBe("competitor.move");
    expect(log.summary).toBe("Moved Ada Byron from t1 to t2");
  });

  test("says when the move leaves the old team empty, but still makes it", async () => {
    db.setData("teams/t1/members", { [UID]: true });
    const result = await moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: "t2" });
    expect(result).toMatchObject({ ok: true, emptiedTeam: "t1" });
    // the real database drops the emptied node; the fake keeps an empty object
    expect(db.getData("teams/t1/members") ?? {}).toEqual({});
  });

  test("a team with no roster at all counts as emptied", async () => {
    db.setData("teams/t1/members", null);
    await expect(moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: "t2" })).resolves.toMatchObject({
      emptiedTeam: "t1",
    });
  });

  test("clears the real slot on a legacy array roster", async () => {
    db.setData("teams/t1/members", ["c2", UID]);
    await moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: "t2" });
    expect(onlyLog().changes[0]).toEqual({ path: "teams/t1/members/1", before: UID, after: null });
    expect(db.getData("teams/t1/members")[0]).toBe("c2");
  });

  test("someone with no team joins one, named by uid when there is no name", async () => {
    db.setData(`competitors/${UID}/teamId`, null);
    const result = await moveCompetitorToTeam({ uid: UID, name: "", toTeamId: "t3" });
    expect(result).toMatchObject({ ok: true, emptiedTeam: null });
    expect(onlyLog().summary).toBe("Moved competit to t3");
    expect(db.getData("teams/t3/members")).toEqual({ c9: true, [UID]: true });
  });

  test("removing someone from their team leaves them on no team", async () => {
    await moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: undefined });
    expect(onlyLog().summary).toBe("Moved Ada from t1 to no team");
    expect(db.getData(`competitors/${UID}/teamId`)).toBeNull();
    expect(db.getData("teams/t1/members")).toEqual({ c2: true });
  });

  test("refuses a move to the team they are already on, or from none to none", async () => {
    await expect(moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: "t1" })).resolves.toEqual({
      ok: false,
      error: "They are already on that team.",
    });
    db.setData(`competitors/${UID}/teamId`, null);
    await expect(moveCompetitorToTeam({ uid: UID, name: "Ada", toTeamId: undefined })).resolves.toEqual({
      ok: false,
      error: "They are already on that team.",
    });
    expect(db.writes).toEqual([]);
  });
});

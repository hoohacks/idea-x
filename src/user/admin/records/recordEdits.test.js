/**
 * Editing a record.
 *
 * Most fields are a one-path write. A team name is not: it is copied into
 * teams/{id}/schedule.teamName and into every assigned judge's own
 * teamAssignments, because a judge cannot read the teams node. Renaming
 * without the fan-out leaves judges calling a team by a name nobody else uses.
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

const {
  renameTeamChanges,
  moveMemberChanges,
  editCompetitor,
  COMPETITOR_FIELDS,
} = require("./recordEdits");
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

describe("renaming a team reaches every copy of the name", () => {
  const teamData = {
    name: "Alpha",
    schedule: { id: "t1", teamName: "Alpha", room: "Rice 110", time: "5:00 PM", batch: 1 },
  };
  const judgesData = {
    j1: { teamAssignments: { t1: { teamName: "Alpha" }, t2: { teamName: "Beta" } } },
    j2: { teamAssignments: { t1: { teamName: "Alpha" } } },
    j3: { teamAssignments: { t2: { teamName: "Beta" } } },
  };

  test("writes the team node, the schedule copy and every judge copy", () => {
    const changes = renameTeamChanges({ teamId: "t1", from: "Alpha", to: "Omega", teamData, judgesData });
    const paths = changes.map((c) => c.path);

    expect(paths).toContain("teams/t1/name");
    expect(paths).toContain("teams/t1/schedule/teamName");
    expect(paths).toContain("judges/j1/teamAssignments/t1/teamName");
    expect(paths).toContain("judges/j2/teamAssignments/t1/teamName");
  });

  test("leaves other teams alone", () => {
    const changes = renameTeamChanges({ teamId: "t1", from: "Alpha", to: "Omega", teamData, judgesData });
    expect(changes.map((c) => c.path)).not.toContain("judges/j3/teamAssignments/t2/teamName");
  });

  test("every change carries the old name, so the undo restores it", () => {
    const changes = renameTeamChanges({ teamId: "t1", from: "Alpha", to: "Omega", teamData, judgesData });
    expect(changes.every((c) => c.before === "Alpha" && c.after === "Omega")).toBe(true);
  });

  test("an unscheduled team writes only the team node", () => {
    const changes = renameTeamChanges({
      teamId: "t1", from: "Alpha", to: "Omega", teamData: { name: "Alpha" }, judgesData: {},
    });
    expect(changes.map((c) => c.path)).toEqual(["teams/t1/name"]);
  });

  /**
   * The final round caches the name twice more, on nodes the first round does
   * not touch. Both were missed: a team renamed during the event kept its old
   * name on every finalist judge card, and -- worse -- in the standings, which
   * is the name the results page announces.
   */
  describe("including the copies the final round makes", () => {
    const inFinal = {
      j1: {
        teamAssignments: { t1: { teamName: "Alpha" } },
        finalAssignments: { t1: { teamName: "Alpha" }, t2: { teamName: "Beta" } },
      },
      j2: { finalAssignments: { t2: { teamName: "Beta" } } },
    };
    const finalRoundTeams = { t1: { name: "Alpha" }, t2: { name: "Beta" } };

    const rename = (over = {}) =>
      renameTeamChanges({
        teamId: "t1", from: "Alpha", to: "Omega", teamData,
        judgesData: inFinal, finalRoundTeams, ...over,
      }).map((c) => c.path);

    test("the finalist judge card", () => {
      expect(rename()).toContain("judges/j1/finalAssignments/t1/teamName");
    });

    test("the standings, which is what gets announced", () => {
      expect(rename()).toContain("finalRound/teams/t1/name");
    });

    test("and no other team in the round", () => {
      const paths = rename();
      expect(paths).not.toContain("judges/j1/finalAssignments/t2/teamName");
      expect(paths).not.toContain("finalRound/teams/t2/name");
    });

    test("nothing final-round is written when there is no final round", () => {
      const paths = rename({ finalRoundTeams: {}, judgesData: { j1: { teamAssignments: { t1: {} } } } });
      expect(paths.some((path) => path.includes("final"))).toBe(false);
    });

    test("the archive is left alone -- it records what the standings were", () => {
      expect(rename().some((path) => path.includes("archive"))).toBe(false);
    });
  });
});

describe("moving a competitor between teams", () => {
  /**
   * Membership is a keyed set, not an array -- the rules match on the child KEY.
   * Three paths have to move together or the person is on both teams, or
   * neither.
   */
  test("clears the old membership, sets the new one, and repoints the record", () => {
    const changes = moveMemberChanges({ uid: "u1", fromTeamId: "t1", toTeamId: "t2" });
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c.after]));

    expect(byPath["teams/t1/members/u1"]).toBeNull();
    expect(byPath["teams/t2/members/u1"]).toBe(true);
    expect(byPath["competitors/u1/teamId"]).toBe("t2");
  });

  test("joining from no team does not write a removal", () => {
    const paths = moveMemberChanges({ uid: "u1", fromTeamId: null, toTeamId: "t2" }).map((c) => c.path);
    expect(paths).not.toContain("teams/null/members/u1");
    expect(paths).toContain("teams/t2/members/u1");
  });

  test("leaving to no team clears the record rather than writing an empty id", () => {
    const byPath = Object.fromEntries(
      moveMemberChanges({ uid: "u1", fromTeamId: "t1", toTeamId: null }).map((c) => [c.path, c.after])
    );
    expect(byPath["competitors/u1/teamId"]).toBeNull();
    expect(byPath["teams/t1/members/u1"]).toBeNull();
  });

  /**
   * A team created before scripts/migrate-team-members.mjs ran still holds
   * `members` as a real array -- the uid is the VALUE and the key is a
   * meaningless index. Writing `members/{uid}: null` unconditionally deletes
   * nothing on that shape, because the uid was never a key -- the competitor
   * ends up listed on BOTH the old team and the new one.
   */
  test("clears the actual array slot on a legacy team, not a key that was never there", () => {
    const changes = moveMemberChanges({
      uid: "dave", fromTeamId: "t1", toTeamId: "t2",
      fromMembers: ["dave", "carol"],
    });
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c.after]));

    expect(byPath["teams/t1/members/0"]).toBeNull();
    expect(byPath["teams/t1/members/dave"]).toBeUndefined();
    expect(byPath["teams/t2/members/dave"]).toBe(true);
  });

  test("clears the right slot on a mixed roster (legacy array slots plus a keyed entry)", () => {
    const changes = moveMemberChanges({
      uid: "erin", fromTeamId: "t1", toTeamId: "t2",
      fromMembers: { 0: "dave", 1: "carol", erin: true },
    });
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c.after]));

    expect(byPath["teams/t1/members/erin"]).toBeNull();
    expect(byPath["teams/t2/members/erin"]).toBe(true);
  });
});

describe("editing plain fields", () => {
  test("only allow-listed fields are written", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => "old" });

    await editCompetitor("u1", { firstName: "Jane", checkedIn: true, isAdmin: true });
    const payload = mockUpdate.mock.calls[0][1];

    expect(payload["competitors/u1/firstName"]).toBe("Jane");
    expect(payload["competitors/u1/isAdmin"]).toBeUndefined();
  });

  test("check-in is editable here, because reversing one is a deliberate override", () => {
    expect(COMPETITOR_FIELDS).toContain("checkedIn");
  });

  test("an edit that changes nothing is refused rather than logged as noise", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => "Jane" });
    const result = await editCompetitor("u1", { firstName: "Jane" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

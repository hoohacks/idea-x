/**
 * Roles, and removing people.
 *
 * The fan-out is the part worth pinning. A judge's name is copied onto every
 * team's schedule card, because a judge cannot read /teams -- so deleting the
 * judge record alone leaves their name on a card nobody can explain, and leaves
 * them in the final round's excludedJudges, where they permanently block a
 * finalist from being judged by anyone.
 */
jest.mock("../../../firebase", () => ({ database: {}, auth: { currentUser: { uid: "admin-1" } }, USING_EMULATOR: false }));

const mockUpdate = jest.fn();
const mockGet = jest.fn();
const mockRunTransaction = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  push: () => ({ key: "new-id" }),
  runTransaction: (...args) => mockRunTransaction(...args),
  serverTimestamp: () => 1700000000000,
}));
jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "admin-1" } }),
  createUserWithEmailAndPassword: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(),
  connectAuthEmulator: jest.fn(),
}));
jest.mock("firebase/app", () => ({ initializeApp: jest.fn(), deleteApp: jest.fn() }));
jest.mock("../../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));

const {
  removalChanges, listPeople, matchesQuery, blankJudge, blankCompetitor,
  setSoleRole, setOrganizer, describeSwitch, deletePerson, bulkSet, deleteTeam,
  listArchived, restoreArchived, attachRecord,
} = require("./peopleService");
const { requireAdmin } = require("../../../roles.js");

const WORLD = {
  admins: { "admin-1": true, "admin-2": true },
  judges: {
    j1: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", isRound1Judge: true, checkedIn: false },
    j2: { firstName: "Alan", lastName: "Turing", email: "alan@example.com", isRound1Judge: true, checkedIn: false },
  },
  competitors: {
    c1: { firstName: "Grace", lastName: "Hopper", email: "grace@example.com", teamId: "t1" },
  },
  teams: {
    t1: {
      name: "Lumen",
      members: { c1: true },
      schedule: { room: "Rice 110", judges: [{ judgeId: "j1", judgeName: "Ada Lovelace" }, { judgeId: "j2", judgeName: "Alan Turing" }] },
    },
  },
  scores: { first: { t1: { j1: { problem: 8 } } } },
  "finalRound/teams": { t1: { name: "Lumen", excludedJudges: { j1: true } } },
};

const world = (overrides = {}) => async (r) => {
  const table = { ...WORLD, ...overrides };
  const value = table[r.path];
  return { exists: () => value !== undefined, val: () => value ?? null };
};

const payload = () => mockUpdate.mock.calls.at(-1)[1];

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockImplementation(world());
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });

  // Single-writer default: read the current value through the same mockGet
  // fixture everything else in this file uses, run the callback, and commit.
  // The race test below replaces this with a gated version of its own.
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation(async (reference, callback) => {
    const snap = await mockGet(reference);
    const current = snap.exists() ? snap.val() : null;
    const next = callback(current);
    if (next === undefined) {
      return { committed: false, snapshot: { val: () => current, exists: () => current !== null } };
    }
    await mockUpdate(reference, { [reference.path]: next });
    return { committed: true, snapshot: { val: () => next, exists: () => true } };
  });
});

describe("removalChanges reaches every copy of a person", () => {
  const args = {
    judgesData: WORLD.judges,
    teamsData: WORLD.teams,
    competitorsData: WORLD.competitors,
    scoresData: WORLD.scores,
    finalRoundTeams: WORLD["finalRound/teams"],
  };

  test("a judge comes off the team's schedule card, not just their own record", () => {
    const paths = removalChanges({ uid: "j1", ...args }).map((c) => c.path);
    expect(paths).toContain("judges/j1");
    expect(paths).toContain("teams/t1/schedule/judges");
  });

  test("the remaining judges stay on the card", () => {
    const change = removalChanges({ uid: "j1", ...args })
      .find((c) => c.path === "teams/t1/schedule/judges");
    expect(change.after).toEqual([{ judgeId: "j2", judgeName: "Alan Turing" }]);
  });

  test("a deleted judge is dropped from excludedJudges", () => {
    // otherwise they permanently block a finalist from being judged
    const paths = removalChanges({ uid: "j1", ...args }).map((c) => c.path);
    expect(paths).toContain("finalRound/teams/t1/excludedJudges/j1");
  });

  test("a competitor leaves their team's roster", () => {
    const paths = removalChanges({ uid: "c1", ...args }).map((c) => c.path);
    expect(paths).toContain("competitors/c1");
    expect(paths).toContain("teams/t1/members/c1");
  });

  test("scores are kept unless asked for, because they count toward averages", () => {
    const without = removalChanges({ uid: "j1", ...args }).map((c) => c.path);
    const with_ = removalChanges({ uid: "j1", ...args, includeScores: true }).map((c) => c.path);
    expect(without).not.toContain("scores/first/t1/j1");
    expect(with_).toContain("scores/first/t1/j1");
  });

  test("somebody with no records produces no changes", () => {
    expect(removalChanges({ uid: "nobody", ...args })).toEqual([]);
  });

  test("a legacy array-shaped roster is read too", () => {
    const changes = removalChanges({
      uid: "j1",
      ...args,
      teamsData: { t1: { schedule: { judges: { 0: { judgeId: "j1" }, 1: { judgeId: "j2" } } } } },
    });
    expect(changes.find((c) => c.path === "teams/t1/schedule/judges").after)
      .toEqual([{ judgeId: "j2" }]);
  });
});

describe("listing people", () => {
  test("merges the three role nodes into one row per person", async () => {
    const people = await listPeople();
    const ada = people.find((p) => p.uid === "j1");
    expect(ada.name).toBe("Ada Lovelace");
    expect(ada.roles).toEqual(["judge"]);
  });

  test("an organizer with no profile is still listed", async () => {
    // /admins holds only `true`, so this person has no name anywhere -- and
    // they are exactly who you need to find to revoke
    const people = await listPeople();
    const admin2 = people.find((p) => p.uid === "admin-2");
    expect(admin2).toBeTruthy();
    expect(admin2.roles).toEqual(["admin"]);
    expect(admin2.name).toMatch(/no profile/);
  });

  test("an organizer with only an archived record is still listed by name", async () => {
    // /admins holds nothing but `true`, so once roles are exclusive the record
    // carrying an organizer's name is the one the switch deleted. Without this
    // the person you most need to find is a uid.
    mockGet.mockImplementation(world({
      admins: { ...WORLD.admins, x1: true },
      "archive/people": {
        x1: {
          "1700000000000-competitor": {
            role: "competitor",
            record: { firstName: "Mary", lastName: "Jackson", email: "mary@example.com" },
          },
        },
      },
    }));

    const person = (await listPeople()).find((p) => p.uid === "x1");
    expect(person.name).toBe("Mary Jackson");
    expect(person.email).toBe("mary@example.com");
  });

  test("the newest archived record wins", async () => {
    mockGet.mockImplementation(world({
      admins: { ...WORLD.admins, x1: true },
      "archive/people": {
        x1: {
          "1700000000000-competitor": { role: "competitor", record: { firstName: "Old" } },
          "1800000000000-judge": { role: "judge", record: { firstName: "New" } },
        },
      },
    }));

    expect((await listPeople()).find((p) => p.uid === "x1").name).toBe("New");
  });

  test("a live record beats an archived one", async () => {
    mockGet.mockImplementation(world({
      "archive/people": { j1: { "1800000000000-judge": { role: "judge", record: { firstName: "Stale" } } } },
    }));

    expect((await listPeople()).find((p) => p.uid === "j1").name).toBe("Ada Lovelace");
  });

  test("someone can hold more than one role", async () => {
    mockGet.mockImplementation(world({ admins: { j1: true } }));
    const people = await listPeople();
    expect(people.find((p) => p.uid === "j1").roles.sort()).toEqual(["admin", "judge"]);
  });
});

describe("searching", () => {
  const ada = { uid: "j1", name: "Ada Lovelace", email: "ada@example.com" };
  test("matches on name, email and uid", () => {
    expect(matchesQuery(ada, "lovel")).toBe(true);
    expect(matchesQuery(ada, "ADA@")).toBe(true);
    expect(matchesQuery(ada, "j1")).toBe(true);
  });
  test("an empty query matches everyone", () => {
    expect(matchesQuery(ada, "  ")).toBe(true);
  });
  test("a miss is a miss", () => {
    expect(matchesQuery(ada, "turing")).toBe(false);
  });
});

describe("giving somebody their one role", () => {
  test("switching a competitor to judge carries their name and email across", async () => {
    // the record is merged into their profile at sign-in, so a blank one here
    // erases the name and email they registered with -- their own page then
    // shows nothing and a password reset refuses for want of an address
    const result = await setSoleRole({ uid: "c1", name: "Grace", role: "judge" });
    expect(result.ok).toBe(true);

    const record = payload()["judges/c1"];
    expect(record.firstName).toBe("Grace");
    expect(record.lastName).toBe("Hopper");
    expect(record.email).toBe("grace@example.com");
    expect(record.wantsToJudge).toBe(true);
    expect(record.isRound1Judge).toBe(false);
  });

  test("the role they are leaving is deleted, with its roster entries", async () => {
    await setSoleRole({ uid: "c1", name: "Grace", role: "judge" });
    const p = payload();
    expect(p["competitors/c1"]).toBeNull();
    expect(p["teams/t1/members/c1"]).toBeNull();
  });

  test("the record it deletes is archived first, in the same write", async () => {
    await setSoleRole({ uid: "c1", name: "Grace", role: "judge" });
    const p = payload();

    const archived = Object.entries(p).find(([path]) => path.startsWith("archive/people/c1/"));
    expect(archived).toBeTruthy();
    const [, entry] = archived;
    expect(entry.role).toBe("competitor");
    expect(entry.record).toEqual(WORLD.competitors.c1);
    expect(entry.archivedBy).toBe("admin-1");
  });

  test("a judge switching away takes their name off every schedule card", async () => {
    await setSoleRole({ uid: "j1", name: "Ada", role: "competitor" });
    const p = payload();
    expect(p["judges/j1"]).toBeNull();
    expect(p["teams/t1/schedule/judges"]).toEqual([{ judgeId: "j2", judgeName: "Alan Turing" }]);
    expect(p["finalRound/teams/t1/excludedJudges/j1"]).toBeNull();
    expect(p["competitors/j1"].firstName).toBe("Ada");
  });

  test("a record for the role they are keeping is left alone", async () => {
    // they hold two roles and you are collapsing them to one; rewriting the
    // record for the role that survives would blank whatever is in it
    mockGet.mockImplementation(world({
      judges: { ...WORLD.judges, c1: { firstName: "Grace", lastName: "Hopper", isRound1Judge: true } },
    }));
    await setSoleRole({ uid: "c1", name: "Grace", role: "judge" });

    const p = payload();
    expect(p["judges/c1"]).toBeUndefined();
    expect(p["competitors/c1"]).toBeNull();
  });

  test("organizer access is untouched by a role change", async () => {
    // organizer is a flag on top, not one of the roles being swapped. Making it
    // exclusive deleted the judge record an organizer needs to be scheduled, to
    // see their cards and to score under their own name.
    mockGet.mockImplementation(world({ admins: { ...WORLD.admins, c1: true } }));
    await setSoleRole({ uid: "c1", name: "Grace", role: "judge" });

    const p = payload();
    expect(p["admins/c1"]).toBeUndefined();
    expect(p["judges/c1"].firstName).toBe("Grace");
  });

  test("an organizer with no other record can still be given one", async () => {
    mockGet.mockImplementation(world({ admins: { ...WORLD.admins, x1: true } }));
    const result = await setSoleRole({ uid: "x1", name: "Mary", role: "judge" });

    expect(result.ok).toBe(true);
    expect(payload()["judges/x1"].wantsToJudge).toBe(true);
  });

  test("no role removes everything they hold", async () => {
    await setSoleRole({ uid: "c1", name: "Grace", role: "none" });
    const p = payload();
    expect(p["competitors/c1"]).toBeNull();
    expect(p["teams/t1/members/c1"]).toBeNull();
    expect(Object.keys(p).some((path) => path.startsWith("archive/people/c1/"))).toBe(true);
  });

  test("the role they already hold on its own is refused", async () => {
    const result = await setSoleRole({ uid: "j1", name: "Ada", role: "judge" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already/);
  });

  test("somebody with no roles cannot be switched to no role", async () => {
    const result = await setSoleRole({ uid: "nobody", name: "Nobody", role: "none" });
    expect(result.ok).toBe(false);
  });

  test("an unknown role is refused rather than writing a junk node", async () => {
    expect((await setSoleRole({ uid: "j1", role: "wizard" })).ok).toBe(false);
  });

  test("scores survive a switch, because they count toward averages", async () => {
    await setSoleRole({ uid: "j1", name: "Ada", role: "competitor" });
    expect(payload()["scores/first/t1/j1"]).toBeUndefined();
  });
});

describe("organizer access, on top of the role", () => {
  test("granting sets the flag and nothing else", async () => {
    const result = await setOrganizer({ uid: "c1", name: "Grace", enabled: true });
    expect(result.ok).toBe(true);
    const p = payload();
    expect(p["admins/c1"]).toBe(true);
    expect(p["competitors/c1"]).toBeUndefined();
  });

  test("revoking clears the flag and leaves their record", async () => {
    await setOrganizer({ uid: "admin-2", name: "Two", enabled: false });
    const p = payload();
    expect(p["admins/admin-2"]).toBeNull();
    expect(p["judges/admin-2"]).toBeUndefined();
  });

  test("the last organizer cannot be revoked", async () => {
    mockGet.mockImplementation(world({ admins: { "admin-9": true } }));
    const result = await setOrganizer({ uid: "admin-9", name: "Nine", enabled: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/last admin/);
  });

  test("you cannot revoke your own organizer access", async () => {
    const result = await setOrganizer({ uid: "admin-1", name: "Me", enabled: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/your own/);
  });
});

describe("describing what a switch costs", () => {
  const person = (over) => ({ uid: "c1", roles: ["competitor"], judge: null, competitor: null, ...over });

  test("organizer access is never described as something being dropped", () => {
    const lines = describeSwitch({
      person: person({ roles: ["admin", "competitor"], competitor: { firstName: "Grace" } }),
      role: "judge",
    });
    expect(lines.join(" ")).not.toMatch(/admin/i);
    expect(lines.join(" ")).toMatch(/competitor record/i);
  });

  test("names the record being dropped", () => {
    const lines = describeSwitch({ person: person({ competitor: { firstName: "Grace" } }), role: "judge" });
    expect(lines.join(" ")).toMatch(/competitor record/i);
  });

  test("calls out a team and a resume, which do not come back with the role", () => {
    const lines = describeSwitch({
      person: person({ competitor: { teamId: "t1", resume: "https://example.com/cv.pdf" } }),
      role: "judge",
    });
    expect(lines.join(" ")).toMatch(/team/i);
    expect(lines.join(" ")).toMatch(/resume/i);
  });

  test("calls out judging assignments and the round-one mark", () => {
    const lines = describeSwitch({
      person: person({
        roles: ["judge"],
        judge: { isRound1Judge: true, teamAssignments: { t1: {}, t2: {} } },
      }),
      role: "competitor",
    });
    expect(lines.join(" ")).toMatch(/2 judging assignment/i);
    expect(lines.join(" ")).toMatch(/first-round/i);
  });

  test("says the copy is recoverable", () => {
    const lines = describeSwitch({ person: person({ competitor: {} }), role: "judge" });
    expect(lines.join(" ")).toMatch(/archived/i);
  });
});

describe("deleting a person", () => {
  test("removes every role and says the login survives", async () => {
    const result = await deletePerson({ uid: "j1", name: "Ada" });
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/login still works/i);
    expect(payload()["judges/j1"]).toBeNull();
  });

  test("refuses to delete the signed-in organizer", async () => {
    const result = await deletePerson({ uid: "admin-1" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("refuses when it would remove the last organizer", async () => {
    mockGet.mockImplementation(world({ admins: { "admin-9": true }, judges: { "admin-9": {} } }));
    const result = await deletePerson({ uid: "admin-9" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/last admin/);
  });

  test("somebody with nothing recorded is reported, not silently written", async () => {
    const result = await deletePerson({ uid: "ghost" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("bulk edits", () => {
  test("set one field on many judges in a single update", async () => {
    const result = await bulkSet({ uids: ["j1", "j2"], role: "judge", field: "checkedIn", value: true });
    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(payload()["judges/j1/checkedIn"]).toBe(true);
    expect(payload()["judges/j2/checkedIn"]).toBe(true);
  });

  test("people already set that way are left out of the write", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "judges/j1/checkedIn") return { exists: () => true, val: () => true };
      if (r.path === "judges/j2/checkedIn") return { exists: () => true, val: () => false };
      return world()(r);
    });
    await bulkSet({ uids: ["j1", "j2"], role: "judge", field: "checkedIn", value: true });
    expect("judges/j1/checkedIn" in payload()).toBe(false);
    expect(payload()["judges/j2/checkedIn"]).toBe(true);
  });

  test("a field that does not belong to the role is refused", async () => {
    const result = await bulkSet({ uids: ["c1"], role: "competitor", field: "isRound1Judge", value: true });
    expect(result.ok).toBe(false);
  });

  test("an empty selection is refused", async () => {
    expect((await bulkSet({ uids: [], role: "judge", field: "checkedIn", value: true })).ok).toBe(false);
  });
});

describe("deleting a team", () => {
  test("detaches its members rather than orphaning their teamId", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "teams/t1") return { exists: () => true, val: () => WORLD.teams.t1 };
      return world()(r);
    });
    const result = await deleteTeam({ teamId: "t1", teamName: "Lumen" });
    expect(result.ok).toBe(true);
    expect(payload()["teams/t1"]).toBeNull();
    expect(payload()["competitors/c1/teamId"]).toBeNull();
  });

  test("clears every judge's copy of the assignment", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "teams/t1") return { exists: () => true, val: () => WORLD.teams.t1 };
      if (r.path === "judges") {
        return { exists: () => true, val: () => ({ j1: { teamAssignments: { t1: {} }, finalAssignments: { t1: {} } } }) };
      }
      return world()(r);
    });
    await deleteTeam({ teamId: "t1" });
    expect(payload()["judges/j1/teamAssignments/t1"]).toBeNull();
    expect(payload()["judges/j1/finalAssignments/t1"]).toBeNull();
  });

  test("a finalist is taken out of the standings too", async () => {
    // the results page ranks whatever is in /finalRound/teams, so a team left
    // there after being deleted could be shown winning
    const table = world({
      "finalRound/teams": { t1: { name: "Lumen", averageScore: 33, excludedJudges: { j1: true } } },
    });
    mockGet.mockImplementation(async (r) => {
      // the fixture is keyed by node, so the single-team read needs its own case
      if (r.path === "teams/t1") return { exists: () => true, val: () => WORLD.teams.t1 };
      return table(r);
    });
    await deleteTeam({ teamId: "t1", teamName: "Lumen" });

    expect(payload()["finalRound/teams/t1"]).toBeNull();
  });

  test("a team that was never in the final round leaves the standings alone", async () => {
    const table = world({ "finalRound/teams": { t9: { name: "Other" } } });
    mockGet.mockImplementation(async (r) => {
      if (r.path === "teams/t1") return { exists: () => true, val: () => WORLD.teams.t1 };
      return table(r);
    });
    await deleteTeam({ teamId: "t1", teamName: "Lumen" });

    const p = payload();
    expect(p["finalRound/teams/t1"]).toBeUndefined();
    expect(p["finalRound/teams/t9"]).toBeUndefined();
  });

  test("a team that is already gone is reported", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "teams/gone") return { exists: () => false, val: () => null };
      return world()(r);
    });
    expect((await deleteTeam({ teamId: "gone" })).ok).toBe(false);
  });
});

describe("attaching a record to an existing login", () => {
  test("a brand new uid gets the record and it is logged", async () => {
    const result = await attachRecord({ uid: "new1", role: "judge", firstName: "Ada", lastName: "Lovelace" });
    expect(result.ok).toBe(true);
    expect(payload()["judges/new1"].firstName).toBe("Ada");
  });

  test("refuses when the uid already has that role's record", async () => {
    // the WORLD fixture's world() helper only answers whole-node reads
    // ("judges"), not a single uid's child path -- attachRecord reads
    // "judges/j1" directly, so that specific path needs its own stub
    mockGet.mockImplementation(async (r) => {
      if (r.path === "judges/j1") return { exists: () => true, val: () => WORLD.judges.j1 };
      return world()(r);
    });
    const result = await attachRecord({ uid: "j1", role: "judge", firstName: "Someone" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already has a judge record/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  /**
   * The race this guards against: a plain `get`-then-write lets two
   * organizers who both fix the same broken uid at the same moment both read
   * "no record yet" and both write, with the second silently overwriting the
   * first and nobody told. A transaction re-reads the path AT THE MOMENT IT
   * COMMITS rather than trusting an earlier read, so only one of two racing
   * attempts can win.
   *
   * The mock below is deliberately atomic where the real database is atomic
   * (nothing is awaited between reading the current value and writing the
   * next one inside `proceed`) and gated where the real one is slow (both
   * calls queue until both have arrived, mirroring two organizers who each
   * confirmed the uid was free before either one wrote). Getting either
   * wrong makes this test pass while proving nothing.
   */
  test("two organizers racing to attach the same uid are not both told it worked", async () => {
    const db = {};
    const queued = [];

    mockRunTransaction.mockImplementation(
      (reference, callback) =>
        new Promise((resolve) => {
          const proceed = () => {
            const current = db[reference.path] ?? null;
            const next = callback(current);
            if (next === undefined) {
              resolve({ committed: false, snapshot: { val: () => current, exists: () => current !== null } });
              return;
            }
            db[reference.path] = next;
            resolve({ committed: true, snapshot: { val: () => next, exists: () => true } });
          };
          if (queued.length < 2) queued.push(proceed);
          else proceed();
        })
    );

    const runA = attachRecord({ uid: "new1", role: "judge", firstName: "Ada" });
    const runB = attachRecord({ uid: "new1", role: "judge", firstName: "Imposter" });

    // bounded, not `while (queued.length < 2)` -- against code that never
    // reaches a transaction at all this would spin forever instead of
    // failing, and a hung suite is a worse signal than a red assertion
    for (let i = 0; i < 1000 && queued.length < 2; i += 1) await Promise.resolve();
    queued.forEach((proceed) => proceed());

    const [a, b] = await Promise.all([runA, runB]);

    // exactly one attempt wins; the other is refused, not silently discarded
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.error).toMatch(/already has a judge record/);

    // and the winner's identity is what actually stuck
    const winnerName = a.ok ? "Ada" : "Imposter";
    expect(db["judges/new1"].firstName).toBe(winnerName);
  });
});

describe("blank records", () => {
  test("a new judge is not in the round one pool and not checked in", () => {
    const judge = blankJudge({ firstName: "New" });
    expect(judge.isRound1Judge).toBe(false);
    expect(judge.checkedIn).toBe(false);
    expect(judge.foodCheckIn).toBe(false);
  });

  test("withCompany follows whether a company was given", () => {
    expect(blankJudge({ company: "CarMax" }).withCompany).toBe(true);
    expect(blankJudge({}).withCompany).toBe(false);
  });

  test("a new competitor has no team and no check-in", () => {
    const competitor = blankCompetitor({ firstName: "New" });
    expect(competitor.checkedIn).toBe(false);
    expect(competitor.teamId).toBeUndefined();
  });

  test("a new competitor's dietary default matches what every reader compares against", () => {
    // Registration.js writes "none", Profile.js lists ["none", ...], and
    // Search.js only renders a dietary chip when the value is not "none" --
    // a capitalized default here slips past all three and flags a walk-in to
    // catering as having a restriction called "None"
    expect(blankCompetitor({ firstName: "New" }).dietaryRestriction).toBe("none");
  });
});

/**
 * The archive had nothing to read it.
 *
 * A role change copied the record it was about to delete and then offered no
 * way to get it back, which made "a copy is archived, and can be put back" true
 * only of the first half.
 */
describe("putting an archived record back", () => {
  const archive = {
    "1800000000000-competitor": {
      role: "competitor",
      record: { firstName: "Grace", lastName: "Hopper", email: "grace@example.com", major: "CS" },
    },
    "1700000000000-judge": {
      role: "judge",
      record: { firstName: "Grace", lastName: "Hopper", email: "grace@example.com" },
    },
  };

  test("newest first, so the obvious choice is the top one", async () => {
    mockGet.mockImplementation(world({ "archive/people/c9": archive }));
    const entries = await listArchived("c9");
    expect(entries.map((e) => e.role)).toEqual(["competitor", "judge"]);
  });

  test("nothing archived is an empty list, not a throw", async () => {
    mockGet.mockImplementation(world());
    expect(await listArchived("nobody")).toEqual([]);
  });

  test("restoring writes the record back under its own role", async () => {
    mockGet.mockImplementation(world({ "archive/people/c9": archive }));
    const result = await restoreArchived({ uid: "c9", key: "1800000000000-competitor" });

    expect(result.ok).toBe(true);
    expect(payload()["competitors/c9"].major).toBe("CS");
    expect(payload()["competitors/c9"].firstName).toBe("Grace");
  });

  test("it refuses rather than overwriting a record made since", async () => {
    // c1 already has a competitor record in the world fixture
    mockGet.mockImplementation(world({ "archive/people/c1": archive }));
    const result = await restoreArchived({ uid: "c1", key: "1800000000000-competitor" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already have a competitor record/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("an archive key that is gone is reported, not written as undefined", async () => {
    mockGet.mockImplementation(world({ "archive/people/c9": archive }));
    const result = await restoreArchived({ uid: "c9", key: "9999999999999-competitor" });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

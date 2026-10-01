/**
 * The final round's service layer against an in-memory database: the cut, the
 * warnings an organizer sees, the one atomic publish (standings, team slots,
 * judge assignments), closing the round, and the two live subscriptions.
 *
 * finalRoundPlan.test.js covers editing a plan; this covers what is read to
 * build one and exactly what is written when it goes live.
 *
 * Scores use only the `problem` criterion, so a card of N is worth 4N out of 40.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "admin-1" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("../../testing/fakeDatabase");
const {
  FINAL_ROUND_ROOM,
  DEFAULT_FINAL_ROUND_SIZE,
  MIN_JUDGES_FOR_CONFIDENCE,
  loadFirstRoundScores,
  rankTeams,
  allJudgesForPicker,
  warningsFor,
  planFinalRound,
  readLiveFinalBasis,
  publishFinalRound,
  deactivateFinalRound,
  subscribeToFinalRoundActive,
  subscribeToFinalRoundStandings,
} = require("./finalRoundService");

const card = (problem, extra = {}) => ({ problem, ...extra });

const seed = () => ({
  admins: { "admin-1": true },
  teams: {
    t1: { name: "Lantern", submitted: true },
    t2: { name: "Circles", submitted: true },
    t3: { name: "Tempo", submitted: true },
    t4: { name: "Draft", submitted: false },
    t5: { name: "Unscored", submitted: true },
  },
  judges: {
    j1: { firstName: "Ada", lastName: "Byron", isRound1Judge: true, checkedIn: true },
    j2: { firstName: "Grace", isFinalRoundJudge: true },
    j3: { firstName: "Unmarked", checkedIn: true },
    j4: { lastName: "Absent", isRound1Judge: true },
  },
  scores: {
    first: {
      t1: { j1: card(9), j4: card(9) },
      t2: { j1: card(8, { fundable: true }) },
      t3: { j1: card(8) },
      t4: { j1: card(10) },
    },
  },
  config: { finalRoundSize: 2 },
});

beforeEach(() => {
  mockCurrentUser.value = { uid: "admin-1" };
  db.reset(seed());
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("the defaults", () => {
  expect(FINAL_ROUND_ROOM).toBe("Rice 011");
  expect(DEFAULT_FINAL_ROUND_SIZE).toBe(4);
  expect(MIN_JUDGES_FOR_CONFIDENCE).toBe(2);
});

describe("reading and ranking", () => {
  test("loads every first-round card by team, and nothing when there are none", async () => {
    await expect(loadFirstRoundScores()).resolves.toEqual(seed().scores.first);
    db.setData("scores", { final: { t1: { j1: card(1) } } });
    await expect(loadFirstRoundScores()).resolves.toEqual({});
  });

  test("a team node with no cards loads as an empty set", async () => {
    jest.spyOn(db.module, "get").mockResolvedValueOnce({ exists: () => true, val: () => ({ t1: null }) });
    await expect(loadFirstRoundScores()).resolves.toEqual({ t1: {} });
  });

  test("ranks scored teams by average, then fundable votes, leaving out the unscored", () => {
    const { teams, scores } = seed();
    expect(rankTeams(teams, scores.first)).toEqual([
      { teamId: "t4", name: "Draft", averageScore: 40, fundableVotes: 0, judgeCount: 1, submitted: false },
      { teamId: "t1", name: "Lantern", averageScore: 36, fundableVotes: 0, judgeCount: 2, submitted: true },
      { teamId: "t2", name: "Circles", averageScore: 32, fundableVotes: 1, judgeCount: 1, submitted: true },
      { teamId: "t3", name: "Tempo", averageScore: 32, fundableVotes: 0, judgeCount: 1, submitted: true },
    ]);
  });

  test("copes with no teams, no scores, and a null team record", () => {
    expect(rankTeams(undefined, {})).toEqual([]);
    expect(rankTeams({ t1: { name: "A" } }, undefined)).toEqual([]);
    expect(rankTeams({ t1: null }, { t1: { j1: card(5) } })).toEqual([
      { teamId: "t1", name: "Unnamed Team", averageScore: 20, fundableVotes: 0, judgeCount: 1, submitted: false },
    ]);
  });
});

describe("the judge picker", () => {
  test("offers everyone: marked before unmarked, checked in before absent, then by name", () => {
    const judges = {
      a: { firstName: "Zoe", isRound1Judge: true },
      b: { firstName: "Yan", isFinalRoundJudge: true, checkedIn: true },
      c: { firstName: "Xia", checkedIn: true },
      d: { firstName: "Abe" },
      e: { firstName: "Bea", isRound1Judge: true },
      f: { lastName: "  " },
    };
    expect(allJudgesForPicker(judges)).toEqual([
      { judgeId: "b", judgeName: "Yan", marked: true, checkedIn: true },
      { judgeId: "e", judgeName: "Bea", marked: true, checkedIn: false },
      { judgeId: "a", judgeName: "Zoe", marked: true, checkedIn: false },
      { judgeId: "c", judgeName: "Xia", marked: false, checkedIn: true },
      { judgeId: "d", judgeName: "Abe", marked: false, checkedIn: false },
      { judgeId: "f", judgeName: "Unnamed Judge", marked: false, checkedIn: false },
    ]);
  });

  test("checked in means exactly true", () => {
    expect(allJudgesForPicker({ a: { checkedIn: "yes" } })[0].checkedIn).toBe(false);
    expect(allJudgesForPicker(undefined)).toEqual([]);
  });
});

describe("warnings", () => {
  const ranked = [
    { teamId: "a", name: "A", averageScore: 30, judgeCount: 3 },
    { teamId: "b", name: "B", averageScore: 28, judgeCount: 1 },
    { teamId: "c", name: "C", averageScore: 20, judgeCount: 2 },
  ];
  const judge = { judgeId: "j1", judgeName: "J" };
  const plan = (overrides = {}) => ({
    ranked,
    pool: [judge],
    assignments: {
      a: { teamId: "a", teamName: "A", order: 0, judges: [judge] },
      b: { teamId: "b", teamName: "B", order: 1, judges: [judge] },
    },
    ...overrides,
  });

  test("a clean plan has none beyond the thin panel", () => {
    expect(warningsFor(plan({ ranked: ranked.map((t) => ({ ...t, judgeCount: 2 })) }))).toEqual([]);
  });

  test("no cut at all is the only thing said", () => {
    expect(warningsFor(plan({ assignments: {} }))).toEqual(["No teams are in the cut."]);
    expect(warningsFor(undefined)).toEqual(["No teams are in the cut."]);
  });

  test("names every finalist on fewer than two judges", () => {
    const thin = ranked.map((t) => ({ ...t, judgeCount: t.teamId === "c" ? 3 : 1 }));
    expect(warningsFor(plan({ ranked: thin }))).toEqual(["A, B reached the final on fewer than 2 judges."]);
  });

  test("a finalist missing from the ranking is not called thin", () => {
    expect(warningsFor(plan({ ranked: [ranked[0]] }))).toEqual([]);
  });

  test("a tie across the cut line is reported", () => {
    const tied = ranked.map((t) => ({ ...t, judgeCount: 2, averageScore: t.teamId === "a" ? 30 : 28 }));
    const three = plan({
      ranked: [...tied, { teamId: "d", name: "D", averageScore: 28, judgeCount: 2 }],
    });
    expect(warningsFor(three)).toEqual(["B and C tied on average; the tiebreak put B through."]);
  });

  test("a tie inside the cut is not", () => {
    const tied = ranked.map((t) => ({ ...t, judgeCount: 2, averageScore: t.teamId === "c" ? 10 : 30 }));
    expect(warningsFor(plan({ ranked: tied }))).toEqual([]);
  });

  test("everyone in the cut means no tie to report", () => {
    const two = ranked.slice(0, 2).map((t) => ({ ...t, judgeCount: 2, averageScore: 30 }));
    expect(warningsFor(plan({ ranked: two }))).toEqual([]);
  });

  test("no plan ranking at all is not an error", () => {
    expect(warningsFor(plan({ ranked: undefined }))).toEqual([]);
  });

  test("an empty judge pool and an empty panel are both called out", () => {
    const fine = ranked.map((t) => ({ ...t, judgeCount: 2 }));
    const empty = plan({
      ranked: fine,
      pool: [],
      assignments: {
        a: { teamId: "a", teamName: "A", order: 0, judges: [] },
        b: { teamId: "b", teamName: "B", order: 1, judges: [] },
      },
    });
    expect(warningsFor(empty)).toEqual([
      "No judges are marked for either round, so nobody can be given a final-round assignment.",
      "A, B has nobody on its panel and will present to an empty room.",
    ]);
    expect(warningsFor(plan({ ranked: fine, pool: undefined }))).toEqual([
      "No judges are marked for either round, so nobody can be given a final-round assignment.",
    ]);
  });
});

describe("planning", () => {
  test("cuts the submitted teams to the configured size and seats the checked-in marked judges", async () => {
    const result = await planFinalRound();
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();

    const { plan } = result;
    expect(plan.ranked.map((t) => t.teamId)).toEqual(["t1", "t2", "t3"]);
    expect(plan.size).toBe(2);
    expect(plan.room).toBe("Rice 011");
    expect(plan.pool).toEqual([{ judgeId: "j1", judgeName: "Ada Byron" }]);
    expect(Object.values(plan.assignments)).toEqual([
      { teamId: "t1", teamName: "Lantern", order: 0, judges: [{ judgeId: "j1", judgeName: "Ada Byron" }] },
      { teamId: "t2", teamName: "Circles", order: 1, judges: [{ judgeId: "j1", judgeName: "Ada Byron" }] },
    ]);
    expect(result.warnings).toEqual([
      "Circles reached the final on fewer than 2 judges.",
      "Circles and Tempo tied on average; the tiebreak put Circles through.",
    ]);
  });

  test("can include teams that have not submitted, when asked", async () => {
    const { plan } = await planFinalRound({ requireSubmitted: false });
    expect(plan.ranked.map((t) => t.teamId)).toEqual(["t4", "t1", "t2", "t3"]);
  });

  test("uses the configured room, and seats every marked judge when nobody has checked in", async () => {
    db.setData("config/finalRoundRoom", "Olsson 120");
    db.setData("judges/j1/checkedIn", false);
    db.setData("judges/j3/checkedIn", false);
    const { plan } = await planFinalRound();
    expect(plan.room).toBe("Olsson 120");
    expect(plan.pool.map((j) => j.judgeId)).toEqual(["j1", "j2", "j4"]);
    expect(plan.pool.map((j) => j.judgeName)).toEqual(["Ada Byron", "Grace", "Absent"]);
  });

  test("an unmarked judge who checked in is not seated", async () => {
    const { plan } = await planFinalRound();
    expect(plan.pool.map((j) => j.judgeId)).not.toContain("j3");
  });

  test.each([
    ["missing", undefined],
    ["zero", 0],
    ["fractional", 1.5],
    ["not a number", "big"],
  ])("a %s size falls back to four", async (_label, size) => {
    db.setData("config/finalRoundSize", size ?? null);
    const { plan } = await planFinalRound();
    expect(plan.size).toBe(4);
  });

  test("a size given as a string is honoured", async () => {
    db.setData("config/finalRoundSize", "1");
    const { plan } = await planFinalRound();
    expect(plan.size).toBe(1);
  });

  test("no teams, or no scored submitted teams, is refused with a reason", async () => {
    db.setData("scores", null);
    await expect(planFinalRound()).resolves.toEqual({
      ok: false,
      error: "No teams have scores yet. Final round cannot be activated.",
      plan: null,
      warnings: [],
    });
    db.setData("teams", null);
    await expect(planFinalRound()).resolves.toEqual({
      ok: false,
      error: "No teams found to evaluate for the final round",
      plan: null,
      warnings: [],
    });
  });

  test("only an admin can plan, and a failure is reported rather than thrown", async () => {
    db.setData("admins", null);
    await expect(planFinalRound()).resolves.toEqual({
      ok: false,
      error: "Only an admin can plan the final round",
      plan: null,
      warnings: [],
    });
    expect(console.error).toHaveBeenCalledWith("Error planning the final round:", expect.any(Error));

    db.setData("admins", { "admin-1": true });
    const realGet = db.module.get;
    jest.spyOn(db.module, "get").mockImplementation((ref) => (ref.path === "teams" ? Promise.reject(new Error("")) : realGet(ref)));
    await expect(planFinalRound()).resolves.toEqual({
      ok: false,
      error: "Something went wrong planning the final round.",
      plan: null,
      warnings: [],
    });
  });
});

describe("the live basis", () => {
  test("reports card counts, eligible and registered judges, submissions, room and size", async () => {
    const live = await readLiveFinalBasis();
    expect(live).toEqual({
      cardCounts: { t1: 2, t2: 1, t3: 1, t4: 1, t5: 0 },
      eligibleJudges: { j1: true },
      registeredJudges: { j1: true, j2: true, j3: true, j4: true },
      submitted: { t1: true, t2: true, t3: true, t4: false, t5: true },
      room: "Rice 011",
      size: 2,
      teamsData: seed().teams,
      judgesData: seed().judges,
    });
  });

  test("an empty database is an empty basis with the defaults", async () => {
    db.reset({});
    await expect(readLiveFinalBasis()).resolves.toMatchObject({
      cardCounts: {},
      eligibleJudges: {},
      registeredJudges: {},
      submitted: {},
      room: "Rice 011",
      size: 4,
    });
  });

  test("a null team record counts as not submitted", async () => {
    jest.spyOn(db.module, "get").mockImplementation(async (ref) => ({
      exists: () => ref.path === "teams",
      val: () => (ref.path === "teams" ? { tX: null } : null),
    }));
    await expect(readLiveFinalBasis()).resolves.toMatchObject({ submitted: { tX: false } });
  });
});

describe("publishing", () => {
  const plannedThenPublished = async () => {
    const { plan } = await planFinalRound();
    return { plan, result: await publishFinalRound(plan) };
  };

  test("writes the standings, each finalist's slot and each judge's assignments in one go", async () => {
    db.setData("teams/t3/finalSlot", { room: "old", timeslot: "Slot 9" });
    db.setData("judges/j2/finalAssignments", { t9: { teamId: "t9" } });
    db.setData("finalRoundDraft", { version: 3 });
    const before = db.writes.length;

    const { result } = await plannedThenPublished();
    expect(result).toEqual({
      ok: true,
      error: null,
      drift: [],
      warnings: [
        "Circles reached the final on fewer than 2 judges.",
        "Circles and Tempo tied on average; the tiebreak put Circles through.",
      ],
      snapshotId: expect.any(String),
    });

    expect(db.getData("finalRound")).toEqual({
      active: true,
      activatedAt: expect.any(Number),
      activatedBy: "admin-1",
      teams: {
        t1: { name: "Lantern", averageScore: 36, fundableVotes: 0, judgeCount: 2, timeslot: "Slot 1", room: "Rice 011" },
        t2: { name: "Circles", averageScore: 32, fundableVotes: 1, judgeCount: 1, timeslot: "Slot 2", room: "Rice 011" },
      },
    });
    expect(db.getData("teams/t1/finalSlot")).toEqual({ room: "Rice 011", timeslot: "Slot 1" });
    expect(db.getData("teams/t2/finalSlot")).toEqual({ room: "Rice 011", timeslot: "Slot 2" });
    expect(db.getData("teams/t3/finalSlot")).toBeNull();
    expect(db.getData("judges/j1/finalAssignments")).toEqual({
      t1: { teamId: "t1", teamName: "Lantern", room: "Rice 011", timeslot: "Slot 1" },
      t2: { teamId: "t2", teamName: "Circles", room: "Rice 011", timeslot: "Slot 2" },
    });
    expect(db.getData("judges/j2/finalAssignments")).toBeNull();
    expect(db.getData("finalRoundDraft")).toBeNull();

    // the restore point comes first, then the one publish update
    const rootUpdates = db.writes.slice(before).filter((w) => w.op === "update" && w.path === "");
    expect(Object.keys(rootUpdates[1].value)).toEqual(
      expect.arrayContaining(["finalRound/active", "finalRound/teams", "teams/t1/finalSlot", "judges/j1/finalAssignments"])
    );
  });

  test("takes a restore point of teams, judges and the final round first", async () => {
    const { result } = await plannedThenPublished();
    expect(db.getData(`snapshotIndex/${result.snapshotId}`)).toMatchObject({
      label: "Before activating the final round (2 teams)",
      reason: "activation rewrites every judge's final assignments and the standings",
      paths: ["teams", "judges", "finalRound"],
    });
  });

  test("a hand-picked panel is written exactly, and a judge seated nowhere loses any old assignment", async () => {
    const { plan } = await planFinalRound();
    plan.assignments.t1.judges = [{ judgeId: "j2", judgeName: "Grace" }];
    plan.assignments.t2.judges = [];
    db.setData("judges/j1/finalAssignments", { t7: { teamId: "t7" } });
    await publishFinalRound(plan);
    expect(db.getData("judges/j2/finalAssignments")).toEqual({
      t1: { teamId: "t1", teamName: "Lantern", room: "Rice 011", timeslot: "Slot 1" },
    });
    expect(db.getData("judges/j1/finalAssignments")).toBeNull();
  });

  test("a finalist missing from the ranking is published with zeros", async () => {
    const { plan } = await planFinalRound();
    plan.ranked = undefined;
    plan.basis.cardCounts = {};
    await publishFinalRound(plan);
    expect(db.getData("finalRound/teams/t1")).toEqual({
      name: "Lantern",
      averageScore: 0,
      fundableVotes: 0,
      judgeCount: 0,
      timeslot: "Slot 1",
      room: "Rice 011",
    });
  });

  test("advisory drift is reported back but does not stop the publish", async () => {
    const { plan } = await planFinalRound();
    db.setData("config/finalRoundRoom", "Olsson 120");
    const result = await publishFinalRound(plan);
    expect(result.ok).toBe(true);
    expect(result.drift).toEqual([expect.objectContaining({ kind: "room", level: "advisory" })]);
    // the plan's room is what goes out
    expect(db.getData("teams/t1/finalSlot/room")).toBe("Rice 011");
  });

  test("blocking drift refuses, writes nothing, and says what moved", async () => {
    const { plan } = await planFinalRound();
    db.setData("scores/first/t2/j2", card(1));
    const before = db.writes.length;
    const result = await publishFinalRound(plan);
    expect(result).toEqual({
      ok: false,
      error: null,
      drift: [expect.objectContaining({ kind: "scores", level: "blocking", teamId: "t2" })],
      warnings: [],
    });
    expect(db.writes.slice(before)).toEqual([]);
    expect(db.getData("finalRound")).toBeNull();
  });

  test("an empty cut is refused", async () => {
    await expect(publishFinalRound({ assignments: {} })).resolves.toEqual({
      ok: false,
      error: "No finalists to publish.",
      warnings: [],
    });
  });

  test("nothing is published when the restore point cannot be taken", async () => {
    const { plan } = await planFinalRound();
    jest.spyOn(db.module, "runTransaction").mockResolvedValue({ committed: false });
    await expect(publishFinalRound(plan)).resolves.toEqual({
      ok: false,
      error:
        "Could not create a restore point, so nothing was changed. " +
        "Could not update the restore point list. Nothing was saved.",
      warnings: [],
    });
    expect(db.getData("finalRound")).toBeNull();
  });

  test("only an admin can publish, and a failed write is reported", async () => {
    const { plan } = await planFinalRound();
    db.setData("admins", null);
    await expect(publishFinalRound(plan)).resolves.toEqual({
      ok: false,
      error: "Only an admin can activate the final round",
      warnings: [],
    });
    expect(console.error).toHaveBeenCalledWith("Error publishing the final round:", expect.any(Error));

    db.setData("admins", { "admin-1": true });
    const realUpdate = db.module.update;
    let calls = 0;
    jest.spyOn(db.module, "update").mockImplementation((ref, values) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("")) : realUpdate(ref, values);
    });
    await expect(publishFinalRound(plan)).resolves.toEqual({
      ok: false,
      error: "Something went wrong publishing the final round.",
      warnings: [],
    });
  });
});

describe("closing the round", () => {
  beforeEach(async () => {
    const { plan } = await planFinalRound();
    await publishFinalRound(plan);
  });

  test("archives the standings and clears every slot and assignment with the flag", async () => {
    const standings = db.getData("finalRound/teams");
    jest.spyOn(Date, "now").mockReturnValue(1234);
    await expect(deactivateFinalRound()).resolves.toEqual({ ok: true });

    const finalRound = db.getData("finalRound");
    expect(finalRound).toEqual({
      active: false,
      activatedAt: expect.any(Number),
      activatedBy: "admin-1",
      deactivatedAt: 1234,
      deactivatedBy: "admin-1",
      archive: { 1234: { teams: standings, archivedAt: 1234, archivedBy: "admin-1" } },
    });
    for (const judge of Object.values(db.getData("judges"))) expect(judge).not.toHaveProperty("finalAssignments");
    for (const team of Object.values(db.getData("teams"))) expect(team).not.toHaveProperty("finalSlot");
  });

  test("with nothing live, archives nothing", async () => {
    db.reset({ admins: { "admin-1": true } });
    await deactivateFinalRound();
    expect(db.getData("finalRound")).toEqual({
      active: false,
      deactivatedAt: expect.any(Number),
      deactivatedBy: "admin-1",
    });
  });

  test("only an admin can close it", async () => {
    db.setData("admins", null);
    await expect(deactivateFinalRound()).rejects.toThrow("Only an admin can deactivate the final round");
  });
});

describe("subscriptions", () => {
  test("active is true only for a literal true, and follows changes until stopped", () => {
    const seen = [];
    const stop = subscribeToFinalRoundActive((state) => seen.push(state));
    expect(seen).toEqual([{ active: false }]);
    db.setData("finalRound/active", true);
    db.setData("finalRound/active", "true");
    stop();
    db.setData("finalRound/active", true);
    expect(seen).toEqual([{ active: false }, { active: true }, { active: false }]);
  });

  test("standings are null until there are some, and follow changes until stopped", () => {
    const seen = [];
    const stop = subscribeToFinalRoundStandings((state) => seen.push(state));
    db.setData("finalRound/teams", { t1: { name: "A" } });
    stop();
    db.setData("finalRound/teams", { t2: { name: "B" } });
    expect(seen).toEqual([{ teams: null }, { teams: { t1: { name: "A" } } }]);
  });

  test("a denied read reports inactive and no standings, with the reason", () => {
    const denied = new Error("PERMISSION_DENIED");
    jest.spyOn(db.module, "onValue").mockImplementation((_ref, _ok, fail) => {
      fail(denied);
      return () => {};
    });
    const active = jest.fn();
    const standings = jest.fn();
    subscribeToFinalRoundActive(active);
    subscribeToFinalRoundStandings(standings);
    expect(active).toHaveBeenCalledWith({ active: false, error: "PERMISSION_DENIED" });
    expect(standings).toHaveBeenCalledWith({ teams: null, error: "PERMISSION_DENIED" });
    expect(console.error).toHaveBeenCalledWith("Failed to subscribe to final round state:", denied);
    expect(console.error).toHaveBeenCalledWith("Failed to subscribe to final round standings:", denied);
  });
});

/**
 * What the drift check tells an organizer, word for word, and the repair it
 * offers, for plans whose world moved in every way at once.
 *
 * checkDrift.test.js covers each kind of drift on its own; this pins the
 * messages and repair targets together, which is where an off-by-one room or
 * a name read from the wrong side would show.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);

const db = await import("../../testing/fakeDatabase");
const { checkDrift, readLiveBasis } = await import("./checkDrift");

const basis = {
  teamIds: ["a", "b"],
  judgeIds: ["j1", "j2", "j3"],
  rooms: ["R1", "R2"],
  batchCount: 2,
  batchTimes: { 1: "5:00 PM", 2: "5:15 PM" },
  target: 2,
};
const plan = {
  assignments: {
    a: { id: "a", teamName: "A", batch: 1, room: "R1", judges: [{ judgeId: "j1" }] },
    b: { id: "b", teamName: "B", batch: 1, room: "R2", judges: [{ judgeId: "j2" }] },
  },
  teamNames: { a: "A", b: "B" },
  judgeNames: { j1: "J1", j2: "J2", j3: "J3" },
};
const unchanged = {
  teamIds: ["a", "b"],
  judgeIds: ["j1", "j2", "j3"],
  rooms: ["R1", "R2"],
  batchCount: 2,
  batchTimes: { 1: "5:00 PM", 2: "5:15 PM" },
  target: 2,
  teamNames: { a: "A", b: "B" },
  judgeNames: { j1: "J1", j2: "J2", j3: "J3" },
};

test("nothing moved means nothing to say", () => {
  expect(checkDrift(basis, unchanged, plan)).toEqual({ blocking: [], advisory: [] });
});

test("everything moved at once: each change is named, with a repair that does not collide", () => {
  const live = {
    teamIds: ["b", "c", "d"],
    judgeIds: ["j2", "j3"],
    rooms: ["R2", "R3"],
    batchCount: 3,
    batchTimes: { 1: "5:00 PM" },
    target: 3,
    teamNames: { b: "B2", c: "C" },
    judgeNames: { j2: "J2 new", j3: "J3" },
  };
  expect(checkDrift(basis, live, plan)).toEqual({
    blocking: [
      {
        kind: "teamAppeared",
        message: "C submitted after this plan was built and has no slot.",
        repair: { type: "moveTeam", teamId: "c", batch: 1, room: "R3", teamName: "C" },
      },
      {
        kind: "teamAppeared",
        message: "d submitted after this plan was built and has no slot.",
        repair: { type: "moveTeam", teamId: "d", batch: 2, room: "R2", teamName: "d" },
      },
      {
        kind: "teamWithdrew",
        message: "A withdrew its submission since this plan was built.",
        repair: { type: "dropTeam", teamId: "a" },
      },
      {
        kind: "judgeLost",
        message: "J1 is no longer a first round judge, but is on the panel for A.",
        repair: { type: "removeJudge", teamId: "a", judgeUid: "j1" },
      },
      {
        kind: "roomRemoved",
        message: "R1 is no longer a configured room, and batch 1 has no free room to move A into. Rebuild the plan.",
        repair: { type: "rebuild" },
      },
      {
        kind: "batchCountChanged",
        message: "Batch count changed from 2 to 3 since this plan was built.",
        repair: { type: "rebuild" },
      },
      {
        kind: "targetChanged",
        message: "Judges per team changed from 2 to 3 since this plan was built.",
        repair: { type: "rebuild" },
      },
    ],
    advisory: [
      { kind: "batchTimesChanged", message: "Batch times changed since this plan was built. The new times will be applied to the draft." },
      { kind: "nameChanged", message: "J2 is now J2 new." },
      { kind: "nameChanged", message: "B is now B2." },
    ],
  });
});

test("a removed room with a free one in its batch is moved there", () => {
  const live = { ...unchanged, rooms: ["R2", "R3"] };
  expect(checkDrift(basis, live, plan).blocking).toEqual([
    {
      kind: "roomRemoved",
      message: "R1 is no longer a configured room, but A is using it in batch 1.",
      repair: { type: "moveTeam", teamId: "a", batch: 1, room: "R3" },
    },
  ]);
});

test("rooms removed under several teams are handled in id order", () => {
  const twoGone = {
    ...plan,
    assignments: {
      z: { id: "z", teamName: "Z", batch: 1, room: "Old1", judges: [] },
      a: { id: "a", teamName: "A", batch: 1, room: "Old2", judges: [] },
    },
  };
  const live = { ...unchanged, teamIds: ["a", "z"], rooms: ["N1", "N2"] };
  const moves = checkDrift({ ...basis, teamIds: ["a", "z"] }, live, twoGone).blocking.map((issue) => issue.repair);
  expect(moves).toEqual([
    { type: "moveTeam", teamId: "a", batch: 1, room: "N1" },
    { type: "moveTeam", teamId: "z", batch: 1, room: "N2" },
  ]);
});

test("teams that appeared or withdrew are handled in id order, however they are listed", () => {
  const live = { ...unchanged, teamIds: ["d", "c"], teamNames: undefined };
  const kinds = checkDrift({ ...basis, teamIds: ["b", "a"] }, live, plan).blocking.map((issue) => [issue.kind, issue.repair.teamId]);
  expect(kinds).toEqual([
    ["teamAppeared", "c"],
    ["teamAppeared", "d"],
    ["teamWithdrew", "a"],
    ["teamWithdrew", "b"],
  ]);
});

test("rooms removed under three teams are handled in id order", () => {
  const three = {
    ...plan,
    assignments: {
      z: { id: "z", teamName: "Z", batch: 1, room: "Old1", judges: [] },
      m: { id: "m", teamName: "M", batch: 1, room: "Old2", judges: [] },
      a: { id: "a", teamName: "A", batch: 1, room: "Old3", judges: [] },
    },
  };
  const live = { ...unchanged, teamIds: ["a", "m", "z"], rooms: ["N1", "N2", "N3"] };
  const moves = checkDrift({ ...basis, teamIds: ["a", "m", "z"] }, live, three).blocking.map((issue) => [issue.repair.teamId, issue.repair.room]);
  expect(moves).toEqual([
    ["a", "N1"],
    ["m", "N2"],
    ["z", "N3"],
  ]);
});

test("a room taken only in another batch is free for a team that lost its room", () => {
  const twoBatches = {
    ...plan,
    assignments: {
      a: { id: "a", teamName: "A", batch: 1, room: "Old", judges: [] },
      b: { id: "b", teamName: "B", batch: 2, room: "N1", judges: [] },
    },
  };
  const live = { ...unchanged, rooms: ["N1", "N2"] };
  expect(checkDrift(basis, live, twoBatches).blocking.map((issue) => issue.repair)).toEqual([
    { type: "moveTeam", teamId: "a", batch: 1, room: "N1" },
  ]);
});

test("a judge who left a panel they shared is still reported for it", () => {
  const shared = {
    ...plan,
    assignments: { ...plan.assignments, a: { ...plan.assignments.a, judges: [{ judgeId: "j1" }, { judgeId: "j3" }] } },
  };
  const live = { ...unchanged, judgeIds: ["j2", "j3"] };
  expect(checkDrift(basis, live, shared).blocking).toEqual([
    {
      kind: "judgeLost",
      message: "J1 is no longer a first round judge, but is on the panel for A.",
      repair: { type: "removeJudge", teamId: "a", judgeUid: "j1" },
    },
  ]);
});

test("live names missing altogether are not reported as renames", () => {
  expect(checkDrift(basis, { ...unchanged, teamNames: undefined, judgeNames: undefined }, plan).advisory).toEqual([]);
});

test("a new team with every room taken is told to rebuild", () => {
  const live = { ...unchanged, teamIds: ["a", "b", "c"], batchCount: 1, teamNames: { ...unchanged.teamNames, c: "C" } };
  expect(checkDrift({ ...basis, batchCount: 1 }, live, plan).blocking).toEqual([
    {
      kind: "teamAppeared",
      message: "C submitted after this plan was built, but every room in every batch is already taken. Rebuild the plan to include them.",
      repair: { type: "rebuild" },
    },
  ]);
});

test("a spare judge who left is only advisory, named from the plan, then live, then by id", () => {
  const live = { ...unchanged, judgeIds: ["j1", "j2"] };
  expect(checkDrift(basis, live, plan).advisory).toEqual([
    { kind: "judgeLost", message: "J3 is no longer available, but was only a spare judge and is not on any panel." },
  ]);
  expect(checkDrift(basis, { ...live, judgeNames: { j3: "Live J3" } }, { ...plan, judgeNames: {} }).advisory[0].message).toMatch(/^Live J3 /);
  expect(checkDrift(basis, { ...live, judgeNames: undefined }, { ...plan, judgeNames: undefined }).advisory[0].message).toMatch(/^j3 /);
});

test("a withdrawn team with no recorded name is named by id", () => {
  const live = { ...unchanged, teamIds: ["b"] };
  expect(checkDrift(basis, live, { ...plan, teamNames: undefined }).blocking[0].message).toBe(
    "a withdrew its submission since this plan was built."
  );
});

describe("batch times", () => {
  const timesDrift = (before, after) =>
    checkDrift({ ...basis, batchTimes: before }, { ...unchanged, batchTimes: after }, plan).advisory.map((a) => a.kind);

  test("an extra batch time counts as a change", () => {
    expect(timesDrift({ 1: "a" }, { 1: "a", 2: "b" })).toEqual(["batchTimesChanged"]);
  });

  test("a different time counts as a change", () => {
    expect(timesDrift({ 1: "a", 2: "b" }, { 1: "a", 2: "c" })).toEqual(["batchTimesChanged"]);
  });

  test("none on either side is no change", () => {
    expect(timesDrift(undefined, undefined)).toEqual([]);
    expect(timesDrift(undefined, {})).toEqual([]);
  });
});

test("a name that is blank on either side is not reported as changed", () => {
  const live = { ...unchanged, judgeNames: { j1: "" }, teamNames: {} };
  expect(checkDrift(basis, live, plan).advisory).toEqual([]);
});

describe("reading the live basis", () => {
  test("reports submitted teams and round-one judges, with every id and the config", async () => {
    db.reset({
      judges: {
        jb: { firstName: "Bea", lastName: "Lee", isRound1Judge: true, checkedIn: true },
        ja: { isRound1Judge: true },
        jf: { firstName: "Final", isFinalRoundJudge: true },
      },
      teams: { tb: { name: "B", submitted: true }, ta: { submitted: true }, tx: { name: "Draft" }, tn: null },
      config: { judgingRooms: ["R1"], batchCount: 2, batchTimes: { 1: "x", 2: "y" }, targetJudgesPerTeam: 2 },
    });
    await expect(readLiveBasis(false)).resolves.toEqual({
      teamIds: ["ta", "tb"],
      judgeIds: ["ja", "jb"],
      allTeamIds: ["ta", "tb", "tn", "tx"],
      allJudgeIds: ["ja", "jb", "jf"],
      rooms: ["R1"],
      batchCount: 2,
      batchTimes: { 1: "x", 2: "y" },
      target: 2,
      judgeNames: { jb: "Bea Lee", ja: "Unnamed Judge" },
      teamNames: { tb: "B", ta: "Unnamed Team" },
    });
    await expect(readLiveBasis(true)).resolves.toMatchObject({ judgeIds: ["jb"], judgeNames: { jb: "Bea Lee" } });
  });

  test("an empty event reads as empty", async () => {
    db.reset({});
    await expect(readLiveBasis(false)).resolves.toMatchObject({ teamIds: [], judgeIds: [], allTeamIds: [], allJudgeIds: [], rooms: [] });
  });
});

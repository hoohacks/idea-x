/**
 * Judge assignment edits against an in-memory database with the real admin
 * check: slotting a late team into a batch, the open-slot finder, the judge
 * names written onto each card, and the refusals and repairs that
 * assignmentEdits.test.js (which mocks the database) cannot see land.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../testing/fakeDatabase");
const {
  findConflict,
  findOpenSlots,
  scheduleTeamIntoBatch,
  assignJudgeToTeam,
  unassignJudgeFromTeam,
  swapJudges,
} = require("./assignmentEdits");

const schedule = (extra = {}) => ({
  teamName: "Lantern",
  id: "t1",
  room: "Rice 340",
  time: "5:00 PM",
  batch: 1,
  judges: [{ judgeId: "j1", judgeName: "Ada Byron" }],
  ...extra,
});

beforeEach(() => {
  const s = schedule();
  db.reset({
    admins: { "admin-1": true },
    config: { judgingRooms: ["Rice 340", "Rice 342", "Olsson 005"] },
    teams: {
      t1: { name: "Lantern", schedule: s },
      t2: { name: "Circles", schedule: { ...schedule({ teamName: "Circles", id: "t2", room: "Rice 342", batch: 2, time: "5:15 PM" }), judges: [{ judgeId: "j2", judgeName: "Grace" }] } },
      t3: { name: "Late" },
    },
    judges: {
      j1: { firstName: "Ada", lastName: "Byron", teamAssignments: { t1: s } },
      j2: { firstName: "Grace", teamAssignments: { t2: { id: "t2", batch: 2, room: "Rice 342", time: "5:15 PM", teamName: "Circles" } } },
      j3: { firstName: "  ", lastName: "" },
      j4: { lastName: "Hopper" },
    },
  });
});

describe("open slots", () => {
  test("lists each scheduled batch in order with its time and the rooms still free", async () => {
    await expect(findOpenSlots()).resolves.toEqual([
      { batch: 1, time: "5:00 PM", freeRooms: ["Rice 342", "Olsson 005"] },
      { batch: 2, time: "5:15 PM", freeRooms: ["Rice 340", "Olsson 005"] },
    ]);
  });

  test("two teams in one batch both take their rooms, and the batch keeps its first time", async () => {
    db.setData("teams/t4", { name: "Tempo", schedule: { batch: 1, time: "5:00 PM", room: "Olsson 005" } });
    await expect(findOpenSlots()).resolves.toEqual([
      { batch: 1, time: "5:00 PM", freeRooms: ["Rice 342"] },
      { batch: 2, time: "5:15 PM", freeRooms: ["Rice 340", "Olsson 005"] },
    ]);
  });

  test("reads rooms kept as a keyed set, and skips blank ones", async () => {
    db.setData("config/judgingRooms", { a: "Rice 340", b: " ", c: 7, d: "Thornton" });
    await expect(findOpenSlots()).resolves.toEqual([
      { batch: 1, time: "5:00 PM", freeRooms: ["Thornton"] },
      { batch: 2, time: "5:15 PM", freeRooms: ["Rice 340", "Thornton"] },
    ]);
  });

  test("batches come out in number order whatever order the teams are stored in", async () => {
    db.setData("teams", {
      a: { schedule: { batch: 3, time: "c", room: "Rice 340" } },
      b: { schedule: { batch: 1, time: "a", room: "Rice 340" } },
      c: { schedule: { batch: 2, time: "b", room: "Rice 340" } },
      d: { name: "no schedule" },
      e: null,
    });
    expect((await findOpenSlots()).map((slot) => slot.batch)).toEqual([1, 2, 3]);
  });

  test("no rooms configured and no teams is nothing to offer", async () => {
    db.reset({});
    await expect(findOpenSlots()).resolves.toEqual([]);
    db.setData("teams/t1/schedule", { batch: 1, time: "x", room: "R" });
    await expect(findOpenSlots()).resolves.toEqual([{ batch: 1, time: "x", freeRooms: [] }]);
  });
});

describe("slotting a late team into a batch", () => {
  const go = (overrides = {}) =>
    scheduleTeamIntoBatch({ teamId: "t3", batch: 1, room: "Olsson 005", time: "5:00 PM", judgeUids: ["j2", "j4"], ...overrides });

  test("writes the team's entry and every chosen judge's copy, in the generated shape", async () => {
    const expected = {
      teamName: "Late",
      id: "t3",
      room: "Olsson 005",
      time: "5:00 PM",
      batch: 1,
      judges: [
        { judgeId: "j2", judgeName: "Grace" },
        { judgeId: "j4", judgeName: "Hopper" },
      ],
    };
    await expect(go()).resolves.toEqual({ ok: true, assignment: expected });
    expect(db.getData("teams/t3/schedule")).toEqual(expected);
    expect(db.getData("judges/j2/teamAssignments/t3")).toEqual(expected);
    expect(db.getData("judges/j4/teamAssignments/t3")).toEqual(expected);
    expect(db.getData("judges/j1/teamAssignments/t3")).toBeNull();
    expect(db.writes.filter((w) => w.op === "update")).toHaveLength(1);
  });

  test("an unnamed team, a nameless judge and no time get placeholders", async () => {
    db.setData("teams/t3/name", null);
    const { assignment } = await go({ judgeUids: ["j3"], time: undefined });
    expect(assignment).toMatchObject({ teamName: "Unnamed Team", time: "TBD", judges: [{ judgeId: "j3", judgeName: "Unnamed Judge" }] });
  });

  test.each([
    ["no room", { room: "" }, "Pick a batch and a room."],
    ["no batch", { batch: 0 }, "Pick a batch and a room."],
    ["no judges", { judgeUids: [] }, "Pick at least one judge, or the team presents to an empty room."],
    ["a missing team", { teamId: "gone" }, "That team no longer exists."],
    ["a team already scheduled", { teamId: "t1", room: "Olsson 005" }, "That team is already scheduled. Use the slot override to move it instead."],
    ["a taken room", { room: "Rice 340" }, "Lantern is already in Rice 340 in batch 1."],
    ["an unregistered judge", { judgeUids: ["j2", "ghost"] }, "One of those judges is not registered."],
  ])("refuses %s", async (_label, overrides, error) => {
    await expect(go(overrides)).resolves.toEqual({ ok: false, error });
    expect(db.writes).toEqual([]);
  });

  test("the defaults are no judges and no override", async () => {
    await expect(scheduleTeamIntoBatch({ teamId: "t3", batch: 1, room: "Olsson 005" })).resolves.toEqual({
      ok: false,
      error: "Pick at least one judge, or the team presents to an empty room.",
    });
  });

  test("a room taken by an unnamed team is still refused", async () => {
    db.setData("teams/t1/name", null);
    await expect(go({ room: "Rice 340" })).resolves.toEqual({ ok: false, error: "Another team is already in Rice 340 in batch 1." });
  });

  test("other teams with no schedule do not get in the way", async () => {
    db.setData("teams/t5", { name: "Unscheduled" });
    await expect(go()).resolves.toMatchObject({ ok: true });
  });

  test("a judge still holding a stale copy of this same team is not a conflict with it", async () => {
    db.setData("judges/j2/teamAssignments/t3", { id: "t3", batch: 1, room: "Olsson 005", time: "5:00 PM", teamName: "Late" });
    await expect(go()).resolves.toMatchObject({ ok: true });
  });

  test("the same room in another batch is fine", async () => {
    await expect(go({ room: "Rice 342" })).resolves.toMatchObject({ ok: true });
  });

  test("a judge already busy in that batch is refused and named, unless overridden", async () => {
    await expect(go({ judgeUids: ["j4", "j1"] })).resolves.toEqual({
      ok: false,
      conflict: expect.objectContaining({ id: "t1" }),
      error: "Ada Byron is already in Rice 340 at 5:00 PM for Lantern in batch 1.",
    });
    expect(db.writes).toEqual([]);
    await expect(go({ judgeUids: ["j1"], allowConflict: true })).resolves.toMatchObject({ ok: true });
  });

  test("a judge busy in a different batch is not a conflict", async () => {
    await expect(go({ batch: 1, judgeUids: ["j2"] })).resolves.toMatchObject({ ok: true });
  });

  test("only an admin can do it", async () => {
    db.setData("admins", null);
    await expect(go()).rejects.toThrow("Only an admin can schedule a team");
  });
});

describe("finding a clash", () => {
  test("a judge with no assignments has none", async () => {
    await expect(findConflict("j3", "t1", 1)).resolves.toBeNull();
  });
});

describe("adding, removing and swapping", () => {
  test("a new judge is added under their full name, and the roster lands on the team", async () => {
    await expect(assignJudgeToTeam({ judgeUid: "j4", teamId: "t1" })).resolves.toEqual({
      ok: true,
      roster: [
        { judgeId: "j1", judgeName: "Ada Byron" },
        { judgeId: "j4", judgeName: "Hopper" },
      ],
    });
    expect(db.getData("teams/t1/schedule/judges")).toEqual([
      { judgeId: "j1", judgeName: "Ada Byron" },
      { judgeId: "j4", judgeName: "Hopper" },
    ]);
    expect(db.getData("judges/j4/teamAssignments/t1")).toEqual(db.getData("teams/t1/schedule"));
  });

  test("a judge whose name is only spaces is written as unnamed", async () => {
    const { roster } = await assignJudgeToTeam({ judgeUid: "j3", teamId: "t1" });
    expect(roster[1]).toEqual({ judgeId: "j3", judgeName: "Unnamed Judge" });
  });

  test("the roster commits by transaction without applying locally first", async () => {
    const transaction = jest.spyOn(db.module, "runTransaction");
    await assignJudgeToTeam({ judgeUid: "j4", teamId: "t1" });
    expect(transaction).toHaveBeenCalledWith(expect.objectContaining({ path: "teams/t1/schedule" }), expect.any(Function), {
      applyLocally: false,
    });
    transaction.mockRestore();
  });

  test("a team with no schedule entry is refused with what to do", async () => {
    await expect(assignJudgeToTeam({ judgeUid: "j4", teamId: "t3" })).rejects.toThrow(
      "That team has no schedule entry. Generate the schedule first."
    );
    await expect(unassignJudgeFromTeam({ judgeUid: "j1", teamId: "t3" })).rejects.toThrow("Generate the schedule first.");
  });

  test("an entry removed while choosing is reported as removed, not as someone else's edit", async () => {
    const real = db.module.runTransaction;
    const transaction = jest.spyOn(db.module, "runTransaction").mockImplementation(async (ref, updater, options) => {
      db.setData("teams/t1/schedule", null);
      return real(ref, updater, options);
    });
    await expect(assignJudgeToTeam({ judgeUid: "j4", teamId: "t1" })).resolves.toEqual({
      ok: false,
      error: "That team's schedule entry was removed while you were choosing. Reload and try again.",
    });
    transaction.mockRestore();
  });

  test("the last judge cannot be removed", async () => {
    await expect(unassignJudgeFromTeam({ judgeUid: "j1", teamId: "t1" })).resolves.toEqual({
      ok: false,
      error:
        "That is the only judge assigned to this team. Assign a replacement first, or the team presents to an empty room.",
    });
  });

  test("swaps one judge for another, clearing the old judge's copy", async () => {
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j4" })).resolves.toEqual({
      ok: true,
      roster: [{ judgeId: "j4", judgeName: "Hopper" }],
    });
    expect(db.getData("judges/j1/teamAssignments/t1")).toBeNull();
    expect(db.getData("judges/j4/teamAssignments/t1/judges")).toEqual([{ judgeId: "j4", judgeName: "Hopper" }]);
  });

  test("a swap refuses someone not on the team, and someone already on it", async () => {
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j2", toJudgeUid: "j4" })).resolves.toEqual({
      ok: false,
      error: "That judge is not assigned to this team.",
    });
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j1" })).resolves.toEqual({
      ok: false,
      error: "The replacement is already assigned to this team.",
    });
  });

  test("a swap refuses a replacement busy in the same batch, unless overridden", async () => {
    db.setData("judges/j4/teamAssignments/t9", { id: "t9", batch: 1, room: "Olsson 005", time: "5:00 PM", teamName: "Other" });
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j4" })).resolves.toEqual({
      ok: false,
      conflict: expect.objectContaining({ id: "t9" }),
      error: "The replacement is already in Olsson 005 at 5:00 PM for Other.",
    });
    expect(db.getData("teams/t1/schedule/judges")).toEqual([{ judgeId: "j1", judgeName: "Ada Byron" }]);
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j4", allowConflict: true })).resolves.toMatchObject({
      ok: true,
    });
  });

  test("a swap to an unregistered judge is refused", async () => {
    await expect(swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "ghost" })).rejects.toThrow(
      "That judge is not registered."
    );
  });

  test.each([
    ["adding", () => assignJudgeToTeam({ judgeUid: "j4", teamId: "t1" })],
    ["removing", () => unassignJudgeFromTeam({ judgeUid: "j1", teamId: "t1" })],
    ["swapping", () => swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j4" })],
  ])("only an admin can do the %s", async (_label, edit) => {
    db.setData("admins", null);
    await expect(edit()).rejects.toThrow("Only an admin can change judging assignments");
  });
});

describe("repairing copies on a repeated edit", () => {
  test.each([
    ["teamName", "Old name"],
    ["id", "t-old"],
    ["room", "Rice 999"],
    ["time", "9:00 PM"],
    ["batch", 7],
  ])("a copy with a stale %s is rewritten and reported", async (field, stale) => {
    db.setData(`judges/j1/teamAssignments/t1/${field}`, stale);
    await expect(assignJudgeToTeam({ judgeUid: "j1", teamId: "t1" })).resolves.toMatchObject({
      ok: true,
      unchanged: true,
      repaired: true,
    });
    expect(db.getData(`judges/j1/teamAssignments/t1/${field}`)).toBe(schedule()[field]);
  });

  test("a copy that agrees is left alone and reported as not repaired", async () => {
    await expect(assignJudgeToTeam({ judgeUid: "j1", teamId: "t1" })).resolves.toEqual({
      ok: true,
      unchanged: true,
      repaired: false,
      roster: [{ judgeId: "j1", judgeName: "Ada Byron" }],
    });
    expect(db.writes).toEqual([]);
  });

  test("a judge on the roster with no copy at all gets one", async () => {
    db.setData("judges/j1/teamAssignments", null);
    await expect(unassignJudgeFromTeam({ judgeUid: "j4", teamId: "t1" })).resolves.toMatchObject({ unchanged: true, repaired: true });
    expect(db.getData("judges/j1/teamAssignments/t1")).toEqual(schedule());
  });
});

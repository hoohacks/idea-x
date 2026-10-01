/**
 * Every refusal and log line a hand edit to the final-round plan can produce,
 * word for word, and the slot boundaries. applyFinalEdit.test.js covers the
 * behaviours and the random-walk invariants; this pins the text an organizer
 * reads in the planner and the feed, and the undo of each kind of edit.
 */
import { applyFinalEdit, undoFinalEdit } from "./applyFinalEdit";

const ada = { judgeId: "j1", judgeName: "Ada" };
const grace = { judgeId: "j2", judgeName: "Grace" };
const old = { judgeId: "jx", judgeName: "Old" };

const plan = () => ({
  room: "Rice 011",
  ranked: [
    { teamId: "t1", name: "Lantern" },
    { teamId: "t2", name: "Circles" },
    { teamId: "t3", name: "Tempo" },
    { teamId: "t4", name: "Draft" },
  ],
  pool: [ada, grace],
  assignments: {
    t1: { teamId: "t1", teamName: "Lantern", order: 0, judges: [ada] },
    t2: { teamId: "t2", teamName: "Circles", order: 1, judges: [ada, grace] },
    t3: { teamId: "t3", teamName: "Tempo", order: 2, judges: [old] },
  },
  edits: [],
});

const order = (p) => Object.fromEntries(Object.values(p.assignments).map((a) => [a.teamId, a.order]));
const summary = (result) => result.plan.edits[result.plan.edits.length - 1].summary;

describe("refusals name the team", () => {
  test.each([
    [{ type: "addJudge", teamId: "t4", judgeId: "j1" }, "Draft is not in the final round."],
    [{ type: "addJudge", teamId: "t9", judgeId: "j1" }, "that team is not in the final round."],
    [{ type: "removeJudge", teamId: "t4", judgeId: "j1" }, "Draft is not in the final round."],
    [{ type: "moveSlot", teamId: "t4", order: 0 }, "Draft is not in the final round."],
    [{ type: "dropTeam", teamId: "t4" }, "Draft is not in the final round."],
    [{ type: "addTeam", teamId: "t1" }, "Lantern is already in the final round."],
    [{ type: "addTeam", teamId: "t9" }, "That team is not in the ranking, so it cannot be a finalist."],
    [{ type: "rename", teamId: "t1" }, 'Unknown edit "rename".'],
  ])("%p", (op, error) => {
    expect(applyFinalEdit(plan(), op)).toEqual({ ok: false, error });
  });
});

describe("judges", () => {
  test("adding one from the pool logs it and leaves the pool alone", () => {
    const result = applyFinalEdit(plan(), { type: "addJudge", teamId: "t1", judgeId: "j2" });
    expect(result.plan.assignments.t1.judges).toEqual([ada, grace]);
    expect(result.plan.pool).toEqual([ada, grace]);
    expect(result.plan.edits).toEqual([
      { op: { type: "addJudge", teamId: "t1", judgeId: "j2" }, summary: "Added Grace to Lantern", before: plan().assignments.t1, orderBefore: ["t1", "t2", "t3"] },
    ]);
  });

  test("adding a named outsider trims their name and adds them to the pool", () => {
    const result = applyFinalEdit(plan(), { type: "addJudge", teamId: "t1", judgeId: "k", judge: { judgeId: "k", judgeName: "  Kat " } });
    expect(result.plan.assignments.t1.judges[1]).toEqual({ judgeId: "k", judgeName: "Kat" });
    expect(result.plan.pool).toEqual([ada, grace, { judgeId: "k", judgeName: "Kat" }]);
    expect(summary(result)).toBe("Added Kat to Lantern");
  });

  test("a plan with no pool yet starts one", () => {
    const p = { ...plan(), pool: undefined };
    const result = applyFinalEdit(p, { type: "addJudge", teamId: "t1", judgeId: "k", judge: { judgeId: "k", judgeName: "Kat" } });
    expect(result.plan.pool).toEqual([{ judgeId: "k", judgeName: "Kat" }]);
  });

  test.each([
    ["nobody named", undefined],
    ["a name for a different id", { judgeId: "other", judgeName: "Kat" }],
    ["a blank name", { judgeId: "k", judgeName: "   " }],
    ["no name at all", { judgeId: "k" }],
  ])("an outsider with %s is refused", (_label, judge) => {
    expect(applyFinalEdit(plan(), { type: "addJudge", teamId: "t1", judgeId: "k", judge })).toEqual({
      ok: false,
      error: "That judge is not a registered judge in this event.",
    });
  });

  test("someone already on the panel is refused by name", () => {
    expect(applyFinalEdit(plan(), { type: "addJudge", teamId: "t1", judgeId: "j1" })).toEqual({ ok: false, error: "Ada is already judging Lantern." });
  });

  test("removing takes off exactly that judge, and names them", () => {
    const result = applyFinalEdit(plan(), { type: "removeJudge", teamId: "t2", judgeId: "j2" });
    expect(result.plan.assignments.t2.judges).toEqual([ada]);
    expect(summary(result)).toBe("Removed Grace from Circles");
  });

  test("removing someone not on the panel is refused", () => {
    expect(applyFinalEdit(plan(), { type: "removeJudge", teamId: "t1", judgeId: "j2" })).toEqual({
      ok: false,
      error: "That judge is not judging Lantern.",
    });
  });

  test("a swap is one log entry, naming a judge outside the pool generically", () => {
    const result = applyFinalEdit(plan(), { type: "swapJudge", teamId: "t3", fromJudgeId: "jx", toJudgeId: "j1" });
    expect(result.plan.assignments.t3.judges).toEqual([ada]);
    expect(result.plan.edits).toEqual([
      {
        op: { type: "swapJudge", teamId: "t3", fromJudgeId: "jx", toJudgeId: "j1" },
        summary: "Swapped a judge for Ada on Tempo",
        before: plan().assignments.t3,
        orderBefore: ["t1", "t2", "t3"],
      },
    ]);
  });

  test("a swap names both when both are in the pool", () => {
    expect(summary(applyFinalEdit(plan(), { type: "swapJudge", teamId: "t1", fromJudgeId: "j1", toJudgeId: "j2" }))).toBe(
      "Swapped Ada for Grace on Lantern"
    );
  });

  test("a swap passes on either half's refusal", () => {
    expect(applyFinalEdit(plan(), { type: "swapJudge", teamId: "t1", fromJudgeId: "j2", toJudgeId: "j1" }).error).toBe(
      "That judge is not judging Lantern."
    );
    expect(applyFinalEdit(plan(), { type: "swapJudge", teamId: "t1", fromJudgeId: "j1", toJudgeId: "zz" }).error).toBe(
      "That judge is not a registered judge in this event."
    );
  });
});

describe("the running order", () => {
  test("a team can go to the first slot or the last", () => {
    const first = applyFinalEdit(plan(), { type: "moveSlot", teamId: "t3", order: 0 });
    expect(order(first.plan)).toEqual({ t1: 1, t2: 2, t3: 0 });
    expect(summary(first)).toBe("Moved Tempo to Slot 1");
    const last = applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: "2" });
    expect(order(last.plan)).toEqual({ t1: 2, t2: 0, t3: 1 });
    expect(summary(last)).toBe("Moved Lantern to Slot 3");
  });

  test.each([
    [-1, "There is no slot 0."],
    [3, "There is no slot 4."],
    [1.5, "There is no slot 2.5."],
    ["x", "There is no slot x."],
    [0, "Lantern is already in Slot 1."],
  ])("moving Lantern to %p is refused", (target, error) => {
    expect(applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: target })).toEqual({ ok: false, error });
  });

  test("dropping a team closes the gap and logs it", () => {
    const result = applyFinalEdit(plan(), { type: "dropTeam", teamId: "t2" });
    expect(order(result.plan)).toEqual({ t1: 0, t3: 1 });
    expect(summary(result)).toBe("Dropped Circles from the final round");
  });

  test("adding a ranked team puts it last with the whole pool on its panel", () => {
    const result = applyFinalEdit(plan(), { type: "addTeam", teamId: "t4" });
    expect(result.plan.assignments.t4).toEqual({ teamId: "t4", teamName: "Draft", order: 3, judges: [ada, grace] });
    expect(summary(result)).toBe("Added Draft to the final round");
    expect(applyFinalEdit({ ...plan(), pool: undefined }, { type: "addTeam", teamId: "t4" }).plan.assignments.t4.judges).toEqual([]);
  });

  test("a plan with no ranking cannot add anyone", () => {
    expect(applyFinalEdit({ ...plan(), ranked: undefined }, { type: "addTeam", teamId: "t4" }).error).toBe(
      "That team is not in the ranking, so it cannot be a finalist."
    );
  });
});

describe("the room", () => {
  test("moves the round, trimmed, remembering the old room", () => {
    const result = applyFinalEdit(plan(), { type: "setRoom", room: "  Olsson 120 " });
    expect(result.plan.room).toBe("Olsson 120");
    expect(result.plan.edits[0]).toMatchObject({ summary: "Moved the final round to Olsson 120", before: { room: "Rice 011" } });
  });

  test.each([
    [undefined, "Give the final round a room."],
    ["  ", "Give the final round a room."],
    [" Rice 011 ", "The final round is already in Rice 011."],
  ])("refuses %p", (room, error) => {
    expect(applyFinalEdit(plan(), { type: "setRoom", room })).toEqual({ ok: false, error });
  });
});

test("a plan with no edit log yet starts one, for a plain edit and for a swap", () => {
  const noLog = { ...plan(), edits: undefined };
  expect(applyFinalEdit(noLog, { type: "setRoom", room: "Olsson 120" }).plan.edits).toHaveLength(1);
  const swapped = applyFinalEdit(noLog, { type: "swapJudge", teamId: "t1", fromJudgeId: "j1", toJudgeId: "j2" }).plan.edits;
  expect(swapped.map((e) => e.summary)).toEqual(["Swapped Ada for Grace on Lantern"]);
});

describe("undo", () => {
  const undoAfter = (op) => undoFinalEdit(applyFinalEdit(plan(), op).plan);

  test("a room change goes back to the old room", () => {
    expect(undoAfter({ type: "setRoom", room: "Elsewhere" }).room).toBe("Rice 011");
  });

  test("a room change logged with no old room leaves the room as it is", () => {
    const p = { ...plan(), room: "Now", edits: [{ op: { type: "setRoom", room: "Now" }, summary: "", before: null }] };
    expect(undoFinalEdit(p).room).toBe("Now");
  });

  test("an added team is removed, and the rest keep their places", () => {
    const undone = undoAfter({ type: "addTeam", teamId: "t4" });
    expect(undone.assignments.t4).toBeUndefined();
    expect(order(undone)).toEqual({ t1: 0, t2: 1, t3: 2 });
    expect(undone.edits).toEqual([]);
  });

  test("a removed judge comes back", () => {
    expect(undoAfter({ type: "removeJudge", teamId: "t2", judgeId: "j1" }).assignments.t2.judges).toEqual([ada, grace]);
  });

  test("a move is walked back", () => {
    expect(order(undoAfter({ type: "moveSlot", teamId: "t3", order: 0 }))).toEqual({ t1: 0, t2: 1, t3: 2 });
  });

  test("an entry with no before-state removes the team it touched", () => {
    const p = { ...plan(), edits: [{ op: { type: "addJudge", teamId: "t2" }, summary: "", before: null, orderBefore: ["t1", "gone", "t3"] }] };
    const undone = undoFinalEdit(p);
    expect(undone.assignments.t2).toBeUndefined();
    expect(order(undone)).toEqual({ t1: 0, t3: 1 });
  });

  test("an entry with no recorded order keeps the current one", () => {
    const p = { ...plan(), edits: [{ op: { type: "removeJudge", teamId: "t1" }, summary: "", before: plan().assignments.t1 }] };
    expect(order(undoFinalEdit(p))).toEqual({ t1: 0, t2: 1, t3: 2 });
  });

  test("nothing to undo, or no log at all, is null", () => {
    expect(undoFinalEdit(plan())).toBeNull();
    expect(undoFinalEdit({ ...plan(), edits: undefined })).toBeNull();
  });
});

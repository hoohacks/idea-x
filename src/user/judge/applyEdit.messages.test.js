/**
 * Every refusal and log line a hand edit to the schedule draft can produce,
 * word for word, and the batch boundaries of the clash checks. applyEdit.test.js
 * covers the behaviours and the random-walk invariants; this pins the text an
 * organizer reads in the drawer and the feed.
 */
import { applyEdit, undoEdit } from "./applyEdit";

const slot = (id, teamName, batch, room, time, judges) => ({ id, teamName, batch, room, time, judges });
const j = (judgeId, judgeName) => ({ judgeId, judgeName });

const plan = () => ({
  assignments: {
    t1: slot("t1", "Lantern", 1, "R1", "5:00 PM", [j("a", "Ada"), j("b", "Bo")]),
    t2: slot("t2", "Circles", 1, "R2", "5:00 PM", [j("c", "Cy")]),
    t3: slot("t3", "Tempo", 2, "R1", "5:15 PM", [j("d", "Dee"), j("c", "Cy")]),
  },
  teamNames: { t1: "Lantern", t2: "Circles", t3: "Tempo", t4: "Late" },
  judgeNames: { a: "Ada", b: "Bo", c: "Cy", d: "Dee", e: "Eve" },
  basis: { rooms: ["R1", "R2", "R3"], batchTimes: { 1: "5:00 PM", 2: "5:15 PM" } },
  edits: [],
});

const lastEdit = (result) => result.plan.edits[result.plan.edits.length - 1];

describe("adding a judge", () => {
  test("logs who was added to which team, with the team as it was", () => {
    const op = { type: "addJudge", teamId: "t1", judgeUid: "e" };
    const result = applyEdit(plan(), op);
    expect(result.plan.assignments.t1.judges).toEqual([j("a", "Ada"), j("b", "Bo"), j("e", "Eve")]);
    expect(result.plan.edits).toEqual([{ op, summary: "Added Eve to Lantern", before: plan().assignments.t1 }]);
  });

  test("someone with no recorded name is added as unnamed", () => {
    const result = applyEdit(plan(), { type: "addJudge", teamId: "t1", judgeUid: "zz" });
    expect(result.plan.assignments.t1.judges[2]).toEqual(j("zz", "Unnamed Judge"));
  });

  test("a judge busy in another batch is free for this one", () => {
    expect(applyEdit(plan(), { type: "addJudge", teamId: "t1", judgeUid: "d" }).ok).toBe(true);
  });

  test.each([
    [{ teamId: "t4", judgeUid: "e" }, "That team has no slot yet. Place it first."],
    [{ teamId: "t1", judgeUid: "a" }, "Ada is already assigned to Lantern."],
  ])("refuses %p", (op, error) => {
    expect(applyEdit(plan(), { type: "addJudge", ...op })).toEqual({ ok: false, error });
  });

  test("refuses a judge already in a room that batch, naming where, and hands back the clash", () => {
    expect(applyEdit(plan(), { type: "addJudge", teamId: "t1", judgeUid: "c" })).toEqual({
      ok: false,
      error: "Cy is already in R2 at 5:00 PM for Circles in batch 1.",
      conflict: plan().assignments.t2,
    });
  });
});

describe("removing a judge", () => {
  test("removes them and logs it", () => {
    const result = applyEdit(plan(), { type: "removeJudge", teamId: "t1", judgeUid: "b" });
    expect(result.plan.assignments.t1.judges).toEqual([j("a", "Ada")]);
    expect(lastEdit(result).summary).toBe("Removed Bo from Lantern");
  });

  test.each([
    [{ teamId: "t4", judgeUid: "a" }, "That team has no slot yet."],
    [{ teamId: "t1", judgeUid: "c" }, "That judge is not assigned to this team."],
    [
      { teamId: "t2", judgeUid: "c" },
      "That is the only judge assigned to this team. Assign a replacement first, or the team presents to an empty room.",
    ],
  ])("refuses %p", (op, error) => {
    expect(applyEdit(plan(), { type: "removeJudge", ...op })).toEqual({ ok: false, error });
  });
});

describe("swapping a judge", () => {
  test("puts the replacement in the outgoing judge's place on the list, and logs both names", () => {
    const result = applyEdit(plan(), { type: "swapJudge", teamId: "t1", fromUid: "a", toUid: "e" });
    expect(result.plan.assignments.t1.judges).toEqual([j("b", "Bo"), j("e", "Eve")]);
    expect(lastEdit(result).summary).toBe("Swapped Ada for Eve on Lantern");
  });

  test("a replacement with no recorded name goes in as unnamed", () => {
    const result = applyEdit(plan(), { type: "swapJudge", teamId: "t1", fromUid: "a", toUid: "zz" });
    expect(result.plan.assignments.t1.judges).toEqual([j("b", "Bo"), j("zz", "Unnamed Judge")]);
  });

  test.each([
    [{ teamId: "t4", fromUid: "a", toUid: "e" }, "That team has no slot yet."],
    [{ teamId: "t1", fromUid: "c", toUid: "e" }, "That judge is not assigned to this team."],
    [{ teamId: "t1", fromUid: "a", toUid: "b" }, "The replacement is already assigned to this team."],
  ])("refuses %p", (op, error) => {
    expect(applyEdit(plan(), { type: "swapJudge", ...op })).toEqual({ ok: false, error });
  });

  test("refuses a replacement busy that batch, naming where", () => {
    expect(applyEdit(plan(), { type: "swapJudge", teamId: "t1", fromUid: "a", toUid: "c" })).toEqual({
      ok: false,
      error: "Cy is already in R2 at 5:00 PM for Circles in batch 1.",
      conflict: plan().assignments.t2,
    });
  });
});

describe("moving a team", () => {
  test("moves it with the new batch's time, and logs where", () => {
    const result = applyEdit(plan(), { type: "moveTeam", teamId: "t1", batch: 2, room: "R3" });
    expect(result.plan.assignments.t1).toEqual({ ...plan().assignments.t1, batch: 2, room: "R3", time: "5:15 PM" });
    expect(lastEdit(result).summary).toBe("Moved Lantern to R3, batch 2");
  });

  test("a batch with no configured time is TBD", () => {
    const result = applyEdit(plan(), { type: "moveTeam", teamId: "t1", batch: 3, room: "R3" });
    expect(result.plan.assignments.t1.time).toBe("TBD");
  });

  test("its own judges do not clash with it when it changes room within its batch", () => {
    expect(applyEdit(plan(), { type: "moveTeam", teamId: "t1", batch: 1, room: "R3" }).ok).toBe(true);
  });

  test("its own room is not taken by itself", () => {
    expect(applyEdit(plan(), { type: "moveTeam", teamId: "t1", batch: 1, room: "R1" }).ok).toBe(true);
  });

  test("places a team with no slot, empty-handed, under its recorded name", () => {
    const result = applyEdit(plan(), { type: "moveTeam", teamId: "t4", batch: 1, room: "R3" });
    expect(result.plan.assignments.t4).toEqual({ id: "t4", teamName: "Late", batch: 1, room: "R3", time: "5:00 PM", judges: [] });
    expect(lastEdit(result)).toEqual({ op: { type: "moveTeam", teamId: "t4", batch: 1, room: "R3" }, summary: "Placed Late in R3, batch 1", before: null });
  });

  test("a team known nowhere is called 'that team'", () => {
    const result = applyEdit(plan(), { type: "moveTeam", teamId: "t9", batch: 1, room: "R3" });
    expect(lastEdit(result).summary).toBe("Placed that team in R3, batch 1");
  });

  test("a team's own recorded slot name is used when the name list lacks it", () => {
    const p = plan();
    delete p.teamNames.t1;
    expect(lastEdit(applyEdit(p, { type: "removeJudge", teamId: "t1", judgeUid: "b" })).summary).toBe("Removed Bo from Lantern");
  });

  test.each([
    [{ teamId: "t1", batch: 1, room: "R9" }, "R9 is not a configured room. Add it on the control panel first."],
    [{ teamId: "t1", batch: 1, room: "R2" }, "Circles is already in R2 in batch 1."],
  ])("refuses %p", (op, error) => {
    expect(applyEdit(plan(), { type: "moveTeam", ...op })).toEqual({ ok: false, error });
  });

  test("refuses when one of its judges is busy in the target batch, naming them", () => {
    expect(applyEdit(plan(), { type: "moveTeam", teamId: "t2", batch: 2, room: "R3" })).toEqual({
      ok: false,
      error: "Cy is on this team and already in R1 for Tempo in batch 2. Remove them first, or pick another batch.",
      conflict: plan().assignments.t3,
    });
  });
});

describe("anything else", () => {
  test("an unknown edit is refused by name", () => {
    expect(applyEdit(plan(), { type: "rename", teamId: "t1" })).toEqual({ ok: false, error: "Unknown edit: rename" });
  });

  test("a plan with no edit log starts one", () => {
    const p = plan();
    delete p.edits;
    expect(applyEdit(p, { type: "removeJudge", teamId: "t1", judgeUid: "b" }).plan.edits).toHaveLength(1);
    expect(undoEdit(p)).toEqual({ ok: false, error: "Nothing to undo." });
  });

  test("undo keeps the earlier edits", () => {
    const one = applyEdit(plan(), { type: "removeJudge", teamId: "t1", judgeUid: "b" }).plan;
    const two = applyEdit(one, { type: "addJudge", teamId: "t1", judgeUid: "e" }).plan;
    const undone = undoEdit(two).plan;
    expect(undone.edits).toEqual(one.edits);
    expect(undone.assignments.t1.judges).toEqual([j("a", "Ada")]);
  });
});

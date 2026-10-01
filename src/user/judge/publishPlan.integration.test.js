/**
 * Publishing a schedule plan against an in-memory database, built by the real
 * planner, with the real drift check, restore points, audit log and admin
 * check. publishPlan.test.js covers the same steps against scripted reads; this
 * pins what lands and every message an organizer sees on the way.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../testing/fakeDatabase");
const { planSchedule } = require("./planSchedule");
const { publishPlan } = require("./publishPlan");

const seed = () => ({
  admins: { "admin-1": true },
  config: { judgingRooms: ["R1", "R2"], batchCount: 1 },
  teams: { t1: { name: "Lantern", submitted: true }, t2: { name: "Circles", submitted: true }, t3: { name: "Draft" } },
  judges: {
    j1: { firstName: "Ada", isRound1Judge: true, checkedIn: true },
    j2: { firstName: "Bo", isRound1Judge: true, checkedIn: true },
    j3: { firstName: "Cy", isRound1Judge: true },
    j4: { firstName: "Old", teamAssignments: { gone: { id: "gone" } } },
  },
});

beforeEach(() => {
  db.reset(seed());
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const built = async (options) => (await planSchedule(options)).plan;
const log = () => Object.values(db.getData("adminLog"))[0];

test("writes every slot and judge copy, clears what the plan drops, and records how", async () => {
  const plan = await built();
  db.setData("scheduleDraft", { version: 1 });
  db.setData("teams/t3/schedule", { room: "stale" });
  const result = await publishPlan(plan);
  expect(result).toEqual({ ok: true, error: null, snapshotId: expect.any(String) });

  for (const id of ["t1", "t2"]) expect(db.getData(`teams/${id}/schedule`)).toEqual(plan.assignments[id]);
  expect(db.getData("teams/t3/schedule")).toBeNull();
  expect(db.getData("judges/j4/teamAssignments")).toBeNull();
  const j1 = db.getData("judges/j1/teamAssignments");
  expect(Object.keys(j1).sort()).toEqual(Object.values(plan.assignments).filter((a) => a.judges.some((j) => j.judgeId === "j1")).map((a) => a.id).sort());
  expect(db.getData("scheduleDraft")).toBeNull();
  expect(db.getData("config/scheduleMeta")).toEqual({ generatedAt: expect.any(Number), generatedBy: "admin-1", teams: 2, judges: 3, onlyCheckedIn: false });
  expect(log()).toMatchObject({
    by: "admin-1",
    action: "schedule.publish",
    summary: "Published the judging schedule: 2 teams, 3 judges. Restore point taken first.",
    undoable: false,
  });
});

test("takes a restore point of the schedule first, naming the size of what it replaces", async () => {
  const { snapshotId } = await publishPlan(await built());
  expect(db.getData(`snapshotIndex/${snapshotId}`)).toMatchObject({
    label: "Before publishing the schedule (2 teams, 3 judges)",
    reason: "publishing replaces every assignment in the event",
    paths: ["teams", "judges", "config/scheduleMeta"],
  });
});

test("a checked-in-only plan says so, and lists its hand edits", async () => {
  const plan = await built({ onlyCheckedIn: true });
  plan.edits = [{ summary: "Moved Lantern to R2, batch 1" }, { summary: "Added Bo to Circles" }];
  await publishPlan(plan);
  expect(db.getData("config/scheduleMeta")).toMatchObject({ judges: 2, onlyCheckedIn: true });
  expect(log().summary).toBe(
    "Published the judging schedule: 2 teams, 2 judges, checked-in only. Restore point taken first. Hand edited: Moved Lantern to R2, batch 1; Added Bo to Circles."
  );
});

describe("scores filed against pairings the plan drops", () => {
  test("refuse to publish, naming each card", async () => {
    const plan = await built();
    db.setData("scores/first", { t1: { j3: { problem: 1 } }, t2: { ghost: { problem: 1 } } });
    // one batch of two teams and three judges seats Ada on Lantern, Bo and Cy on Circles
    expect(plan.assignments.t1.judges.map((j) => j.judgeId)).toEqual(["j1"]);
    const result = await publishPlan(plan);
    expect(result).toEqual({
      ok: false,
      stranded: [
        { teamId: "t1", judgeUid: "j3" },
        { teamId: "t2", judgeUid: "ghost" },
      ],
      error:
        "2 score card(s) have already been filed for pairings this plan does not keep: Lantern by Cy, Circles by ghost. " +
        "Publishing would leave them counting toward the standings for judges who are no longer assigned. " +
        "Move a single judge from Judging progress instead, or discard the first round scores and publish again.",
    });
    expect(db.getData("teams/t1/schedule")).toBeNull();
  });

  test("discarding them publishes, clears the first round cards, and includes scores in the restore point", async () => {
    const plan = await built();
    db.setData("scores", { first: { t1: { ghost: { problem: 1 } } }, final: { t1: { j1: { problem: 2 } } } });
    const { ok, snapshotId } = await publishPlan(plan, { discardScores: true });
    expect(ok).toBe(true);
    expect(db.getData("scores")).toEqual({ final: { t1: { j1: { problem: 2 } } } });
    expect(db.getData(`snapshotIndex/${snapshotId}/paths`)).toEqual(["teams", "judges", "config/scheduleMeta", "scores"]);
  });

  test("without discarding, scores that the plan keeps are left alone", async () => {
    const plan = await built();
    const seated = plan.assignments.t1.judges[0].judgeId;
    db.setData(`scores/first/t1/${seated}`, { problem: 7 });
    await expect(publishPlan(plan)).resolves.toMatchObject({ ok: true });
    expect(db.getData(`scores/first/t1/${seated}`)).toEqual({ problem: 7 });
  });
});

describe("refusals", () => {
  test("an empty plan, or a team nobody is judging, naming each team", async () => {
    await expect(publishPlan({ assignments: {} })).resolves.toEqual({
      ok: false,
      error: "This plan has no assignments. There is nothing to publish.",
    });
    await expect(publishPlan({})).resolves.toMatchObject({ ok: false, error: "This plan has no assignments. There is nothing to publish." });
    const plan = await built();
    plan.assignments.t1.judges = [];
    plan.assignments.t2.judges = [];
    await expect(publishPlan(plan)).resolves.toEqual({
      ok: false,
      error: "2 team(s) have no judges assigned (Lantern, Circles). Assign a judge to each before publishing.",
    });
  });

  test("a plan the event has moved under", async () => {
    const plan = await built();
    db.setData("teams/t3/submitted", true);
    const result = await publishPlan(plan);
    expect(result).toEqual({
      ok: false,
      error: "This plan is out of date and cannot be published as is.",
      drift: expect.objectContaining({ blocking: [expect.objectContaining({ kind: "teamAppeared" })] }),
    });
  });

  test("no restore point, no publish", async () => {
    const plan = await built();
    jest.spyOn(db.module, "runTransaction").mockResolvedValue({ committed: false });
    await expect(publishPlan(plan)).resolves.toEqual({
      ok: false,
      error: "Could not create a restore point, so nothing was changed. Could not update the restore point list. Nothing was saved.",
    });
    expect(db.getData("teams/t1/schedule")).toBeNull();
  });

  test("only an admin can publish, and other failures are reported in words", async () => {
    const plan = await built();
    db.setData("admins", null);
    await expect(publishPlan(plan)).resolves.toEqual({ ok: false, error: "Only an admin can publish the judging schedule" });
    expect(console.error).toHaveBeenCalledWith("Error publishing the judging schedule:", expect.any(Error));

    db.setData("admins", { "admin-1": true });
    const realUpdate = db.module.update;
    let calls = 0;
    jest.spyOn(db.module, "update").mockImplementation((ref, values) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("")) : realUpdate(ref, values);
    });
    await expect(publishPlan(plan)).resolves.toEqual({ ok: false, error: "Something went wrong publishing the schedule." });
  });
});

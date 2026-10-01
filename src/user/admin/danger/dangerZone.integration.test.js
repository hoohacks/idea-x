/**
 * The control panel's destructive operations against an in-memory database,
 * with the real audit log, restore points and admin check. dangerZone.test.js
 * covers the same functions against scripted reads; this reads back what
 * landed and pins every summary and refusal an organizer sees.
 */
jest.mock("../../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../../testing/fakeDatabase");
const {
  overrideSlotChanges,
  overrideTeamSlot,
  deleteScore,
  setTeamSubmitted,
  clearSchedule,
  forceIntoFinalRound,
} = require("./dangerZone");
const { decodeChanges } = require("../adminAction");

const slot = (room, batch = 1, time = "5:00 PM") => ({ room, batch, time, judges: [{ judgeId: "j1" }] });

beforeEach(() => {
  db.reset({
    admins: { "admin-1": true },
    teams: {
      t1: { name: "Lantern", submitted: true, schedule: slot("Rice 340") },
      t2: { name: "Circles", schedule: slot("Rice 342") },
      t3: { name: "Tempo", schedule: slot("Olsson 005", 2) },
      t4: { name: "Unscheduled" },
    },
    judges: {
      j1: { firstName: "Ada", teamAssignments: { t1: slot("Rice 340"), t2: slot("Rice 342") } },
      j2: { firstName: "Grace", teamAssignments: { t3: slot("Olsson 005", 2) } },
      j3: { firstName: "Idle" },
    },
    scores: { first: { t1: { j1: { problem: 8, notes: "Good" } } } },
    config: { scheduleMeta: { generatedAt: 1 } },
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const logs = () => Object.values(db.getData("adminLog") ?? {}).map((e) => ({ ...e, changes: e.changes && decodeChanges(e.changes) }));
const lastLog = () => logs()[logs().length - 1];

describe("the slot change builder", () => {
  test("writes both fields, for the team and every judge holding it, carrying the old values", () => {
    const changes = overrideSlotChanges({
      teamId: "t1",
      room: "Rice 999",
      time: "6:00 PM",
      teamData: { schedule: slot("Rice 340") },
      judgesData: { j1: { teamAssignments: { t1: {} } }, j2: { teamAssignments: { t2: {} } }, j3: null },
    });
    expect(changes).toEqual([
      { path: "teams/t1/schedule/room", before: "Rice 340", after: "Rice 999" },
      { path: "teams/t1/schedule/time", before: "5:00 PM", after: "6:00 PM" },
      { path: "judges/j1/teamAssignments/t1/room", before: "Rice 340", after: "Rice 999" },
      { path: "judges/j1/teamAssignments/t1/time", before: "5:00 PM", after: "6:00 PM" },
    ]);
  });

  test("a blank or unchanged field is left out, and nothing changed is nothing", () => {
    const base = { teamId: "t1", teamData: { schedule: slot("Rice 340") }, judgesData: undefined };
    expect(overrideSlotChanges({ ...base, room: "", time: "6:00 PM" })).toEqual([
      { path: "teams/t1/schedule/time", before: "5:00 PM", after: "6:00 PM" },
    ]);
    expect(overrideSlotChanges({ ...base, room: "Rice 340", time: "5:00 PM" })).toEqual([]);
    expect(overrideSlotChanges({ ...base, room: undefined, time: undefined })).toEqual([]);
    expect(overrideSlotChanges({ ...base, teamData: undefined, room: "X" })).toEqual([]);
  });
});

describe("moving a scheduled team", () => {
  test("moves the team and its judges' copies, and logs where to", async () => {
    await expect(overrideTeamSlot({ teamId: "t1", teamName: "Lantern", room: "Thornton", time: "5:05 PM" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1/schedule")).toMatchObject({ room: "Thornton", time: "5:05 PM" });
    expect(db.getData("judges/j1/teamAssignments/t1")).toMatchObject({ room: "Thornton", time: "5:05 PM" });
    expect(lastLog()).toMatchObject({ action: "team.slot", summary: "Moved Lantern to Thornton at 5:05 PM" });
  });

  test("is named by id when no name is given", async () => {
    await overrideTeamSlot({ teamId: "t1", teamName: "", room: "Thornton", time: "5:00 PM" });
    expect(lastLog().summary).toBe("Moved t1 to Thornton at 5:00 PM");
  });

  test("refuses a room another team holds in the same batch, naming it", async () => {
    await expect(overrideTeamSlot({ teamId: "t1", room: "Rice 342", time: "5:00 PM" })).resolves.toEqual({
      ok: false,
      error: "Circles is already in Rice 342 in batch 1.",
    });
    db.setData("teams/t2/name", null);
    await expect(overrideTeamSlot({ teamId: "t1", room: "Rice 342", time: "5:00 PM" })).resolves.toEqual({
      ok: false,
      error: "Another team is already in Rice 342 in batch 1.",
    });
    expect(db.getData("adminLog")).toBeNull();
  });

  test("a room taken only in another batch, or by an unscheduled team, is free", async () => {
    await expect(overrideTeamSlot({ teamId: "t1", room: "Olsson 005", time: "5:00 PM" })).resolves.toMatchObject({ ok: true });
  });

  test("keeping the same room is not checked for a clash", async () => {
    db.setData("teams/t2/schedule/room", "Rice 340");
    await expect(overrideTeamSlot({ teamId: "t1", room: "Rice 340", time: "6:00 PM" })).resolves.toMatchObject({ ok: true });
  });

  test("a team with no batch is not checked for a clash", async () => {
    db.setData("teams/t1/schedule/batch", null);
    await expect(overrideTeamSlot({ teamId: "t1", room: "Rice 342", time: "5:00 PM" })).resolves.toMatchObject({ ok: true });
  });

  test("a missing team, no schedule, or no change is refused", async () => {
    await expect(overrideTeamSlot({ teamId: "gone", room: "R", time: "T" })).resolves.toEqual({ ok: false, error: "That team no longer exists." });
    await expect(overrideTeamSlot({ teamId: "t4", room: "R", time: "T" })).resolves.toEqual({
      ok: false,
      error: "Nothing changed. Generate a schedule first if there is none.",
    });
    await expect(overrideTeamSlot({ teamId: "t1", room: "Rice 340", time: "5:00 PM" })).resolves.toMatchObject({ ok: false });
  });

  test("works when there are no judges at all", async () => {
    db.setData("judges", null);
    await expect(overrideTeamSlot({ teamId: "t1", room: "Thornton", time: "5:00 PM" })).resolves.toMatchObject({ ok: true });
  });
});

describe("deleting a score", () => {
  test("removes it, hands back the card, and logs an undoable change naming both", async () => {
    const result = await deleteScore({ round: "first", teamId: "t1", judgeUid: "j1", teamName: "Lantern", judgeName: "Ada" });
    expect(result).toEqual({ ok: true, entryId: expect.any(String), card: { problem: 8, notes: "Good" } });
    expect(db.getData("scores")).toBeNull();
    expect(lastLog()).toMatchObject({
      action: "score.delete",
      summary: "Deleted the first round card for Lantern from Ada",
      undoable: true,
      changes: [{ path: "scores/first/t1/j1", before: { problem: 8, notes: "Good" }, after: null }],
    });
  });

  test("names by id when names are missing, and works for the final round", async () => {
    db.setData("scores/final/t3/j2", { problem: 5 });
    await deleteScore({ round: "final", teamId: "t3", judgeUid: "j2" });
    expect(lastLog().summary).toBe("Deleted the final round card for t3 from j2");
  });

  test("refuses an unknown round or a card that is gone", async () => {
    await expect(deleteScore({ round: "semi", teamId: "t1", judgeUid: "j1" })).resolves.toEqual({ ok: false, error: 'Unknown round "semi".' });
    await expect(deleteScore({ round: "first", teamId: "t1", judgeUid: "j9" })).resolves.toEqual({ ok: false, error: "That score is no longer there." });
  });
});

describe("marking a team submitted or not", () => {
  test("un-marks a submitted team", async () => {
    await expect(setTeamSubmitted({ teamId: "t1", teamName: "Lantern", submitted: false })).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1/submitted")).toBe(false);
    expect(lastLog()).toMatchObject({
      action: "team.submitted",
      summary: "Un-marked Lantern as submitted",
      changes: [{ path: "teams/t1/submitted", before: true, after: false }],
    });
  });

  test("marks a team that never had the flag, by id when unnamed", async () => {
    await setTeamSubmitted({ teamId: "t2", submitted: 1 });
    expect(db.getData("teams/t2/submitted")).toBe(true);
    expect(lastLog()).toMatchObject({ summary: "Marked t2 as submitted", changes: [{ path: "teams/t2/submitted", before: false, after: true }] });
  });

  test("refuses to set what is already set", async () => {
    await expect(setTeamSubmitted({ teamId: "t1", submitted: true })).resolves.toEqual({ ok: false, error: "That team is already submitted." });
    await expect(setTeamSubmitted({ teamId: "t2", submitted: false })).resolves.toEqual({ ok: false, error: "That team is already not submitted." });
  });
});

describe("clearing the schedule", () => {
  test("clears every team's slot, every judge's list and the schedule meta, keeping scores", async () => {
    const result = await clearSchedule();
    expect(result).toEqual({ ok: true, entryId: expect.any(String), snapshotId: expect.any(String) });
    for (const id of ["t1", "t2", "t3"]) expect(db.getData(`teams/${id}/schedule`)).toBeNull();
    expect(db.getData("judges/j1")).toEqual({ firstName: "Ada" });
    expect(db.getData("config/scheduleMeta")).toBeNull();
    expect(db.getData("scores/first/t1/j1")).toEqual({ problem: 8, notes: "Good" });
    expect(lastLog()).toMatchObject({ action: "schedule.clear", summary: "Cleared the schedule: 5 assignment records" });
  });

  test("takes a restore point of the schedule first", async () => {
    const { snapshotId } = await clearSchedule();
    expect(db.getData(`snapshotIndex/${snapshotId}`)).toMatchObject({
      label: "Cleared the schedule: 5 assignment records",
      reason: "clearing the schedule replaces every assignment in the event",
      paths: ["teams", "judges", "config/scheduleMeta"],
    });
  });

  test("with scores, clears those too and the legacy copies on teams, and says so", async () => {
    db.setData("teams/t2/scores", { j1: { problem: 1 } });
    db.setData("teams/t2/finalScores", { j1: { problem: 2 } });
    const { snapshotId } = await clearSchedule({ includeScores: true });
    expect(db.getData("scores")).toBeNull();
    expect(db.getData("teams/t2")).toEqual({ name: "Circles" });
    expect(lastLog().summary).toBe("Cleared the schedule and every score: 5 assignment records, 3 score locations");
    expect(db.getData(`snapshotIndex/${snapshotId}`)).toMatchObject({
      reason: "clearing every score cannot be undone from the activity feed",
      paths: ["teams", "judges", "scores", "config/scheduleMeta"],
    });
  });

  test("scores with no schedule are still cleared, and the meta is left alone", async () => {
    db.setData("teams", { t1: { name: "A" } });
    db.setData("judges", { j1: { firstName: "Ada" } });
    await clearSchedule({ includeScores: true });
    expect(db.getData("scores")).toBeNull();
    expect(db.getData("config/scheduleMeta")).toEqual({ generatedAt: 1 });
    expect(lastLog().summary).toBe("Cleared the schedule and every score: 0 assignment records, 1 score locations");
  });

  test("with no teams or judges at all it says there is nothing to clear", async () => {
    db.setData("teams", null);
    db.setData("judges", null);
    await expect(clearSchedule()).resolves.toEqual({ ok: false, error: "There is no schedule to clear." });
    db.setData("scores", null);
    await expect(clearSchedule({ includeScores: true })).resolves.toEqual({ ok: false, error: "There is no schedule and no scores to clear." });
  });

  test("a schedule already cleared while the restore point saved changes nothing", async () => {
    const real = db.module.runTransaction;
    jest.spyOn(db.module, "runTransaction").mockImplementationOnce(async (ref, updater, options) => {
      const result = await real(ref, updater, options);
      db.setData("teams", { t1: { name: "A" } });
      db.setData("judges", null);
      return result;
    });
    await expect(clearSchedule()).resolves.toEqual({
      ok: false,
      error: "There was nothing left to clear by the time the restore point finished saving. Nothing was changed.",
    });
    expect(db.getData("adminLog")).toBeNull();
  });

  test("nothing is cleared when the restore point cannot be taken", async () => {
    jest.spyOn(db.module, "runTransaction").mockResolvedValue({ committed: false });
    await expect(clearSchedule()).resolves.toEqual({
      ok: false,
      error: "Could not create a restore point, so nothing was changed. Could not update the restore point list. Nothing was saved.",
    });
    expect(db.getData("teams/t1/schedule")).toEqual(slot("Rice 340"));
  });
});

describe("forcing a team into the final round", () => {
  test("writes the standing, the slot and each chosen judge's assignment, and logs it", async () => {
    await expect(forceIntoFinalRound({ teamId: "t4", teamName: "Unscheduled", room: "Rice 011", timeslot: "Slot 5", judgeUids: ["j1", "j3"] })).resolves.toMatchObject({ ok: true });
    expect(db.getData("finalRound/teams/t4")).toEqual({ teamId: "t4", name: "Unscheduled", addedByHand: true });
    expect(db.getData("teams/t4/finalSlot")).toEqual({ room: "Rice 011", timeslot: "Slot 5" });
    for (const uid of ["j1", "j3"]) {
      expect(db.getData(`judges/${uid}/finalAssignments/t4`)).toEqual({ teamId: "t4", teamName: "Unscheduled", room: "Rice 011", timeslot: "Slot 5" });
    }
    expect(db.getData("judges/j2/finalAssignments")).toBeNull();
    expect(lastLog()).toMatchObject({ action: "finalRound.force", summary: "Put Unscheduled into the final round in Rice 011 at Slot 5" });
  });

  test("an unnamed team with no judges is still placed, and logged by id", async () => {
    await forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 5" });
    expect(db.getData("finalRound/teams/t4")).toEqual({ teamId: "t4", name: "Unnamed team", addedByHand: true });
    expect(lastLog().summary).toBe("Put t4 into the final round in Rice 011 at Slot 5");
    expect(lastLog().changes.map((c) => c.path)).toEqual(["finalRound/teams/t4", "teams/t4/finalSlot"]);
  });

  test("an unnamed team's judge assignment is unnamed too", async () => {
    await forceIntoFinalRound({ teamId: "t4", room: "R", timeslot: "S", judgeUids: ["j1"] });
    expect(db.getData("judges/j1/finalAssignments/t4/teamName")).toBe("Unnamed team");
  });

  test("records what it replaced, so it can be undone", async () => {
    db.setData("teams/t4/finalSlot", { room: "Old", timeslot: "Old slot" });
    await forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 1" });
    expect(lastLog().changes[1]).toEqual({ path: "teams/t4/finalSlot", before: { room: "Old", timeslot: "Old slot" }, after: { room: "Rice 011", timeslot: "Slot 1" } });
  });

  test("refuses without a room and a timeslot", async () => {
    for (const args of [{ room: "", timeslot: "S" }, { room: "R", timeslot: "" }]) {
      await expect(forceIntoFinalRound({ teamId: "t4", ...args })).resolves.toEqual({ ok: false, error: "Give the team a room and a timeslot." });
    }
  });

  test("refuses a seat another finalist holds, naming them or not", async () => {
    db.setData("teams/t1/finalSlot", { room: "Rice 011", timeslot: "Slot 1" });
    await expect(forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 1" })).resolves.toEqual({
      ok: false,
      error: "Lantern is already in Rice 011 at Slot 1.",
    });
    db.setData("teams/t1/name", null);
    await expect(forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 1" })).resolves.toEqual({
      ok: false,
      error: "Another team is already in Rice 011 at Slot 1.",
    });
  });

  test("the same room at another time, or the same time in another room, is free", async () => {
    db.setData("teams/t1/finalSlot", { room: "Rice 011", timeslot: "Slot 1" });
    await expect(forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 2" })).resolves.toMatchObject({ ok: true });
    await expect(forceIntoFinalRound({ teamId: "t3", room: "Rice 012", timeslot: "Slot 1" })).resolves.toMatchObject({ ok: true });
  });

  test("a team re-saved in its own seat is not blocked by a clash that was already there", async () => {
    db.setData("teams/t1/finalSlot", { room: "Rice 011", timeslot: "Slot 1" });
    db.setData("teams/t4/finalSlot", { room: "Rice 011", timeslot: "Slot 1" });
    await expect(forceIntoFinalRound({ teamId: "t4", room: "Rice 011", timeslot: "Slot 1", judgeUids: ["j1"] })).resolves.toMatchObject({ ok: true });
  });

  test("with no teams at all there is nothing to clash with", async () => {
    db.setData("teams", null);
    await expect(forceIntoFinalRound({ teamId: "t9", room: "R", timeslot: "S" })).resolves.toMatchObject({ ok: true });
  });
});

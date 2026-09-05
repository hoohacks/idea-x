/**
 * Break-glass tooling.
 *
 * The one that needs explaining is deleteScore. A score card cannot be put
 * back: enteredBy is pinned to auth.uid by the rules, which is where "a judge
 * cannot file under another judge" lives, so a restore by anyone other than the
 * original author fails validation. Rather than weaken that rule, the delete is
 * marked not-undoable and the card is returned so the caller can re-enter it
 * through the existing paper-score dialog.
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
// only requireAdmin is stubbed; the rest of the module is plain helpers
jest.mock("../../../roles.js", () => ({
  ...jest.requireActual("../../../roles.js"),
  requireAdmin: jest.fn(async () => ({ uid: "admin-1" })),
}));

const {
  overrideSlotChanges,
  overrideTeamSlot,
  deleteScore,
  setTeamSubmitted,
  clearSchedule,
  forceIntoFinalRound,
} = require("./dangerZone");
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

describe("overriding one team's slot", () => {
  const teamData = {
    schedule: { id: "t1", teamName: "Lumen", room: "Rice 110", time: "5:00 PM", batch: 1 },
  };
  const judgesData = {
    j1: { teamAssignments: { t1: { room: "Rice 110", time: "5:00 PM" } } },
    j2: { teamAssignments: { t1: { room: "Rice 110", time: "5:00 PM" } } },
    j3: { teamAssignments: { t2: { room: "Rice 204", time: "5:00 PM" } } },
  };

  test("moves the team copy and every assigned judge's copy", () => {
    const changes = overrideSlotChanges({
      teamId: "t1", room: "Rice 204", time: "5:45 PM", teamData, judgesData,
    });
    const paths = changes.map((c) => c.path);

    expect(paths).toContain("teams/t1/schedule/room");
    expect(paths).toContain("teams/t1/schedule/time");
    expect(paths).toContain("judges/j1/teamAssignments/t1/room");
    expect(paths).toContain("judges/j2/teamAssignments/t1/time");
    expect(paths).not.toContain("judges/j3/teamAssignments/t2/room");
  });

  test("only writes the field that actually changed", () => {
    const changes = overrideSlotChanges({
      teamId: "t1", room: "Rice 110", time: "5:45 PM", teamData, judgesData,
    });
    expect(changes.map((c) => c.path)).not.toContain("teams/t1/schedule/room");
    expect(changes.map((c) => c.path)).toContain("teams/t1/schedule/time");
  });

  test("a team with no schedule yields nothing to change", () => {
    expect(overrideSlotChanges({
      teamId: "t1", room: "A", time: "B", teamData: {}, judgesData,
    })).toEqual([]);
  });
});

describe("deleting a score", () => {
  const card = {
    problem: 8, innovation: 7, impact: 9, viability: 4, pitch_quality: 4,
    fundable: true, judgeUid: "j1", teamId: "t1", enteredBy: "j1", submittedAt: 1,
  };

  test("removes the card and returns it for re-entry", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => card });

    const result = await deleteScore({
      round: "first", teamId: "t1", judgeUid: "j1", teamName: "Lumen", judgeName: "Ada",
    });

    expect(result.ok).toBe(true);
    expect(result.card).toEqual(card);
    expect(mockUpdate.mock.calls[0][1]["scores/first/t1/j1"]).toBeNull();
  });

  test("is undoable, because an admin may write back the original author", async () => {
    // This assertion used to be the opposite. enteredBy was pinned to auth.uid
    // for everyone, so nobody but a card's author could put it back. The pin
    // now exempts admins, so the feed can genuinely reverse a delete instead of
    // offering re-entry under new provenance.
    mockGet.mockResolvedValue({ exists: () => true, val: () => ({ problem: 8, enteredBy: "judge-1" }) });
    await deleteScore({ round: "first", teamId: "t1", judgeUid: "judge-1" });

    expect(mockUpdate.mock.calls.at(-1)[1]["adminLog/entry-1"].undoable).toBe(true);
  });

  test("the whole card is kept in the entry so it can be re-typed", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => card });
    await deleteScore({ round: "first", teamId: "t1", judgeUid: "j1" });

    const logged = mockUpdate.mock.calls[0][1]["adminLog/entry-1"];
    expect(JSON.parse(logged.changes[0].before)).toEqual(card);
  });

  test("a card that is not there is refused", async () => {
    const result = await deleteScore({ round: "first", teamId: "t1", judgeUid: "j1" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("an unknown round is refused", async () => {
    expect((await deleteScore({ round: "middle", teamId: "t1", judgeUid: "j1" })).ok).toBe(false);
  });
});

describe("un-submitting a team", () => {
  test("flips the flag and logs it", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => true });
    const result = await setTeamSubmitted({ teamId: "t1", teamName: "Lumen", submitted: false });

    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["teams/t1/submitted"]).toBe(false);
  });
});

describe("clearing the schedule", () => {
  test("nulls every team schedule and every judge assignment", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "teams") {
        return { exists: () => true, val: () => ({ t1: { schedule: { room: "A" } }, t2: {} }) };
      }
      if (r.path === "judges") {
        return { exists: () => true, val: () => ({ j1: { teamAssignments: { t1: {} } }, j2: {} }) };
      }
      return { exists: () => false, val: () => null };
    });

    const result = await clearSchedule();
    expect(result.ok).toBe(true);

    const payload = mockUpdate.mock.calls.at(-1)[1];
    expect(payload["teams/t1/schedule"]).toBeNull();
    expect(payload["judges/j1/teamAssignments"]).toBeNull();
    expect(payload["config/scheduleMeta"]).toBeNull();
  });

  test("refuses when there is no schedule to clear", async () => {
    const result = await clearSchedule();
    expect(result.ok).toBe(false);
  });
});

describe("clearing scores as well, to start from scratch", () => {
  /**
   * Clearing the schedule leaves scores alone by default -- they are keyed by
   * team and judge, so they survive a regeneration and re-attach. Starting over
   * for real is a separate, louder choice.
   *
   * The part that is easy to miss: cards used to live at teams/{id}/scores as
   * well, on any database old enough to predate the migration. Nothing reads
   * them now, but a reset that only cleared /scores would leave them sitting
   * there -- which is exactly not starting from scratch.
   */
  const world = (extra = {}) => async (r) => {
    const data = {
      teams: {
        t1: { schedule: { room: "A" }, scores: { j1: { problem: 8 } } },
        t2: { finalScores: { j2: { problem: 7 } } },
      },
      judges: { j1: { teamAssignments: { t1: {} } } },
      scores: { first: { t1: { j1: { problem: 8 } } }, final: {} },
      ...extra,
    }[r.path];
    return { exists: () => data !== undefined, val: () => data };
  };

  test("scores are left alone by default", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule();

    const payload = mockUpdate.mock.calls.at(-1)[1];
    expect(payload["scores"]).toBeUndefined();
    expect(payload["teams/t1/scores"]).toBeUndefined();
    expect(payload["teams/t1/schedule"]).toBeNull();
  });

  test("includeScores wipes the whole scores node", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule({ includeScores: true });

    expect(mockUpdate.mock.calls.at(-1)[1]["scores"]).toBeNull();
  });

  test("and the pre-migration copies on the team nodes", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule({ includeScores: true });

    const payload = mockUpdate.mock.calls.at(-1)[1];
    expect(payload["teams/t1/scores"]).toBeNull();
    expect(payload["teams/t2/finalScores"]).toBeNull();
  });

  test("a team with no legacy copy is not given an empty write", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule({ includeScores: true });

    const payload = mockUpdate.mock.calls.at(-1)[1];
    expect("teams/t2/scores" in payload).toBe(false);
    expect("teams/t1/finalScores" in payload).toBe(false);
  });

  test("the schedule and the scores go in one atomic update", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule({ includeScores: true });

    // The restore point is written first, as its own update -- it has to land
    // BEFORE the wipe or it is not a restore point. The wipe itself is still
    // one update, which is the property that matters: it cannot half-apply.
    const payload = mockUpdate.mock.calls.at(-1)[1];
    expect(payload["scores"]).toBeNull();
    expect(payload["teams/t1/schedule"]).toBeNull();
    expect(payload["judges/j1/teamAssignments"]).toBeNull();
  });

  test("a restore point is taken before anything is deleted", async () => {
    mockGet.mockImplementation(world());
    const result = await clearSchedule({ includeScores: true });

    expect(result.ok).toBe(true);
    expect(result.snapshotId).toBeTruthy();

    // first write is the restore point, and it carries the scores it is about
    // to destroy rather than a pointer to them
    const [snapshotPayload] = mockUpdate.mock.calls[0].slice(1);
    const stored = snapshotPayload["snapshots/entry-1"];
    expect(stored.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(["teams", "judges", "scores"])
    );
    expect(JSON.parse(stored.entries.find((e) => e.path === "scores").value))
      .toEqual({ first: { t1: { j1: { problem: 8 } } }, final: {} });
  });

  test("nothing is deleted when the restore point cannot be written", async () => {
    mockGet.mockImplementation(world());
    // the restore point is the first write; fail it and the wipe must not run
    mockUpdate.mockRejectedValueOnce(new Error("network down"));

    const result = await clearSchedule({ includeScores: true });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/restore point/i);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("scores can be cleared even when there is no schedule left", async () => {
    mockGet.mockImplementation(async (r) => {
      const data = {
        teams: { t1: { scores: { j1: { problem: 8 } } } },
        judges: {},
        scores: { first: { t1: { j1: {} } } },
      }[r.path];
      return { exists: () => data !== undefined, val: () => data };
    });

    const result = await clearSchedule({ includeScores: true });
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls.at(-1)[1]["scores"]).toBeNull();
  });

  test("refuses when there is genuinely nothing to clear", async () => {
    mockGet.mockImplementation(async () => ({ exists: () => false, val: () => null }));
    const result = await clearSchedule({ includeScores: true });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("the summary says scores went, so the feed is not misleading", async () => {
    mockGet.mockImplementation(world());
    await clearSchedule({ includeScores: true });
    expect(mockUpdate.mock.calls.at(-1)[1]["adminLog/entry-1"].summary).toMatch(/score/i);
  });
});


/**
 * Two teams cannot present in one room at one time.
 *
 * The planner's moveTeam refuses it and so does scheduleTeamIntoBatch, but the
 * slot override -- reached from a team's record, which is the one an organizer
 * uses once the event is running -- did not. Typing a room another team already
 * had in that batch double-booked the room and reported success.
 */
describe("moving a team that is already scheduled", () => {
  const world = {
    "teams/team-clearing": {
      name: "Clearing",
      schedule: { id: "team-clearing", teamName: "Clearing", room: "Rice 344", time: "5:00 PM", batch: 1 },
    },
    teams: {
      "team-clearing": { name: "Clearing", schedule: { room: "Rice 344", time: "5:00 PM", batch: 1 } },
      "team-rootstock": { name: "Rootstock", schedule: { room: "Rice 342", time: "5:00 PM", batch: 1 } },
      // same room, different batch: not a clash, they never overlap
      "team-almanac": { name: "Almanac", schedule: { room: "Rice 341", time: "5:15 PM", batch: 2 } },
    },
    judges: { j1: { teamAssignments: { "team-clearing": { room: "Rice 344", time: "5:00 PM" } } } },
  };

  beforeEach(() => {
    mockGet.mockImplementation(async (r) => {
      const data = world[r.path];
      return { exists: () => data !== undefined, val: () => data };
    });
  });

  const move = (room, time = "5:00 PM") =>
    overrideTeamSlot({ teamId: "team-clearing", teamName: "Clearing", room, time });

  test("refuses a room another team holds in the same batch", async () => {
    const result = await move("Rice 342");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Rootstock is already in Rice 342 in batch 1/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("allows a room only taken in a different batch", async () => {
    const result = await move("Rice 341");

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  test("allows a free room", async () => {
    expect((await move("Rice 999")).ok).toBe(true);
  });

  /**
   * The check is on the room changing, not on every save. An event that already
   * has a clash somewhere should not have its time edits blocked by it.
   */
  test("editing only the time is not blocked", async () => {
    const result = await move("Rice 344", "5:05 PM");

    expect(result.ok).toBe(true);
    const paths = Object.keys(mockUpdate.mock.calls[0][1]);
    expect(paths).toContain("teams/team-clearing/schedule/time");
    expect(paths).not.toContain("teams/team-clearing/schedule/room");
  });
});

/**
 * Two finalists cannot present in one room at one time, same as the first
 * round -- but forceIntoFinalRound writes teams/{id}/finalSlot straight from
 * TeamEditDrawer's free-text room/timeslot fields with no check against every
 * other finalist's seat. Two teams typed into the same room at the same
 * timeslot both reported success and double-booked the room.
 */
describe("forcing a team into the final round by hand", () => {
  const world = {
    teams: {
      "team-clearing": { name: "Clearing" },
      "team-rootstock": { name: "Rootstock", finalSlot: { room: "Rice 344", timeslot: "Slot 1" } },
      "team-almanac": { name: "Almanac", finalSlot: { room: "Rice 342", timeslot: "Slot 2" } },
    },
  };

  beforeEach(() => {
    mockGet.mockImplementation(async (r) => {
      const value = world[r.path];
      return { exists: () => value !== undefined, val: () => value };
    });
  });

  const force = (teamId, room, timeslot) =>
    forceIntoFinalRound({ teamId, teamName: world.teams[teamId]?.name, room, timeslot });

  test("refuses a room and timeslot another finalist already holds", async () => {
    const result = await force("team-clearing", "Rice 344", "Slot 1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Rootstock is already in Rice 344 at Slot 1/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("allows the same room at a different timeslot", async () => {
    const result = await force("team-clearing", "Rice 344", "Slot 2");
    expect(result.ok).toBe(true);
  });

  test("allows a free room and timeslot", async () => {
    const result = await force("team-clearing", "Rice 999", "Slot 1");
    expect(result.ok).toBe(true);
  });

  /**
   * The check is on the seat actually changing, not on every save. A finalist
   * re-saved with the exact slot it already has -- to add a judge, say -- should
   * not be blocked by a clash that was already there before this call.
   */
  test("a team already sitting in its own slot is not blocked from being touched again", async () => {
    world.teams["team-clearing"] = {
      name: "Clearing",
      finalSlot: { room: "Rice 344", timeslot: "Slot 1" },
    };

    const result = await force("team-clearing", "Rice 344", "Slot 1");
    expect(result.ok).toBe(true);
  });
});

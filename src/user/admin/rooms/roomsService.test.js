/**
 * Rooms.
 *
 * config/judgingRooms and a generated schedule are separate stores: the config
 * feeds the NEXT generation, while a schedule already written holds the room
 * name copied into teams/{id}/schedule and into every assigned judge's own
 * copy. Removing a room therefore has to touch all of them or none.
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

const { roomsInUse, remapChanges, moveCollisions, listRooms, removeRoom } = require("./roomsService");
const { requireAdmin } = require("../../../roles.js");

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation off
 * every jest.fn before each test. Every implementation has to be re-established.
 */
beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockResolvedValue({ exists: () => false, val: () => null });
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

const teamsData = {
  t1: { name: "Lumen", schedule: { id: "t1", teamName: "Lumen", room: "Rice 110", time: "5:00 PM", batch: 1, judges: [{ judgeId: "j1", judgeName: "Ada" }, { judgeId: "j2", judgeName: "Bo" }] } },
  t2: { name: "Northstar", schedule: { id: "t2", teamName: "Northstar", room: "Rice 110", time: "5:15 PM", batch: 2, judges: [{ judgeId: "j1", judgeName: "Ada" }] } },
  t3: { name: "Verdant", schedule: { id: "t3", teamName: "Verdant", room: "Rice 204", time: "5:00 PM", batch: 1, judges: [{ judgeId: "j3", judgeName: "Cy" }] } },
  t4: { name: "Unscheduled" },
};

describe("which rooms a schedule is actually using", () => {
  test("groups scheduled teams by room", () => {
    const inUse = roomsInUse(teamsData);
    expect(inUse["Rice 110"].map((t) => t.teamName)).toEqual(["Lumen", "Northstar"]);
    expect(inUse["Rice 204"]).toHaveLength(1);
  });

  test("a team with no schedule is not counted", () => {
    expect(Object.values(roomsInUse(teamsData)).flat().map((t) => t.teamId)).not.toContain("t4");
  });

  test("carries the time and batch, so the dialog can list them usefully", () => {
    expect(roomsInUse(teamsData)["Rice 110"][0]).toMatchObject({ time: "5:00 PM", batch: 1 });
  });

  test("no schedule at all is an empty map, not a crash", () => {
    expect(roomsInUse(null)).toEqual({});
    expect(roomsInUse({ t1: {} })).toEqual({});
  });
});

describe("remapping every copy of a room", () => {
  /**
   * An assignment is stored twice on purpose -- teams/{id}/schedule and
   * judges/{uid}/teamAssignments/{id} -- so a judge can read their own list
   * without read access to every team. Both copies must move together.
   */
  const judgesData = {
    j1: { teamAssignments: { t1: { ...teamsData.t1.schedule }, t2: { ...teamsData.t2.schedule } } },
    j2: { teamAssignments: { t1: { ...teamsData.t1.schedule } } },
    j3: { teamAssignments: { t3: { ...teamsData.t3.schedule } } },
  };

  test("moves the team copy for every affected team", () => {
    const changes = remapChanges({ from: "Rice 110", to: "Rice 204", teamsData, judgesData });
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c.after]));

    expect(byPath["teams/t1/schedule/room"]).toBe("Rice 204");
    expect(byPath["teams/t2/schedule/room"]).toBe("Rice 204");
    expect(byPath["teams/t3/schedule/room"]).toBeUndefined();
  });

  test("moves every judge's copy too", () => {
    const changes = remapChanges({ from: "Rice 110", to: "Rice 204", teamsData, judgesData });
    const paths = changes.map((c) => c.path);

    expect(paths).toContain("judges/j1/teamAssignments/t1/room");
    expect(paths).toContain("judges/j1/teamAssignments/t2/room");
    expect(paths).toContain("judges/j2/teamAssignments/t1/room");
    expect(paths).not.toContain("judges/j3/teamAssignments/t3/room");
  });

  test("captures the old room as the before-value, so the undo works", () => {
    const changes = remapChanges({ from: "Rice 110", to: "Rice 204", teamsData, judgesData });
    expect(changes.every((c) => c.before === "Rice 110")).toBe(true);
  });

  test("a room nothing is scheduled in produces no changes", () => {
    expect(remapChanges({ from: "Rice 999", to: "Rice 204", teamsData, judgesData })).toEqual([]);
  });

  test("a judge holding a stale assignment for a deleted team is skipped", () => {
    const stale = { j9: { teamAssignments: { gone: { room: "Rice 110" } } } };
    const changes = remapChanges({ from: "Rice 110", to: "Rice 204", teamsData, judgesData: stale });
    expect(changes.map((c) => c.path)).not.toContain("judges/j9/teamAssignments/gone/room");
  });
});

describe("rooms live only in the database", () => {
  /**
   * There used to be a DEFAULT_ROOMS list in schedulePlan.js. A built-in
   * list silently papers over an empty config: an organizer who removed the
   * last room would see twelve of them reappear at the next generation, with
   * nothing to say whether the rooms in use were chosen or shipped.
   */
  test("an unconfigured database has no rooms, not a built-in list", async () => {
    expect(await listRooms()).toEqual([]);
  });

  test("an empty stored list stays empty", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => [] });
    expect(await listRooms()).toEqual([]);
  });

  test("blank entries are dropped without resurrecting a default", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => ["", "  ", null] });
    expect(await listRooms()).toEqual([]);
  });

  test("stored rooms are returned as given", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => ["Rice 110", "Rice 204"] });
    expect(await listRooms()).toEqual(["Rice 110", "Rice 204"]);
  });

  test("removing the last room is allowed, leaving none", async () => {
    mockGet.mockImplementation(async (r) => {
      if (r.path === "config/judgingRooms") {
        return { exists: () => true, val: () => ["Rice 110"] };
      }
      return { exists: () => false, val: () => null };
    });

    const result = await removeRoom("Rice 110");
    expect(result.ok).toBe(true);
    expect(mockUpdate.mock.calls[0][1]["config/judgingRooms"]).toEqual([]);
  });
});

/**
 * A room is used by a first-round batch, by the final round, or by both -- and
 * the final round keeps its own copies on nodes the first round never touches.
 * Missing them left every finalist and every final-round judge pointed at a
 * room name that no longer existed.
 */
describe("remapping a room the final round is also using", () => {
  const teamsData = {
    t1: { schedule: { room: "Rice 110" } },
    t2: { finalSlot: { room: "Rice 110", timeslot: "Slot 1" } },
    t3: { schedule: { room: "Rice 011" }, finalSlot: { room: "Rice 110", timeslot: "Slot 2" } },
  };
  const judgesData = {
    j1: {
      teamAssignments: { t1: { room: "Rice 110" } },
      finalAssignments: { t2: { room: "Rice 110" }, t9: { room: "Rice 011" } },
    },
  };
  const finalRoundTeams = { t2: { room: "Rice 110" }, t3: { room: "Rice 110" } };

  const paths = () =>
    remapChanges({ from: "Rice 110", to: "Rice 204", teamsData, judgesData, finalRoundTeams })
      .map((c) => c.path);

  test("the finalist team slot moves", () => {
    expect(paths()).toContain("teams/t2/finalSlot/room");
    expect(paths()).toContain("teams/t3/finalSlot/room");
  });

  test("the final-round judge card moves", () => {
    expect(paths()).toContain("judges/j1/finalAssignments/t2/room");
  });

  test("the standings move, since they carry the room too", () => {
    expect(paths()).toContain("finalRound/teams/t2/room");
  });

  test("a team scheduled in that room in the first round still moves", () => {
    expect(paths()).toContain("teams/t1/schedule/room");
    expect(paths()).toContain("judges/j1/teamAssignments/t1/room");
  });

  test("a first-round room that is not this one is left alone", () => {
    expect(paths()).not.toContain("teams/t3/schedule/room");
    expect(paths()).not.toContain("judges/j1/finalAssignments/t9/room");
  });

  test("no final round means no final-round writes", () => {
    const only = remapChanges({
      from: "Rice 110", to: "Rice 204",
      teamsData: { t1: { schedule: { room: "Rice 110" } } },
      judgesData: {},
    }).map((c) => c.path);
    expect(only.some((path) => path.includes("final"))).toBe(false);
  });
});


/**
 * Emptying a room asked where its teams should go and then believed the answer.
 *
 * Two rooms both busy in batch 1 merged into one room with two teams in it at
 * five o'clock -- produced by the tool an organizer reaches for when a room
 * falls through, which is exactly when there is no time to notice.
 */
describe("emptying a room into another one", () => {
  const busyBoth = {
    a: { name: "Clearing", schedule: { room: "Rice 344", time: "5:00 PM", batch: 1, teamName: "Clearing" } },
    b: { name: "Rootstock", schedule: { room: "Rice 342", time: "5:00 PM", batch: 1, teamName: "Rootstock" } },
  };

  describe("the pure check", () => {
    test("names the team already sitting in the destination", () => {
      const found = moveCollisions({ from: "Rice 344", to: "Rice 342", teamsData: busyBoth });

      expect(found).toHaveLength(1);
      expect(found[0].team.teamName).toBe("Clearing");
      expect(found[0].blockedBy.teamName).toBe("Rootstock");
    });

    test("a destination busy in a different batch is not a collision", () => {
      const laterBatch = {
        ...busyBoth,
        b: { name: "Rootstock", schedule: { room: "Rice 342", time: "5:15 PM", batch: 2, teamName: "Rootstock" } },
      };

      expect(moveCollisions({ from: "Rice 344", to: "Rice 342", teamsData: laterBatch })).toEqual([]);
    });

    test("an empty destination is never a collision", () => {
      expect(moveCollisions({ from: "Rice 344", to: "Rice 999", teamsData: busyBoth })).toEqual([]);
    });
  });

  describe("removeRoom", () => {
    const world = (teams) => ({
      "config/judgingRooms": ["Rice 344", "Rice 342"],
      teams,
      judges: {},
      "finalRound/teams": {},
    });

    const serve = (data) =>
      mockGet.mockImplementation(async (r) => {
        const value = data[r.path];
        return { exists: () => value !== undefined, val: () => value };
      });

    beforeEach(() => {
      mockUpdate.mockReset();
      mockUpdate.mockResolvedValue(undefined);
      requireAdmin.mockResolvedValue({ uid: "admin-1" });
    });

    test("refuses to move teams into a room that is busy at the same time", async () => {
      serve(world(busyBoth));

      const result = await removeRoom("Rice 344", { moveTo: "Rice 342" });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Rice 342 is not free: Rootstock is already there in batch 1/);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test("moves them when the destination is free at that time", async () => {
      serve(
        world({
          ...busyBoth,
          b: { name: "Rootstock", schedule: { room: "Rice 342", time: "5:15 PM", batch: 2, teamName: "Rootstock" } },
        })
      );

      const result = await removeRoom("Rice 344", { moveTo: "Rice 342" });

      expect(result.ok).toBe(true);
      const paths = Object.keys(mockUpdate.mock.calls[0][1]);
      expect(paths).toContain("teams/a/schedule/room");
    });
  });
});

/**
 * A room used only by the final round -- the final round typically gets a
 * dedicated room of its own -- has nothing in roomsInUse, which looks only at
 * team.schedule. removeRoom used that count for both the "choose where they
 * go" refusal and the decision to run remapChanges at all, so a final-only
 * room used to come off config/judgingRooms with no prompt and no remap: every
 * finalist's teams/{id}/finalSlot/room, finalRound/teams/{id}/room and each
 * judge's finalAssignments/{id}/room kept pointing at a room that no longer
 * existed. Dangling, with no repair path.
 */
describe("emptying a room the final round is using", () => {
  const world = (teams) => ({
    "config/judgingRooms": ["Rice 344", "Rice 342"],
    teams,
    judges: {},
    "finalRound/teams": {},
  });

  const serve = (data) =>
    mockGet.mockImplementation(async (r) => {
      const value = data[r.path];
      return { exists: () => value !== undefined, val: () => value };
    });

  beforeEach(() => {
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(undefined);
    requireAdmin.mockResolvedValue({ uid: "admin-1" });
  });

  test("refuses to silently drop a room only the final round is using", async () => {
    serve(world({ f1: { name: "Finalist", finalSlot: { room: "Rice 344", timeslot: "Slot 1" } } }));

    const result = await removeRoom("Rice 344");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/1 team\(s\) are scheduled in Rice 344/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("moves the finalist's slot when given a destination", async () => {
    serve(world({ f1: { name: "Finalist", finalSlot: { room: "Rice 344", timeslot: "Slot 1" } } }));

    const result = await removeRoom("Rice 344", { moveTo: "Rice 342" });

    expect(result.ok).toBe(true);
    const paths = Object.keys(mockUpdate.mock.calls[0][1]);
    expect(paths).toContain("teams/f1/finalSlot/room");
  });

  test("refuses to move finalists into a room another finalist already holds at that timeslot", async () => {
    serve(
      world({
        f1: { name: "Finalist", finalSlot: { room: "Rice 344", timeslot: "Slot 1" } },
        f2: { name: "Runner-up", finalSlot: { room: "Rice 342", timeslot: "Slot 1" } },
      })
    );

    const result = await removeRoom("Rice 344", { moveTo: "Rice 342" });

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a room used by both rounds counts both, and remaps both", async () => {
    serve(
      world({
        f1: { name: "Finalist", finalSlot: { room: "Rice 344", timeslot: "Slot 1" } },
        a: { name: "Clearing", schedule: { room: "Rice 344", time: "5:00 PM", batch: 1, teamName: "Clearing" } },
      })
    );

    const result = await removeRoom("Rice 344", { moveTo: "Rice 342" });

    expect(result.ok).toBe(true);
    const paths = Object.keys(mockUpdate.mock.calls[0][1]);
    expect(paths).toContain("teams/f1/finalSlot/room");
    expect(paths).toContain("teams/a/schedule/room");
  });
});

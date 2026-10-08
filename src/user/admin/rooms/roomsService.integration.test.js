/**
 * Adding, renaming and removing judging rooms against an in-memory database,
 * with the real audit log and admin check. roomsService.test.js covers the
 * pure remapping in depth; this reads back what each operation wrote and pins
 * every summary and refusal.
 */
vi.mock("../../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../../testing/fakeDatabase")).module);
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = await import("../../../testing/fakeDatabase");
const {
  remapChanges,
  roomsInUse,
  finalRoomsInUse,
  moveCollisions,
  finalMoveCollisions,
  listRooms,
  addRoom,
  renameRoom,
  removeRoom,
} = await import("./roomsService");
const { decodeChanges } = await import("../adminAction");

beforeEach(() => {
  db.reset({
    admins: { "admin-1": true },
    config: { judgingRooms: ["Rice 340", "Rice 342", "Olsson 005", "Spare"] },
    teams: {
      t1: { name: "Lantern", schedule: { room: "Rice 340", batch: 1, time: "5:00 PM", teamName: "Lantern (cached)" } },
      t2: { name: "Circles", schedule: { room: "Rice 340", batch: 2, time: "5:15 PM" } },
      t3: { name: "Tempo", schedule: { room: "Rice 342", batch: 1, time: "5:00 PM" } },
      t4: { name: "Final", finalSlot: { room: "Rice 340", timeslot: "Slot 1" } },
      t5: {},
    },
    judges: {
      j1: { teamAssignments: { t1: { room: "Rice 340" }, t3: { room: "Rice 342" } }, finalAssignments: { t4: { room: "Rice 340" } } },
      j2: { teamAssignments: { t2: { room: "Rice 340" } } },
    },
    finalRound: { teams: { t4: { room: "Rice 340" } } },
  });
});

const lastLog = () => {
  const entries = Object.values(db.getData("adminLog") ?? {});
  const entry = entries[entries.length - 1];
  return { ...entry, changes: decodeChanges(entry.changes) };
};

describe("what is in use", () => {
  test("first-round rooms list each team with its cached name, time and batch", () => {
    expect(roomsInUse(db.getData("teams"))).toEqual({
      "Rice 340": [
        { teamId: "t1", teamName: "Lantern (cached)", time: "5:00 PM", batch: 1 },
        { teamId: "t2", teamName: "Circles", time: "5:15 PM", batch: 2 },
      ],
      "Rice 342": [{ teamId: "t3", teamName: "Tempo", time: "5:00 PM", batch: 1 }],
    });
    expect(roomsInUse({ t: { schedule: { room: "R" } } })).toEqual({ R: [{ teamId: "t", teamName: "Unnamed team", time: undefined, batch: undefined }] });
    expect(roomsInUse({ t: null })).toEqual({});
  });

  test("final-round rooms list each finalist with its timeslot", () => {
    expect(finalRoomsInUse(db.getData("teams"))).toEqual({ "Rice 340": [{ teamId: "t4", teamName: "Final", timeslot: "Slot 1" }] });
    expect(finalRoomsInUse({ a: { finalSlot: { room: "R", timeslot: "S" } }, b: null, c: { finalSlot: {} } })).toEqual({
      R: [{ teamId: "a", teamName: "Unnamed team", timeslot: "S" }],
    });
    expect(finalRoomsInUse(undefined)).toEqual({});
  });

  test("a final-round collision is a finalist already in the destination at the same timeslot", () => {
    const teamsData = {
      a: { name: "A", finalSlot: { room: "X", timeslot: "1" } },
      b: { name: "B", finalSlot: { room: "Y", timeslot: "1" } },
      c: { name: "C", finalSlot: { room: "X", timeslot: "2" } },
    };
    expect(finalMoveCollisions({ from: "X", to: "Y", teamsData })).toEqual([
      { team: { teamId: "a", teamName: "A", timeslot: "1" }, blockedBy: { teamId: "b", teamName: "B", timeslot: "1" } },
    ]);
    expect(finalMoveCollisions({ from: "X", to: "Z", teamsData })).toEqual([]);
    expect(finalMoveCollisions({ from: "Z", to: "X", teamsData })).toEqual([]);
    expect(moveCollisions({ from: "Z", to: "X", teamsData: {} })).toEqual([]);
  });
});

describe("moving out of or into an empty room", () => {
  test("never collides, even with teams that have no batch or timeslot", () => {
    const teamsData = {
      a: { name: "A", schedule: { room: "X" }, finalSlot: { room: "X" } },
    };
    expect(moveCollisions({ from: "Empty", to: "X", teamsData })).toEqual([]);
    expect(moveCollisions({ from: "X", to: "Empty", teamsData })).toEqual([]);
    expect(finalMoveCollisions({ from: "Empty", to: "X", teamsData })).toEqual([]);
    expect(finalMoveCollisions({ from: "X", to: "Empty", teamsData })).toEqual([]);
  });
});

describe("remapping, at the edges", () => {
  test("null team and judge records are skipped", () => {
    expect(
      remapChanges({ from: "X", to: "Y", teamsData: { a: null, b: { schedule: { room: "X" } } }, judgesData: { j: null }, finalRoundTeams: {} })
    ).toEqual([{ path: "teams/b/schedule/room", before: "X", after: "Y" }]);
  });

  test("a finalist with no standing entry, or no standings at all, moves only its slot", () => {
    const teamsData = { f: { finalSlot: { room: "X" } } };
    const slotOnly = [{ path: "teams/f/finalSlot/room", before: "X", after: "Y" }];
    expect(remapChanges({ from: "X", to: "Y", teamsData, judgesData: {}, finalRoundTeams: { other: {} } })).toEqual(slotOnly);
    expect(remapChanges({ from: "X", to: "Y", teamsData, judgesData: {} })).toEqual(slotOnly);
  });
});

describe("listing rooms", () => {
  test("from a list or a keyed set, without blanks", async () => {
    await expect(listRooms()).resolves.toEqual(["Rice 340", "Rice 342", "Olsson 005", "Spare"]);
    db.setData("config/judgingRooms", { a: "A", b: "  ", c: 3, d: "D" });
    await expect(listRooms()).resolves.toEqual(["A", "D"]);
  });
});

describe("adding a room", () => {
  test("appends it, trimmed, and logs it", async () => {
    await expect(addRoom("  Thornton  ")).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/judgingRooms")).toEqual(["Rice 340", "Rice 342", "Olsson 005", "Spare", "Thornton"]);
    expect(lastLog()).toMatchObject({ action: "room.add", summary: "Added Thornton" });
  });

  test("refuses a blank name or one already on the list", async () => {
    await expect(addRoom("  ")).resolves.toEqual({ ok: false, error: "Give the room a name." });
    await expect(addRoom(undefined)).resolves.toEqual({ ok: false, error: "Give the room a name." });
    await expect(addRoom(" Spare ")).resolves.toEqual({ ok: false, error: "Spare is already on the list." });
  });
});

describe("renaming a room", () => {
  test("renames it in place and moves every scheduled copy, counting them", async () => {
    await expect(renameRoom("Rice 340", "  Rice 341 ")).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/judgingRooms")).toEqual(["Rice 341", "Rice 342", "Olsson 005", "Spare"]);
    expect(db.getData("teams/t1/schedule/room")).toBe("Rice 341");
    expect(db.getData("teams/t4/finalSlot/room")).toBe("Rice 341");
    expect(db.getData("judges/j1/teamAssignments/t1/room")).toBe("Rice 341");
    expect(db.getData("judges/j1/teamAssignments/t3/room")).toBe("Rice 342");
    expect(db.getData("judges/j1/finalAssignments/t4/room")).toBe("Rice 341");
    expect(db.getData("finalRound/teams/t4/room")).toBe("Rice 341");
    // two teams, one finalist slot and its standing, three judge copies
    expect(lastLog()).toMatchObject({ action: "room.rename", summary: "Renamed Rice 340 to Rice 341, moving 7 scheduled entries" });
  });

  test("an unused room is just renamed", async () => {
    await renameRoom("Spare", "Reserve");
    expect(lastLog().summary).toBe("Renamed Spare to Reserve");
    expect(lastLog().changes).toHaveLength(1);
  });

  test("refuses a blank name, an unknown room, or a name already taken", async () => {
    await expect(renameRoom("Spare", " ")).resolves.toEqual({ ok: false, error: "Give the room a name." });
    await expect(renameRoom("Spare", undefined)).resolves.toEqual({ ok: false, error: "Give the room a name." });
    await expect(renameRoom("Nowhere", "X")).resolves.toEqual({ ok: false, error: "Nowhere is not on the list." });
    await expect(renameRoom("Spare", "Rice 342")).resolves.toEqual({ ok: false, error: "Rice 342 is already on the list." });
  });

  test("works with no teams, judges or final round at all", async () => {
    db.setData("teams", null);
    db.setData("judges", null);
    db.setData("finalRound", null);
    await expect(renameRoom("Rice 340", "R")).resolves.toMatchObject({ ok: true });
  });
});

describe("removing a room", () => {
  test("an unused room is simply removed", async () => {
    await expect(removeRoom("Spare")).resolves.toMatchObject({ ok: true });
    expect(db.getData("config/judgingRooms")).toEqual(["Rice 340", "Rice 342", "Olsson 005"]);
    expect(lastLog()).toMatchObject({ action: "room.remove", summary: "Removed Spare" });
  });

  test("a room in use asks where its teams should go, listing both rounds", async () => {
    await expect(removeRoom("Rice 340")).resolves.toEqual({
      ok: false,
      inUse: [
        { teamId: "t1", teamName: "Lantern (cached)", time: "5:00 PM", batch: 1 },
        { teamId: "t2", teamName: "Circles", time: "5:15 PM", batch: 2 },
      ],
      finalInUse: [{ teamId: "t4", teamName: "Final", timeslot: "Slot 1" }],
      error: "3 team(s) are scheduled in Rice 340. Choose where they should go.",
    });
  });

  test("moves them all to a free room and says how many", async () => {
    await expect(removeRoom("Rice 340", { moveTo: "Spare" })).resolves.toMatchObject({ ok: true });
    expect(db.getData("teams/t1/schedule/room")).toBe("Spare");
    expect(db.getData("teams/t4/finalSlot/room")).toBe("Spare");
    expect(db.getData("config/judgingRooms")).toEqual(["Rice 342", "Olsson 005", "Spare"]);
    expect(lastLog().summary).toBe("Removed Rice 340, moving 3 team(s) to Spare");
  });

  test("an unused room with a destination given is still just removed", async () => {
    await removeRoom("Olsson 005", { moveTo: "Spare" });
    expect(lastLog().summary).toBe("Removed Olsson 005");
    expect(lastLog().changes).toHaveLength(1);
  });

  test("refuses an unknown room, an unknown destination, or itself", async () => {
    await expect(removeRoom("Nowhere")).resolves.toEqual({ ok: false, error: "Nowhere is not on the list." });
    await expect(removeRoom("Rice 340", { moveTo: "Nowhere" })).resolves.toEqual({ ok: false, error: "Nowhere is not on the list." });
    await expect(removeRoom("Spare", { moveTo: "Nowhere" })).resolves.toEqual({ ok: false, error: "Nowhere is not on the list." });
    await expect(removeRoom("Rice 340", { moveTo: "Rice 340" })).resolves.toEqual({ ok: false, error: "Choose a different room to move them to." });
  });

  test("refuses a destination busy in the same batch, counting further clashes", async () => {
    db.setData("teams/t6", { name: "Also", schedule: { room: "Rice 342", batch: 2 } });
    await expect(removeRoom("Rice 340", { moveTo: "Rice 342" })).resolves.toEqual({
      ok: false,
      collisions: expect.any(Array),
      error: "Rice 342 is not free: Tempo is already there in batch 1, and 1 more would clash. Pick a room that is empty when these teams present.",
    });
  });

  test("one clash is named without a count", async () => {
    await expect(removeRoom("Rice 340", { moveTo: "Rice 342" })).resolves.toMatchObject({
      error: "Rice 342 is not free: Tempo is already there in batch 1. Pick a room that is empty when these teams present.",
    });
  });

  test("refuses a destination a finalist holds at the same timeslot, counting further clashes", async () => {
    db.setData("teams/t7", { name: "Other", finalSlot: { room: "Spare", timeslot: "Slot 1" } });
    await expect(removeRoom("Rice 340", { moveTo: "Spare" })).resolves.toEqual({
      ok: false,
      collisions: [expect.objectContaining({ blockedBy: expect.objectContaining({ teamId: "t7" }) })],
      error: "Spare is not free for the final round: Other is already there at Slot 1. Pick a room that is empty at that time.",
    });
    db.setData("teams/t8", { name: "Second", finalSlot: { room: "Rice 340", timeslot: "Slot 1" } });
    await expect(removeRoom("Rice 340", { moveTo: "Spare" })).resolves.toMatchObject({
      error: "Spare is not free for the final round: Other is already there at Slot 1, and 1 more would clash. Pick a room that is empty at that time.",
    });
  });
});

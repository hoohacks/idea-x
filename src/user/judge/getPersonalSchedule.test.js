/**
 * A judge's own schedule, read live from their judge record.
 *
 * Each subscription must read only the signed-in judge's node, keep up with
 * edits made while the page is open, and stop when unsubscribed.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
const mockCurrentUser = { value: { uid: "j1" } };
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = await import("../../testing/fakeDatabase");
const { subscribeToPersonalSchedule, subscribeToFinalRoundSchedule } = await import("./getPersonalSchedule");

beforeEach(() => {
  mockCurrentUser.value = { uid: "j1" };
  db.reset({
    judges: {
      j1: {
        teamAssignments: {
          t2: { id: "t2", batch: 2, room: "Rice 342" },
          t1: { id: "t1", batch: 1, room: "Rice 340" },
        },
        finalAssignments: {
          t9: { teamId: "t9", timeslot: "16:00", room: "Rice 011" },
        },
      },
      j2: { teamAssignments: { t5: { id: "t5", batch: 1 } } },
    },
  });
});

describe("first round", () => {
  test("gives this judge's teams in batch order, and follows later edits", () => {
    const seen = [];
    const stop = subscribeToPersonalSchedule((teams) => seen.push(teams.map((t) => t.id)));
    expect(seen).toEqual([["t1", "t2"]]);

    db.setData("judges/j1/teamAssignments/t3", { id: "t3", batch: 3 });
    expect(seen[seen.length - 1]).toEqual(["t1", "t2", "t3"]);

    stop();
    db.setData("judges/j1/teamAssignments/t4", { id: "t4", batch: 4 });
    expect(seen[seen.length - 1]).toEqual(["t1", "t2", "t3"]);
  });

  test("a judge with nothing assigned gets an empty list", () => {
    mockCurrentUser.value = { uid: "j3" };
    const onTeams = vi.fn();
    subscribeToPersonalSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([]);
  });

  test("refuses when nobody is signed in", () => {
    mockCurrentUser.value = null;
    expect(() => subscribeToPersonalSchedule(vi.fn())).toThrow("Must be signed in");
  });
});

describe("final round", () => {
  test("names each entry by team and time, from this judge's own record", () => {
    const onTeams = vi.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([
      { teamId: "t9", timeslot: "16:00", room: "Rice 011", id: "t9", time: "16:00" },
    ]);
  });

  test("older entries that already carry id and time keep them", () => {
    db.setData("judges/j1/finalAssignments", { t8: { id: "t8", time: "15:30" } });
    const onTeams = vi.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([{ id: "t8", time: "15:30" }]);
  });

  test("no final assignments means an empty list", () => {
    db.setData("judges/j1/finalAssignments", null);
    const onTeams = vi.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([]);
  });

  test("refuses when nobody is signed in", () => {
    mockCurrentUser.value = null;
    expect(() => subscribeToFinalRoundSchedule(vi.fn())).toThrow("Must be signed in");
  });
});

describe("read errors", () => {
  // patched on the fake itself: the mocked module's namespace is read-only,
  // but it reads through to this object
  const mockFailingOnValue = (fire) => {
    const original = db.module.onValue;
    db.module.onValue = (_ref, _ok, fail) => {
      fire(fail);
      return () => {};
    };
    return () => {
      db.module.onValue = original;
    };
  };

  test.each([
    ["first round", subscribeToPersonalSchedule],
    ["final round", subscribeToFinalRoundSchedule],
  ])("%s passes a denied read to the caller, and tolerates having no handler", (_name, subscribe) => {
    const denied = new Error("PERMISSION_DENIED");
    const restore = mockFailingOnValue((fail) => fail(denied));
    try {
      const onError = vi.fn();
      subscribe(vi.fn(), onError);
      expect(onError).toHaveBeenCalledWith(denied);
      expect(() => subscribe(vi.fn())).not.toThrow();
    } finally {
      restore();
    }
  });
});

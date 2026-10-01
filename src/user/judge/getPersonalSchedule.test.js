/**
 * A judge's own schedule, read live from their judge record.
 *
 * Each subscription must read only the signed-in judge's node, keep up with
 * edits made while the page is open, and stop when unsubscribed.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const mockCurrentUser = { value: { uid: "j1" } };
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = require("../../testing/fakeDatabase");
const { subscribeToPersonalSchedule, subscribeToFinalRoundSchedule } = require("./getPersonalSchedule");

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
    const onTeams = jest.fn();
    subscribeToPersonalSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([]);
  });

  test("refuses when nobody is signed in", () => {
    mockCurrentUser.value = null;
    expect(() => subscribeToPersonalSchedule(jest.fn())).toThrow("Must be signed in");
  });
});

describe("final round", () => {
  test("names each entry by team and time, from this judge's own record", () => {
    const onTeams = jest.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([
      { teamId: "t9", timeslot: "16:00", room: "Rice 011", id: "t9", time: "16:00" },
    ]);
  });

  test("older entries that already carry id and time keep them", () => {
    db.setData("judges/j1/finalAssignments", { t8: { id: "t8", time: "15:30" } });
    const onTeams = jest.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([{ id: "t8", time: "15:30" }]);
  });

  test("no final assignments means an empty list", () => {
    db.setData("judges/j1/finalAssignments", null);
    const onTeams = jest.fn();
    subscribeToFinalRoundSchedule(onTeams);
    expect(onTeams).toHaveBeenLastCalledWith([]);
  });

  test("refuses when nobody is signed in", () => {
    mockCurrentUser.value = null;
    expect(() => subscribeToFinalRoundSchedule(jest.fn())).toThrow("Must be signed in");
  });
});

describe("read errors", () => {
  const mockFailingOnValue = (fire) => {
    const database = require("firebase/database");
    const original = database.onValue;
    database.onValue = (_ref, _ok, fail) => {
      fire(fail);
      return () => {};
    };
    return () => {
      database.onValue = original;
    };
  };

  test.each([
    ["first round", subscribeToPersonalSchedule],
    ["final round", subscribeToFinalRoundSchedule],
  ])("%s passes a denied read to the caller, and tolerates having no handler", (_name, subscribe) => {
    const denied = new Error("PERMISSION_DENIED");
    const restore = mockFailingOnValue((fail) => fail(denied));
    try {
      const onError = jest.fn();
      subscribe(jest.fn(), onError);
      expect(onError).toHaveBeenCalledWith(denied);
      expect(() => subscribe(jest.fn())).not.toThrow();
    } finally {
      restore();
    }
  });
});

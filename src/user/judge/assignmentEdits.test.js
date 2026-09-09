/**
 * Moving one judge, on the day.
 *
 * This is what an organizer reaches for when a judge does not turn up -- the
 * single most likely thing to go wrong -- and it had no tests at all.
 *
 * The invariant that matters is the fan-out. An assignment is stored twice, at
 * `teams/{id}/schedule` and at `judges/{uid}/teamAssignments/{id}`, because a
 * judge cannot read /teams. Each judge's copy carries the whole roster for that
 * team, so changing one judge means rewriting the copy held by every other
 * judge on it. Miss one and that judge's card shows a panel that no longer
 * exists, on a phone, in a corridor, with no way to tell it is stale.
 */
jest.mock("../../firebase", () => ({ database: {} }));
jest.mock("../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));

const mockGet = jest.fn();
const mockUpdate = jest.fn();

/**
 * Holds a `get` open, so two concurrent callers can both read the roster
 * before either of them writes -- mirrors the gate in
 * draftConcurrency.test.js, which exists for exactly the same reason.
 */
const mockGate = { waiting: [], held: 0, hold: 0 };

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  // The live value a transaction re-reads and (if it commits) mutates. Nothing
  // is awaited between reading `mockScheduleValue` and writing it back, which is
  // what the real server guarantees -- an `await` in here would reproduce the
  // very race this mock exists to test for.
  runTransaction: async (reference, callback) => {
    const current = mockScheduleValue;
    const next = callback(current);
    if (next === undefined) {
      return {
        committed: false,
        snapshot: { val: () => current, exists: () => current != null },
      };
    }
    mockScheduleValue = next;
    return { committed: true, snapshot: { val: () => next, exists: () => true } };
  },
}));

const {
  assignJudgeToTeam, unassignJudgeFromTeam, swapJudges, findConflict,
} = require("./assignmentEdits");

const judge = (first) => ({ firstName: first, lastName: "J", isRound1Judge: true });

const schedule = (judges) => ({
  teamName: "Lumen",
  id: "t1",
  room: "Rice 110",
  time: "5:00 PM",
  batch: 1,
  judges,
});

const JUDGES = { j1: judge("Ada"), j2: judge("Alan"), j3: judge("Grace") };

const snap = (value) => ({ exists: () => value !== null && value !== undefined, val: () => value });
const payload = () => mockUpdate.mock.calls.at(-1)[1];

/** The live value `runTransaction` above reads and writes. */
let mockScheduleValue = null;

/** A `get` result, gated so a caller can be held mid-read for a race test. */
function gatedSnap(value) {
  if (mockGate.held < mockGate.hold) {
    mockGate.held += 1;
    return new Promise((resolve) => mockGate.waiting.push(() => resolve(snap(value))));
  }
  return Promise.resolve(snap(value));
}

/** The nodes these functions read, and nothing else. */
function world({
  roster = [{ judgeId: "j1", judgeName: "Ada J" }],
  assignments = {},
  // the /judges node itself, so a test can give a judge the copy of a roster
  // they are supposed to be holding -- or deliberately withhold it
  judges,
} = {}) {
  mockScheduleValue = schedule(roster);

  // By default every judge ON the roster also holds the matching copy, because
  // that is the only state the real database is ever in: publishPlan and these
  // functions write both halves together. A judge on a roster with no copy is
  // the broken state repairFanOut exists to correct, so it has to be asked for
  // deliberately (pass `judges`) rather than being what every fixture happens
  // to describe.
  // a roster reaches here in either shape, since a legacy one is stored as a
  // keyed object rather than an array -- normalised the same way the code does
  const rosterList = Array.isArray(roster) ? roster : Object.values(roster ?? {});
  const consistent = Object.fromEntries(
    Object.entries(JUDGES).map(([uid, person]) => [
      uid,
      rosterList.some((entry) => entry?.judgeId === uid)
        ? { ...person, teamAssignments: { t1: schedule(roster) } }
        : person,
    ])
  );

  mockGet.mockImplementation(({ path }) => {
    if (path === "teams/t1/schedule") return gatedSnap(mockScheduleValue);
    if (path === "judges") return gatedSnap(judges ?? consistent);
    if (path.startsWith("judges/") && path.endsWith("/teamAssignments")) {
      const uid = path.split("/")[1];
      return Promise.resolve(snap(assignments[uid] ?? null));
    }
    return Promise.resolve(snap(null));
  });
}

/** Start both calls, let every gated read land, then release them together. */
async function raceTwo(callA, callB) {
  const runA = callA();
  const runB = callB();
  while (mockGate.waiting.length < mockGate.hold) await Promise.resolve();
  mockGate.waiting.forEach((release) => release());
  return Promise.all([runA, runB]);
}

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  mockGate.waiting = [];
  mockGate.held = 0;
  mockGate.hold = 0;
});

describe("adding a judge", () => {
  test("writes the team roster and every judge's copy of it", async () => {
    world({ roster: [{ judgeId: "j1", judgeName: "Ada J" }] });
    const result = await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    expect(result.ok).toBe(true);
    expect(mockScheduleValue.judges.map((j) => j.judgeId)).toEqual(["j1", "j2"]);
    const p = payload();
    // the judge already on the team must see the new panel too
    expect(p["judges/j1/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual(["j1", "j2"]);
    expect(p["judges/j2/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual(["j1", "j2"]);
  });

  test("the judge copy carries what their card renders", async () => {
    world();
    await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    const copy = payload()["judges/j2/teamAssignments/t1"];
    expect(copy.teamName).toBe("Lumen");
    expect(copy.id).toBe("t1");
    expect(copy.room).toBe("Rice 110");
    expect(copy.time).toBe("5:00 PM");
    expect(copy.batch).toBe(1);
  });

  test("the per-judge fan-out lands in ONE update, so it cannot half-apply", async () => {
    world();
    await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });
    // the roster of record commits via the transaction above; this is the
    // separate, still-atomic-among-itself update for the judges' own copies
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("a judge already on the team is a no-op, not a duplicate", async () => {
    world({ roster: [{ judgeId: "j1", judgeName: "Ada J" }] });
    const result = await assignJudgeToTeam({ judgeUid: "j1", teamId: "t1" });

    expect(result.unchanged).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a judge booked elsewhere in the same batch is refused, and the clash is named", async () => {
    world({
      assignments: {
        j2: { t9: { id: "t9", teamName: "Kestrel", room: "Rice 011", time: "5:00 PM", batch: 1 } },
      },
    });
    const result = await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Rice 011/);
    expect(result.error).toMatch(/Kestrel/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("the clash can be overridden deliberately", async () => {
    world({
      assignments: {
        j2: { t9: { id: "t9", teamName: "Kestrel", room: "Rice 011", time: "5:00 PM", batch: 1 } },
      },
    });
    const result = await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1", allowConflict: true });
    expect(result.ok).toBe(true);
  });

  test("a judge in a different batch is not a clash", async () => {
    world({
      assignments: {
        j2: { t9: { id: "t9", teamName: "Kestrel", room: "Rice 011", time: "5:15 PM", batch: 2 } },
      },
    });
    expect((await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" })).ok).toBe(true);
  });

  test("an unregistered judge is refused rather than written", async () => {
    world();
    await expect(assignJudgeToTeam({ judgeUid: "nobody", teamId: "t1" }))
      .rejects.toThrow(/not registered/);
  });
});

describe("removing a judge", () => {
  const pair = [
    { judgeId: "j1", judgeName: "Ada J" },
    { judgeId: "j2", judgeName: "Alan J" },
  ];

  test("the removed judge loses their copy, and the rest are rewritten", async () => {
    world({ roster: pair });
    await unassignJudgeFromTeam({ judgeUid: "j2", teamId: "t1" });

    const p = payload();
    expect(p["judges/j2/teamAssignments/t1"]).toBeNull();
    expect(p["judges/j1/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual(["j1"]);
    expect(mockScheduleValue.judges.map((j) => j.judgeId)).toEqual(["j1"]);
  });

  test("the last judge cannot be removed, or the team presents to an empty room", async () => {
    world({ roster: [{ judgeId: "j1", judgeName: "Ada J" }] });
    const result = await unassignJudgeFromTeam({ judgeUid: "j1", teamId: "t1" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only judge/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("removing somebody who was never on it changes nothing", async () => {
    world({ roster: pair });
    const result = await unassignJudgeFromTeam({ judgeUid: "j3", teamId: "t1" });

    expect(result.unchanged).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("swapping one judge for another", () => {
  const pair = [
    { judgeId: "j1", judgeName: "Ada J" },
    { judgeId: "j2", judgeName: "Alan J" },
  ];

  test("out and in happen in a single fan-out update", async () => {
    world({ roster: pair });
    await swapJudges({ teamId: "t1", fromJudgeUid: "j2", toJudgeUid: "j3" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockScheduleValue.judges.map((j) => j.judgeId)).toEqual(["j1", "j3"]);
    const p = payload();
    expect(p["judges/j2/teamAssignments/t1"]).toBeNull();
    expect(p["judges/j3/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual(["j1", "j3"]);
    expect(p["judges/j1/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual(["j1", "j3"]);
  });

  test("swapping out somebody not on the team is refused", async () => {
    world({ roster: pair });
    const result = await swapJudges({ teamId: "t1", fromJudgeUid: "j3", toJudgeUid: "j1" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("swapping in somebody already on the team is refused", async () => {
    world({ roster: pair });
    const result = await swapJudges({ teamId: "t1", fromJudgeUid: "j1", toJudgeUid: "j2" });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("a legacy roster stored as an object", () => {
  test("is read, and written back as an array", async () => {
    // early schedules stored judges keyed rather than as a list
    world({ roster: { 0: { judgeId: "j1", judgeName: "Ada J" } } });
    await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    expect(Array.isArray(mockScheduleValue.judges)).toBe(true);
    expect(mockScheduleValue.judges.map((j) => j.judgeId)).toEqual(["j1", "j2"]);
  });
});

/**
 * Two organizers racing the same team's roster.
 *
 * This is the no-show-judge scramble: team t1 has judges [Y, Z]. Organizer A
 * swaps Y for X; organizer B removes Z; both act on the same [Y, Z] they each
 * read a moment earlier. Before the fix, both writes were a plain `update()`
 * with nothing checked in between, so the second one silently threw the first
 * away and BOTH calls came back `{ ok: true }` -- the exact failure this file
 * exists to close.
 */
describe("two organizers racing the same team's judges", () => {
  const Y = "j1";
  const Z = "j2";
  const X = "j3";

  function racingWorld() {
    world({
      roster: [
        { judgeId: Y, judgeName: "Ada J" },
        { judgeId: Z, judgeName: "Alan J" },
      ],
    });
    mockGate.hold = 4; // loadContext's two get()s, times two callers
  }

  test("only one edit survives, and the loser is told to reload rather than told it saved", async () => {
    racingWorld();

    const [swapResult, unassignResult] = await raceTwo(
      () => swapJudges({ teamId: "t1", fromJudgeUid: Y, toJudgeUid: X, allowConflict: true }),
      () => unassignJudgeFromTeam({ judgeUid: Z, teamId: "t1" })
    );

    // exactly one writer commits; the other is refused, not silently overwritten
    expect([swapResult.ok, unassignResult.ok].filter(Boolean)).toHaveLength(1);
    const loser = swapResult.ok ? unassignResult : swapResult;
    expect(loser.ok).toBe(false);
    expect(loser.error).toMatch(/changed|removed/i);

    // and what is actually stored is the winner's roster, not a blend of both
    const storedIds = mockScheduleValue.judges.map((j) => j.judgeId).sort();
    const isSwapOutcome = JSON.stringify(storedIds) === JSON.stringify([X, Z].sort());
    const isUnassignOutcome = JSON.stringify(storedIds) === JSON.stringify([Y].sort());
    expect(isSwapOutcome || isUnassignOutcome).toBe(true);
    expect(swapResult.ok ? isSwapOutcome : isUnassignOutcome).toBe(true);

    // only the winner's fan-out was ever written
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("with no one racing, the same edit still goes through", async () => {
    racingWorld();
    mockGate.hold = 0;

    const result = await unassignJudgeFromTeam({ judgeUid: Z, teamId: "t1" });

    expect(result.ok).toBe(true);
    expect(mockScheduleValue.judges.map((j) => j.judgeId)).toEqual([Y]);
  });
});

describe("finding a clash", () => {
  test("only the same batch counts, and never the team being edited", async () => {
    world({
      assignments: {
        j1: {
          t1: { id: "t1", batch: 1, room: "Rice 110", time: "5:00 PM", teamName: "Lumen" },
          t9: { id: "t9", batch: 2, room: "Rice 011", time: "5:15 PM", teamName: "Kestrel" },
        },
      },
    });

    expect(await findConflict("j1", "t1", 1)).toBeNull();
    expect((await findConflict("j1", "t1", 2)).teamName).toBe("Kestrel");
  });

  test("a judge with nothing booked never clashes", async () => {
    world();
    expect(await findConflict("j3", "t1", 1)).toBeNull();
  });
});

/**
 * The roster of record is committed by a transaction and each judge's copy is
 * written after it, so a failure between the two leaves a judge holding a copy
 * that disagrees with the roster -- or missing one entirely.
 *
 * The organizer's obvious repair is to do the edit again. That used to fix
 * nothing: both of these return `unchanged` the moment the roster already says
 * what was asked for, and returned it without writing anything at all. The
 * judge went on seeing a panel that no longer existed, and no amount of
 * retrying would have corrected it.
 */
describe("repairing a fan-out that never landed", () => {
  const ada = { judgeId: "j1", judgeName: "Ada J" };
  const alan = { judgeId: "j2", judgeName: "Alan J" };

  test("re-adding a judge already on the roster writes the copy they never got", async () => {
    world({
      roster: [ada, alan],
      judges: {
        j1: { ...judge("Ada"), teamAssignments: { t1: schedule([ada, alan]) } },
        // j2 is on the roster but holds no copy: the fan-out died here
        j2: judge("Alan"),
        j3: judge("Grace"),
      },
    });

    const result = await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(payload()["judges/j2/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual([
      "j1",
      "j2",
    ]);
  });

  test("re-removing a judge already off the roster clears the copy they kept", async () => {
    world({
      roster: [ada],
      judges: {
        j1: { ...judge("Ada"), teamAssignments: { t1: schedule([ada]) } },
        // j2 was dropped from the roster but still holds the old panel
        j2: { ...judge("Alan"), teamAssignments: { t1: schedule([ada, alan]) } },
        j3: judge("Grace"),
      },
    });

    const result = await unassignJudgeFromTeam({ judgeUid: "j2", teamId: "t1" });

    expect(result.ok).toBe(true);
    expect(payload()["judges/j2/teamAssignments/t1"]).toBeNull();
  });

  test("a stale copy is repaired even when it is a third judge's", async () => {
    // the edit is about j2, but j1's copy is the one that is wrong
    world({
      roster: [ada, alan],
      judges: {
        j1: { ...judge("Ada"), teamAssignments: { t1: schedule([ada]) } },
        j2: { ...judge("Alan"), teamAssignments: { t1: schedule([ada, alan]) } },
        j3: judge("Grace"),
      },
    });

    await assignJudgeToTeam({ judgeUid: "j2", teamId: "t1" });

    expect(payload()["judges/j1/teamAssignments/t1"].judges.map((j) => j.judgeId)).toEqual([
      "j1",
      "j2",
    ]);
  });

  test("copies that already agree are left alone", async () => {
    // a no-op edit must stay a no-op: this runs whenever an organizer taps a
    // judge who is already on the team, which is often
    world({
      roster: [ada],
      judges: {
        j1: { ...judge("Ada"), teamAssignments: { t1: schedule([ada]) } },
        j2: judge("Alan"),
        j3: judge("Grace"),
      },
    });

    const result = await assignJudgeToTeam({ judgeUid: "j1", teamId: "t1" });

    expect(result.unchanged).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

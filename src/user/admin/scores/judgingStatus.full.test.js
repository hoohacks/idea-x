/**
 * The judging-progress page's whole picture, pinned row for row, for both
 * rounds. judgingStatus.test.js checks each behaviour separately; this checks
 * that every column of every row, the two sort orders and the totals agree at
 * once, which is what an organizer reads at 5:30 to decide who to chase.
 *
 * Scores use only `problem`, so a card of N is worth 4N out of 40.
 */
import { buildProgress, TEAM_OK, TEAM_THIN, TEAM_UNJUDGED } from "./judgingStatus";

const teams = {
  tA: {
    name: "A",
    submitted: true,
    schedule: { room: "R1", time: "5:15 PM", batch: 2, judges: [{ judgeId: "j1" }, { judgeId: "j2", judgeName: "Cached" }] },
    finalSlot: { room: "Rice 011", timeslot: "Slot 1" },
  },
  tB: { name: "B", submitted: true, schedule: { room: "R2", time: "5:00 PM", batch: 1, judges: [{ judgeId: "j1" }] } },
  tC: { submitted: true, schedule: { room: "R3", time: "5:00 PM", batch: 1, judges: [{ judgeId: "j3" }] } },
  tD: { name: "D" },
  tE: { name: "E", submitted: true },
};
const judges = {
  j1: {
    firstName: "Ada",
    email: "ada@x.io",
    isRound1Judge: true,
    checkedIn: true,
    teamAssignments: { tA: { id: "tA", teamName: "A", batch: 2 }, tB: { id: "tB", teamName: "B", batch: 1 } },
    finalAssignments: { tA: { teamId: "tA", teamName: "A" } },
  },
  j2: { lastName: "Lee", teamAssignments: { tA: { teamId: "tA", teamName: "A" } } },
  j3: { firstName: "Cy", isRound1Judge: true, checkedIn: "yes", teamAssignments: { tC: { id: "tC", teamName: "Unnamed Team" } } },
  j4: { firstName: "Dee", finalAssignments: { tGone: { teamId: "tGone", teamName: "Gone" } } },
  j5: { firstName: "Eve", isRound1Judge: true },
};
const firstScores = {
  tA: { j1: { problem: 10, fundable: true }, "zz-unassigned-uid": { problem: 5 } },
  tB: { j1: { problem: 5 } },
};

test("the three team states", () => {
  expect([TEAM_OK, TEAM_THIN, TEAM_UNJUDGED]).toEqual(["ok", "thin", "unjudged"]);
});

describe("the first round", () => {
  const progress = () => buildProgress({ teams, judges, scores: firstScores });

  test("every team row, unjudged first, then thin, each by batch then name", () => {
    expect(progress().teamRows).toEqual([
      {
        teamId: "tE", name: "E", submitted: true, room: null, time: null, batch: null,
        assigned: [], outstanding: [], unassignedScorers: [],
        received: 0, expected: 0, averageScore: null, fundableVotes: 0, status: "unjudged",
      },
      {
        teamId: "tC", name: "Unnamed Team", submitted: true, room: "R3", time: "5:00 PM", batch: 1,
        assigned: [{ judgeId: "j3", judgeName: "Cy" }], outstanding: [{ judgeId: "j3", judgeName: "Cy" }], unassignedScorers: [],
        received: 0, expected: 1, averageScore: null, fundableVotes: 0, status: "unjudged",
      },
      {
        teamId: "tB", name: "B", submitted: true, room: "R2", time: "5:00 PM", batch: 1,
        assigned: [{ judgeId: "j1", judgeName: "Ada" }], outstanding: [], unassignedScorers: [],
        received: 1, expected: 1, averageScore: 20, fundableVotes: 0, status: "thin",
      },
      {
        teamId: "tA", name: "A", submitted: true, room: "R1", time: "5:15 PM", batch: 2,
        assigned: [{ judgeId: "j1", judgeName: "Ada" }, { judgeId: "j2", judgeName: "Lee" }],
        outstanding: [{ judgeId: "j2", judgeName: "Lee" }],
        unassignedScorers: [{ judgeId: "zz-unassigned-uid", judgeName: "zz-unass" }],
        received: 1, expected: 2, averageScore: 30, fundableVotes: 1, status: "thin",
      },
    ]);
  });

  test("every judge row, most work left first, then by name", () => {
    expect(progress().judgeRows).toEqual([
      { judgeId: "j3", name: "Cy", email: null, checkedIn: false, isRound1Judge: true, assignedCount: 1, submittedCount: 0, outstanding: [{ id: "tC", teamName: "Unnamed Team" }] },
      { judgeId: "j2", name: "Lee", email: null, checkedIn: false, isRound1Judge: false, assignedCount: 1, submittedCount: 0, outstanding: [{ teamId: "tA", teamName: "A" }] },
      { judgeId: "j1", name: "Ada", email: "ada@x.io", checkedIn: true, isRound1Judge: true, assignedCount: 2, submittedCount: 2, outstanding: [] },
      { judgeId: "j5", name: "Eve", email: null, checkedIn: false, isRound1Judge: true, assignedCount: 0, submittedCount: 0, outstanding: [] },
    ]);
  });

  test("the totals count only expected cards toward completion", () => {
    expect(progress().totals).toEqual({ teams: 4, unjudged: 2, thin: 2, judges: 4, checkedIn: 1, expected: 4, received: 2, percent: 50 });
  });

  test("with a threshold of one, a team with one card is fine", () => {
    const rows = buildProgress({ teams, judges, scores: firstScores, minJudges: 1 }).teamRows;
    expect(rows.find((r) => r.teamId === "tB").status).toBe("ok");
    expect(rows.find((r) => r.teamId === "tA").status).toBe("ok");
    expect(rows.map((r) => r.teamId)).toEqual(["tE", "tC", "tB", "tA"]);
  });

  test("ok teams sort after thin ones, and the percentage rounds", () => {
    const three = {
      x: { name: "X", submitted: true, schedule: { batch: 1, judges: [{ judgeId: "a" }, { judgeId: "b" }, { judgeId: "c" }] } },
    };
    const { totals, teamRows } = buildProgress({ teams: three, judges: {}, scores: { x: { a: { problem: 1 } } } });
    expect(teamRows[0].status).toBe("thin");
    expect(totals.percent).toBe(33);
    const done = buildProgress({ teams: three, judges: {}, scores: { x: { a: {}, b: {} } } });
    expect(done.teamRows[0].status).toBe("ok");
    expect(done.totals.percent).toBe(67);
  });

  test("teams in the same state and batch sort by name, and a later batch sorts after", () => {
    const same = {
      z: { name: "Zed", submitted: true, schedule: { batch: 1 } },
      a: { name: "Abe", submitted: true, schedule: { batch: 1 } },
      m: { name: "Mid", submitted: true, schedule: { batch: 3 } },
      e: { name: "Early", submitted: true, schedule: { batch: 2 } },
    };
    expect(buildProgress({ teams: same }).teamRows.map((r) => r.name)).toEqual(["Abe", "Zed", "Early", "Mid"]);
  });

  test("judges with equal work left sort by name, whichever order they come in", () => {
    const pair = { b: { firstName: "Bea", isRound1Judge: true }, a: { firstName: "Al", isRound1Judge: true }, c: { firstName: "Cal", isRound1Judge: true } };
    expect(buildProgress({ judges: pair }).judgeRows.map((r) => r.name)).toEqual(["Al", "Bea", "Cal"]);
  });

  test("a scheduled but unsubmitted team is still listed", () => {
    const rows = buildProgress({ teams: { s: { name: "S", schedule: { batch: 1 } } } }).teamRows;
    expect(rows).toEqual([expect.objectContaining({ teamId: "s", submitted: false })]);
  });

  test("a roster judge with no record and no cached name is unnamed", () => {
    const rows = buildProgress({ teams: { s: { name: "S", submitted: true, schedule: { judges: [{ judgeId: "ghost" }] } } } }).teamRows;
    expect(rows[0].assigned).toEqual([{ judgeId: "ghost", judgeName: "Unnamed Judge" }]);
  });

  test("null records anywhere are tolerated", () => {
    const result = buildProgress({ teams: { n: null }, judges: { j: null }, scores: undefined });
    expect(result.teamRows).toEqual([]);
    expect(result.judgeRows).toEqual([]);
  });
});

describe("the final round", () => {
  const progress = () =>
    buildProgress({
      teams,
      judges,
      scores: { tA: { j1: { problem: 8 } } },
      final: true,
      finalRoundTeams: { tA: { name: "A" }, tGone: { name: "Gone" } },
    });

  test("lists the finalists, a deleted one from its standing, with the final slot and panel", () => {
    expect(progress().teamRows).toEqual([
      {
        teamId: "tGone", name: "Gone", submitted: true, room: null, time: null, batch: null,
        assigned: [{ judgeId: "j4", judgeName: "Dee" }], outstanding: [{ judgeId: "j4", judgeName: "Dee" }], unassignedScorers: [],
        received: 0, expected: 1, averageScore: null, fundableVotes: 0, status: "unjudged",
      },
      {
        teamId: "tA", name: "A", submitted: true, room: "Rice 011", time: "Slot 1", batch: null,
        assigned: [{ judgeId: "j1", judgeName: "Ada" }], outstanding: [], unassignedScorers: [],
        received: 1, expected: 1, averageScore: 32, fundableVotes: 0, status: "thin",
      },
    ]);
  });

  test("lists only judges with final assignments, counting those", () => {
    expect(progress().judgeRows.map(({ judgeId, assignedCount, submittedCount }) => ({ judgeId, assignedCount, submittedCount }))).toEqual([
      { judgeId: "j4", assignedCount: 1, submittedCount: 0 },
      { judgeId: "j1", assignedCount: 1, submittedCount: 1 },
    ]);
    expect(progress().totals).toEqual({ teams: 2, unjudged: 1, thin: 1, judges: 2, checkedIn: 1, expected: 2, received: 1, percent: 50 });
  });

  test("a finalist standing with no name, and no standings at all", () => {
    const rows = buildProgress({ final: true, finalRoundTeams: { x: null } }).teamRows;
    expect(rows).toEqual([expect.objectContaining({ teamId: "x", name: "Unnamed Team", submitted: true })]);
    expect(buildProgress({ teams, final: true }).teamRows).toEqual([]);
  });

  test("a finalist judge with no name is unnamed", () => {
    const rows = buildProgress({ judges: { j: { finalAssignments: { x: {} } } }, final: true, finalRoundTeams: { x: { name: "X" } } }).teamRows;
    expect(rows[0].assigned).toEqual([{ judgeId: "j", judgeName: "Unnamed Judge" }]);
  });
});

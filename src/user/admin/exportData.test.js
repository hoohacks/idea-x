/**
 * The exports.
 *
 * These matter more than they look. An export is the only artefact of the event
 * that survives the database being wrong, so the failure mode to guard against
 * is not a crash -- it is a file that opens and quietly says something false.
 * Hence the tests about quoting, about a card from an unassigned judge still
 * appearing, and about Excel's habit of executing a cell that starts with `=`.
 */
jest.mock("../../firebase", () => ({ database: {}, auth: {} }));
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: jest.fn(async () => ({ exists: () => false, val: () => null })),
}));

import {
  csvCell, toCsv, scheduleRows, scoreRows, standingsRows, judgeRows,
} from "./exportData";

const world = {
  teams: {
    t1: {
      name: "Lumen",
      submitted: true,
      members: { c1: true, c2: true },
      schedule: {
        batch: 1, time: "5:00 PM", room: "Rice 110",
        judges: [{ judgeId: "j1", judgeName: "Ada Lovelace" }, { judgeId: "j2", judgeName: "Alan Turing" }],
      },
    },
    t2: {
      name: 'Beta, "The Sequel"',
      submitted: true,
      members: { c3: true },
      schedule: { batch: 2, time: "5:15 PM", room: "Rice 109", judges: [{ judgeId: "j1", judgeName: "Ada Lovelace" }] },
    },
  },
  judges: {
    j1: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", company: "Analytical", isRound1Judge: true, checkedIn: true, teamAssignments: { t1: { id: "t1", teamName: "Lumen", batch: 1 }, t2: { id: "t2", teamName: "Beta", batch: 2 } } },
    j2: { firstName: "Alan", lastName: "Turing", email: "alan@example.com", isRound1Judge: true, checkedIn: false, teamAssignments: { t1: { id: "t1", teamName: "Lumen", batch: 1 } } },
  },
  competitors: {},
  scores: {
    first: {
      t1: {
        j1: { problem: 8, innovation: 8, impact: 8, viability: 4, pitch_quality: 4, fundable: true, notes: "Strong", judgeUid: "j1", teamId: "t1", enteredBy: "j1", source: "judge", submittedAt: 1700000000000 },
        // a card from a judge who is NOT on the roster -- it still counts toward
        // the average, so an export that hid it would be lying
        j9: { problem: 5, innovation: 5, impact: 5, viability: 3, pitch_quality: 3, fundable: false, notes: "=SUM(A1:A9)", judgeUid: "j9", teamId: "t1", enteredBy: "admin1", source: "paper", submittedAt: 1700000001000 },
      },
      t2: {
        j1: { problem: 4, innovation: 4, impact: 4, viability: 2, pitch_quality: 2, fundable: false, judgeUid: "j1", teamId: "t2", enteredBy: "j1", source: "judge", submittedAt: 1700000002000 },
      },
    },
    final: {},
  },
  config: {},
};

describe("csv quoting", () => {
  test("a value with a comma is quoted", () => {
    expect(csvCell("Rice 110, Room B")).toBe('"Rice 110, Room B"');
  });

  test("an embedded quote is doubled", () => {
    expect(csvCell('Beta, "The Sequel"')).toBe('"Beta, ""The Sequel"""');
  });

  test("a newline inside a judge's notes does not break the row", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  test("a formula is defused rather than handed to Excel", () => {
    // judges type notes; a cell starting = + - or @ is executed on open
    expect(csvCell("=SUM(A1:A9)")).toBe("\t=SUM(A1:A9)");
    expect(csvCell("+1")).toBe("\t+1");
    expect(csvCell("-cmd")).toBe("\t-cmd");
    expect(csvCell("@ref")).toBe("\t@ref");
  });

  test("empty and absent values are blank, not the string 'undefined'", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
  });

  test("rows are joined with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });
});

describe("the schedule export", () => {
  const rows = scheduleRows(world);

  test("has a header and one row per team", () => {
    expect(rows[0][0]).toBe("Batch");
    expect(rows).toHaveLength(3);
  });

  test("is ordered by batch, so it can be read as a run of show", () => {
    expect(rows[1][0]).toBe(1);
    expect(rows[2][0]).toBe(2);
  });

  test("names the judges from their own records, not the cached roster", () => {
    expect(rows[1][rows[0].indexOf("Judges")]).toBe("Ada Lovelace; Alan Turing");
  });

  test("carries the team id, so a row can be matched back to the database", () => {
    expect(rows[1][rows[0].indexOf("Team ID")]).toBe("t1");
  });
});

describe("the scores export", () => {
  const rows = scoreRows(world, "first");
  // by header name rather than by position, so adding a column cannot make
  // these tests pass while asserting the wrong thing
  const col = (name) => rows[0].indexOf(name);
  const card = (judgeUid, team) =>
    rows.slice(1).find((r) => r[col("Judge UID")] === judgeUid && r[col("Team")] === team);

  test("has one row per card, including from unassigned judges", () => {
    expect(rows).toHaveLength(4); // header + 3 cards
  });

  test("totals the rubric", () => {
    expect(card("j1", "Lumen")[col("Total")]).toBe(32);
  });

  test("distinguishes a judge's own submission from a paper entry", () => {
    expect(card("j1", "Lumen")[col("Entered by")]).toBe("judge");
    expect(card("j9", "Lumen")[col("Source")]).toBe("paper");
  });

  test("keeps the notes, which is the only place a judge's reasoning exists", () => {
    expect(card("j9", "Lumen")[col("Notes")]).toBe("=SUM(A1:A9)");
  });

  test("records the judge the card belongs to, not just who typed it", () => {
    expect(card("j9", "Lumen")[col("Judge UID")]).toBe("j9");
  });
});

describe("the standings export", () => {
  const rows = standingsRows(world, "first");

  test("ranks by average score", () => {
    expect(rows[1][1]).toBe("Lumen");
    expect(rows[2][1]).toBe('Beta, "The Sequel"');
  });

  test("shows how many judges the average rests on", () => {
    const judges = rows[0].indexOf("Judges");
    expect(rows[1][judges]).toBe(2);
    expect(rows[2][judges]).toBe(1);
  });

  test("leaves out teams nobody scored", () => {
    const withUnscored = standingsRows(
      { ...world, teams: { ...world.teams, t3: { name: "Ghost", submitted: true } } },
      "first"
    );
    expect(withUnscored.map((r) => r[1])).not.toContain("Ghost");
  });

  // A tie on average and fundable votes used to fall back to Object.entries
  // order -- i.e. Firebase push-key order -- which is exactly the coin flip
  // compareForRanking exists to remove. "Alpha" is inserted first and would
  // win a stable sort on the first two keys alone, but "Bravo" has been seen
  // by more judges at the same average, so compareForRanking puts it first.
  // An export that disagreed here would contradict the Results page on the
  // one thing organizers use it to decide.
  test("a tie on average and fundable votes is broken the same way the Results page breaks it", () => {
    const card = { problem: 5, innovation: 5, impact: 5, viability: 2, pitch_quality: 3, fundable: false };
    const tieWorld = {
      teams: {
        tA: { name: "Alpha", submitted: true },
        tB: { name: "Bravo", submitted: true },
      },
      scores: {
        first: {
          tA: { j1: card },
          tB: { j1: card, j2: card },
        },
      },
    };

    const rows = standingsRows(tieWorld, "first");
    expect(rows[1][1]).toBe("Bravo");
    expect(rows[2][1]).toBe("Alpha");
  });
});

describe("the judge export", () => {
  const rows = judgeRows(world, "first");
  const col = (name) => rows[0].indexOf(name);
  const judge = (name) => rows.slice(1).find((r) => r[0] === name);

  test("counts what each judge still owes", () => {
    const ada = judge("Ada Lovelace");
    expect(ada[col("Assigned")]).toBe(2);
    expect(ada[col("Submitted")]).toBe(2);
    expect(ada[col("Outstanding")]).toBe("");
  });

  test("names the teams a judge has not scored yet", () => {
    const alan = judge("Alan Turing");
    expect(alan[col("Submitted")]).toBe(0);
    expect(alan[col("Outstanding")]).toBe("Lumen");
  });

  test("surfaces check-in, because a no-show is the usual reason", () => {
    expect(judge("Alan Turing")[col("Checked in")]).toBe("no");
  });
});

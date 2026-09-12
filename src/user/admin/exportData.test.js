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
  csvCell, toCsv, scheduleRows, scoreRows, standingsRows, judgeRows, competitorRows,
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
  competitors: {
    c1: {
      firstName: "Mary-Jane", lastName: "O'Brien", email: "mj@virginia.edu", teamId: "t1",
      uvaSchool: "engineering", schoolYear: 2027, major: "Systems Engineering",
      gender: "female", dietaryRestriction: "vegan", resume: "https://example.com/mj.pdf",
      checkedIn: true, foodCheckIn: true, eligibilityConfirmed: true,
      registeredAt: 1700000000000,
    },
    // no resume: the form stores the string "none" rather than leaving it out
    c2: {
      firstName: "Ada", lastName: "Byron", email: "ada@virginia.edu", teamId: "t1",
      uvaSchool: "college", schoolYear: 2028, major: "Computer Science",
      gender: "female", dietaryRestriction: "none", resume: "none",
      checkedIn: false, foodCheckIn: false, eligibilityConfirmed: true,
      registeredAt: 1700000001000,
    },
    // registered before the event was UVA-only and before eligibility was asked,
    // never joined a team, and never uploaded anything
    c9: {
      firstName: "Sam", lastName: "Reyes", email: "sam@example.com",
      uvaSchool: "other", schoolYear: 2026, major: "Economics",
      dietaryRestriction: "gluten-free", checkedIn: false, foodCheckIn: false,
    },
  },
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

/**
 * The attendee list.
 *
 * This is the one export somebody stands at a door holding. The failure that
 * matters is not a crash: it is a row that says a person has no dietary
 * restriction when the field was simply never filled in, or that says they did
 * not confirm they were eligible when nobody ever asked them.
 */
describe("the competitor export", () => {
  const rows = competitorRows(world);
  const col = (name) => rows[0].indexOf(name);
  const person = (name) => rows.slice(1).find((r) => r[0] === name);

  test("has a header and one row per competitor", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0][0]).toBe("Name");
  });

  test("is ordered by name, so it can be read down like a door list", () => {
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "Ada Byron",
      "Mary-Jane O'Brien",
      "Sam Reyes",
    ]);
  });

  test("names the team a competitor is on, not just its id", () => {
    expect(person("Mary-Jane O'Brien")[col("Team")]).toBe("Lumen");
    expect(person("Mary-Jane O'Brien")[col("Team ID")]).toBe("t1");
  });

  test("leaves somebody who never joined a team blank, not 'undefined'", () => {
    expect(person("Sam Reyes")[col("Team")]).toBe("");
    expect(person("Sam Reyes")[col("Team ID")]).toBe("");
  });

  test("spells the school out, including one the form no longer offers", () => {
    expect(person("Mary-Jane O'Brien")[col("School")]).toBe(
      "School of Engineering and Applied Science"
    );
    // "other" was "I don't go to UVA"; records written before the rule changed
    // still hold it and still have to read as something
    expect(person("Sam Reyes")[col("School")]).toBe("Not a UVA student");
  });

  test("carries the dietary restriction, which is what catering is counted from", () => {
    expect(person("Mary-Jane O'Brien")[col("Dietary")]).toBe("vegan");
    expect(person("Sam Reyes")[col("Dietary")]).toBe("gluten-free");
  });

  test("reports arriving and being fed as the separate things they are", () => {
    const mj = person("Mary-Jane O'Brien");
    expect(mj[col("Checked in")]).toBe("yes");
    expect(mj[col("Food collected")]).toBe("yes");
    expect(person("Ada Byron")[col("Checked in")]).toBe("no");
  });

  test("gives a resume link only where one was actually uploaded", () => {
    expect(person("Mary-Jane O'Brien")[col("Resume")]).toBe("https://example.com/mj.pdf");
    // the sentinel the form writes when the upload was skipped
    expect(person("Ada Byron")[col("Resume")]).toBe("");
    expect(person("Sam Reyes")[col("Resume")]).toBe("");
  });

  test("does not claim somebody declined a question they were never asked", () => {
    expect(person("Mary-Jane O'Brien")[col("Eligibility confirmed")]).toBe("yes");
    // predates the checkbox: blank, because "no" would be a different claim
    expect(person("Sam Reyes")[col("Eligibility confirmed")]).toBe("");
  });

  test("blanks a gender nobody answered rather than printing undefined", () => {
    expect(person("Sam Reyes")[col("Gender")]).toBe("");
  });
});

/**
 * The records that are not shaped like the happy path. A competitor node can
 * be half-written -- an admin added somebody by hand, or a registration failed
 * between creating the account and saving the profile -- and the door list has
 * to render it rather than printing "undefined" at somebody.
 */
describe("the competitor export on malformed records", () => {
  const odd = {
    teams: {},
    competitors: {
      a: { firstName: "", lastName: "", email: "nobody@virginia.edu" },
      b: { firstName: "Solo", registeredAt: 1700000000000 },
      c: { firstName: "Bad", lastName: "Stamp", registeredAt: "not a number" },
      d: { firstName: "Ghost", lastName: "Team", teamId: "deleted-team" },
    },
  };
  const rows = competitorRows(odd);
  const col = (name) => rows[0].indexOf(name);
  const person = (name) => rows.slice(1).find((r) => r[0] === name);

  test("names a record that has no name at all", () => {
    expect(person("Unnamed")[col("Email")]).toBe("nobody@virginia.edu");
  });

  test("takes a first name on its own rather than demanding both", () => {
    expect(person("Solo")).toBeDefined();
  });

  test("writes the registration time as an ISO stamp", () => {
    expect(person("Solo")[col("Registered at")]).toBe("2023-11-14T22:13:20.000Z");
  });

  test("blanks a registration time that is not a timestamp", () => {
    expect(person("Bad Stamp")[col("Registered at")]).toBe("");
  });

  test("keeps the id of a team that has since been deleted, and blanks its name", () => {
    const ghost = person("Ghost Team");
    expect(ghost[col("Team")]).toBe("");
    expect(ghost[col("Team ID")]).toBe("deleted-team");
  });
});

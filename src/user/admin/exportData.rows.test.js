/**
 * Every export, row for row.
 *
 * exportData.test.js checks the behaviours one cell at a time; this pins the
 * whole file an organizer downloads -- header, column order and every blank --
 * because a column that shifts by one or a blank that prints "undefined" is
 * exactly the quietly-wrong file these exports exist to avoid. It also covers
 * the database read and the browser download.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);

const db = await import("../../testing/fakeDatabase");
const {
  loadEventData,
  scheduleRows,
  scoreRows,
  standingsRows,
  judgeRows,
  competitorRows,
  csvCell,
  toCsv,
  downloadCsv,
  downloadJson,
  stamp,
} = await import("./exportData");

const at = Date.UTC(2026, 9, 25, 21, 5, 0);

const world = {
  teams: {
    tB: {
      name: "Beacon",
      submitted: true,
      members: { c1: true, c2: true },
      schedule: { batch: 2, time: "5:15 PM", room: "Rice 342", judges: { j1: { judgeId: "j1", judgeName: "Old Name" } } },
    },
    tA: {
      name: "Anchor",
      schedule: { batch: 1, time: "5:00 PM", room: "Rice 340", judges: [{ judgeId: "j1" }, { judgeId: "gone", judgeName: "Cached Judge" }] },
    },
    tC: { name: "Compass", schedule: { batch: 2, room: "Olsson 005" } },
    tD: {},
  },
  judges: {
    j1: {
      firstName: "Ada",
      lastName: "Byron",
      email: "ada@x.io",
      company: "Engines",
      isRound1Judge: true,
      checkedIn: true,
      teamAssignments: { tA: { id: "tA", teamName: "Anchor", batch: 1 }, tB: { teamId: "tB", teamName: "Beacon", batch: 2 } },
    },
    j2: { firstName: "Grace", isFinalRoundJudge: true, teamAssignments: { tC: { id: "tC", teamName: "Compass", batch: 1 } } },
    j3: {},
  },
  competitors: {
    c2: { firstName: "Zed", lastName: "Young", email: "z@y.io", teamId: "tB", uvaSchool: "engineering", schoolYear: 2027, major: "CS", gender: "Man", dietaryRestriction: "Vegan", checkedIn: true, foodCheckIn: true, resume: "https://r/z.pdf", eligibilityConfirmed: true, registeredAt: at },
    c1: { firstName: "Amy", teamId: "deleted-team", resume: "none", eligibilityConfirmed: false, registeredAt: "yesterday" },
    c3: { lastName: "Solo", resume: "   ", registeredAt: Number.NaN },
  },
  scores: {
    first: {
      tA: {
        j1: { problem: 8, innovation: 7, impact: 9, viability: 4, pitch_quality: 5, fundable: true, enteredBy: "j1", source: "judge", submittedAt: at, notes: "Strong", room: "Rice 340", time: "5:00 PM" },
        "paper-judge-uid-long": { problem: 5, innovation: 5, impact: "", viability: "x", enteredBy: "admin-9", source: "paper" },
      },
      tB: { j2: { problem: 10, innovation: 10, impact: 10, viability: 5, pitch_quality: 5, fundable: "yes", enteredBy: "j1" } },
      ghost: { j1: { problem: 1, teamName: "Gone Team" } },
    },
    final: { tC: { j2: { problem: 6, innovation: 6, impact: 6, viability: 3, pitch_quality: 3 } } },
  },
};

describe("schedule", () => {
  test("one row per team, by batch then room, unscheduled last", () => {
    expect(scheduleRows(world)).toEqual([
      ["Batch", "Time", "Room", "Team", "Team ID", "Submitted", "Judges", "Members"],
      [1, "5:00 PM", "Rice 340", "Anchor", "tA", "no", "Ada Byron; Cached Judge", 0],
      [2, "", "Olsson 005", "Compass", "tC", "no", "", 0],
      [2, "5:15 PM", "Rice 342", "Beacon", "tB", "yes", "Ada Byron", 2],
      ["", "", "", "Unnamed Team", "tD", "no", "", 0],
    ]);
  });

  test("a team in a later batch comes after an earlier one whatever the rooms", () => {
    const teams = {
      late: { name: "Late", schedule: { batch: 3, room: "A" } },
      early: { name: "Early", schedule: { batch: 1, room: "Z" } },
      none: { name: "None", schedule: { room: "B" } },
      mid: { name: "Mid", schedule: { batch: 2, room: "C" } },
    };
    expect(scheduleRows({ teams, judges: {} }).slice(1).map((row) => row[3])).toEqual(["Early", "Mid", "Late", "None"]);
  });

  test("tolerates a team record that is null, sorting it with the unscheduled", () => {
    const rows = scheduleRows({ teams: { tX: null, tY: { name: "Y", schedule: { batch: 1 } }, tZ: null }, judges: {} });
    expect(rows.slice(1)).toEqual([
      [1, "", "", "Y", "tY", "no", "", 0],
      ["", "", "", "Unnamed Team", "tX", "no", "", 0],
      ["", "", "", "Unnamed Team", "tZ", "no", "", 0],
    ]);
  });

  test("teams with no schedule at all keep their order among themselves", () => {
    const rows = scheduleRows({ teams: { x: { name: "X" }, y: { name: "Y" }, z: { name: "Z" } }, judges: {} });
    expect(rows.slice(1).map((row) => row[3])).toEqual(["X", "Y", "Z"]);
  });

  test("within a batch a team with no room comes before the named rooms", () => {
    const teams = {
      b: { name: "B", schedule: { batch: 1, room: "Rice 340" } },
      a: { name: "A", schedule: { batch: 1 } },
      c: { name: "C", schedule: { batch: 1, room: "Olsson 005" } },
    };
    expect(scheduleRows({ teams, judges: {} }).slice(1).map((row) => row[3])).toEqual(["A", "C", "B"]);
  });

  test("a judge's padded name is trimmed", () => {
    const rows = scheduleRows({
      teams: { t1: { name: "T", schedule: { judges: [{ judgeId: "j1" }] } } },
      judges: { j1: { firstName: " Ada ", lastName: "" } },
    });
    expect(rows[1][6]).toBe("Ada");
  });
});

describe("scores", () => {
  test("one row per card with every column, and blanks where there is nothing", () => {
    expect(scoreRows(world, "first")).toEqual([
      [
        "Round", "Team", "Team ID", "Room", "Time", "Judge", "Judge UID",
        "Problem", "Innovation", "Impact", "Viability", "Pitch quality",
        "Total", "Fundable", "Entered by", "Source", "Submitted at", "Notes",
      ],
      ["first", "Anchor", "tA", "Rice 340", "5:00 PM", "Ada Byron", "j1", 8, 7, 9, 4, 5, 33, "yes", "judge", "judge", "2026-10-25T21:05:00.000Z", "Strong"],
      ["first", "Anchor", "tA", "", "", "paper-ju", "paper-judge-uid-long", 5, 5, "", "x", "", 10, "no", "admin-9", "paper", "", ""],
      ["first", "Beacon", "tB", "", "", "Grace", "j2", 10, 10, 10, 5, 5, 40, "no", "Ada Byron", "", "", ""],
      ["first", "Gone Team", "ghost", "", "", "Ada Byron", "j1", 1, "", "", "", "", 1, "no", "", "", "", ""],
    ]);
  });

  test("defaults to the first round, and reads the final round when asked", () => {
    expect(scoreRows(world)).toEqual(scoreRows(world, "first"));
    expect(scoreRows(world, "final").slice(1)).toEqual([
      ["final", "Compass", "tC", "", "", "Grace", "j2", 6, 6, 6, 3, 3, 24, "no", "", "", "", ""],
    ]);
  });

  test("a card for an unknown team with no cached name, or a null card, still gets a row", () => {
    const rows = scoreRows({ teams: {}, judges: {}, scores: { first: { t9: { j9: null } } } });
    expect(rows[1]).toEqual(["first", "Unknown", "t9", "", "", "j9", "j9", "", "", "", "", "", 0, "no", "", "", "", ""]);
  });

  test("no scores at all is just the header", () => {
    expect(scoreRows({ teams: {}, judges: {}, scores: undefined })).toHaveLength(1);
    expect(scoreRows({ teams: {}, judges: {}, scores: { first: { t1: null } } })).toHaveLength(1);
  });
});

describe("standings", () => {
  test("ranked from one, with the average to two places", () => {
    expect(standingsRows(world, "first")).toEqual([
      ["Rank", "Team", "Team ID", "Average score", "Judges", "Fundable votes", "Submitted"],
      [1, "Beacon", "tB", "40.00", 1, 0, "yes"],
      [2, "Anchor", "tA", "26.50", 2, 1, "no"],
    ]);
  });

  test("defaults to the first round, and ranks the final round when asked", () => {
    expect(standingsRows(world)).toEqual(standingsRows(world, "first"));
    expect(standingsRows(world, "final").slice(1)).toEqual([[1, "Compass", "tC", "24.00", 1, 0, "no"]]);
  });

  test("a round nobody has scored yet is just the header", () => {
    expect(standingsRows({ teams: world.teams, scores: { first: world.scores.first } }, "final")).toHaveLength(1);
  });

  test("no scores at all is just the header, and a null team is unnamed", () => {
    expect(standingsRows({ teams: { t1: {} }, scores: undefined })).toHaveLength(1);
    const rows = standingsRows({ teams: { t1: null }, scores: { first: { t1: { j1: { problem: 5 } } } } });
    expect(rows[1]).toEqual([1, "Unnamed Team", "t1", "20.00", 1, 0, "no"]);
  });
});

describe("judges", () => {
  test("one row per judge with what they owe", () => {
    expect(judgeRows(world, "first")).toEqual([
      ["Judge", "Judge UID", "Email", "Company", "Round 1", "Final round", "Checked in", "Assigned", "Submitted", "Outstanding"],
      ["Ada Byron", "j1", "ada@x.io", "Engines", "yes", "no", "yes", 2, 1, "Beacon"],
      ["Grace", "j2", "", "", "no", "yes", "no", 1, 0, "Compass"],
      ["Unknown", "j3", "", "", "no", "no", "no", 0, 0, ""],
    ]);
  });

  test("defaults to the first round, and counts the final round when asked", () => {
    expect(judgeRows(world)).toEqual(judgeRows(world, "first"));
    expect(judgeRows(world, "final")[2]).toEqual(["Grace", "j2", "", "", "no", "yes", "no", 1, 1, ""]);
  });

  test("several outstanding teams are listed with semicolons", () => {
    expect(judgeRows({ judges: { j1: world.judges.j1 }, scores: {} })[1][9]).toBe("Anchor; Beacon");
  });

  test("a round nobody has scored yet leaves everything outstanding", () => {
    const rows = judgeRows({ judges: { j1: world.judges.j1 }, scores: { first: {} } }, "final");
    expect(rows[1].slice(7)).toEqual([2, 0, "Anchor; Beacon"]);
  });

  test("with no scores at all every assignment is outstanding", () => {
    expect(judgeRows({ judges: { j1: world.judges.j1 }, scores: undefined })[1].slice(7)).toEqual([2, 0, "Anchor; Beacon"]);
  });

  test("a null judge record or no scores at all still gives a row", () => {
    expect(judgeRows({ judges: { jX: null }, scores: undefined })[1]).toEqual(["Unknown", "jX", "", "", "no", "no", "no", 0, 0, ""]);
  });
});

describe("competitors", () => {
  test("one row per competitor, by name, with blanks for questions never answered", () => {
    expect(competitorRows(world)).toEqual([
      [
        "Name", "Competitor UID", "Email", "Team", "Team ID", "School",
        "Graduation year", "Major", "Gender", "Dietary", "Checked in",
        "Food collected", "Resume", "Eligibility confirmed", "Registered at",
      ],
      ["Amy", "c1", "", "", "deleted-team", "", "", "", "", "", "no", "no", "", "no", ""],
      ["Solo", "c3", "", "", "", "", "", "", "", "", "no", "no", "", "", ""],
      ["Zed Young", "c2", "z@y.io", "Beacon", "tB", "School of Engineering and Applied Science", 2027, "CS", "Man", "Vegan", "yes", "yes", "https://r/z.pdf", "yes", "2026-10-25T21:05:00.000Z"],
    ]);
  });

  test("a null or nameless record is listed as unnamed, and a padded name is trimmed", () => {
    const rows = competitorRows({ competitors: { cX: null, cY: { firstName: " Pat ", lastName: "" } }, teams: undefined });
    expect(rows.slice(1).map((row) => row.slice(0, 2))).toEqual([
      ["Unnamed", "cX"],
      ["Pat", "cY"],
    ]);
  });

  test("a team id with no teams to look it up in leaves the team name blank", () => {
    expect(competitorRows({ competitors: { c1: { firstName: "A", teamId: "t1" } }, teams: undefined })[1].slice(3, 5)).toEqual([
      "",
      "t1",
    ]);
  });

  test("a registration time that is not a number is left blank, even one that looks like a date", () => {
    const rows = competitorRows({ competitors: { c1: { firstName: "A", registeredAt: "2026-10-25T21:05:00.000Z" } }, teams: {} });
    expect(rows[1][14]).toBe("");
  });

  test("no competitors is just the header", () => {
    expect(competitorRows({ competitors: undefined, teams: {} })).toHaveLength(1);
  });
});

describe("csv", () => {
  test("defuses a formula only at the very start of a value", () => {
    expect(csvCell("=SUM(A1)")).toBe("\t=SUM(A1)");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("1+1")).toBe("1+1");
    expect(csvCell("x@y.io")).toBe("x@y.io");
    expect(csvCell("-5")).toBe("\t-5");
    expect(csvCell("+1")).toBe("\t+1");
    expect(csvCell("@me")).toBe("\t@me");
  });

  test("quotes a carriage return as well as a newline", () => {
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell(0)).toBe("0");
    expect(csvCell(false)).toBe("false");
  });

  test("joins cells with commas and rows with CRLF", () => {
    expect(toCsv([["a", "b"], ["c"]])).toBe("a,b\r\nc");
  });
});

describe("reading the event", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(at)));
  afterEach(() => vi.useRealTimers());

  test("reads each part from its own node", async () => {
    db.reset({
      teams: { t1: { name: "A" } },
      judges: { j1: { firstName: "J" } },
      competitors: { c1: { firstName: "C" } },
      scores: { first: { t1: { j1: { problem: 1 } } }, final: { t1: { j1: { problem: 2 } } } },
      config: { batchCount: 3 },
    });
    await expect(loadEventData()).resolves.toEqual({
      teams: { t1: { name: "A" } },
      judges: { j1: { firstName: "J" } },
      competitors: { c1: { firstName: "C" } },
      scores: { first: { t1: { j1: { problem: 1 } } }, final: { t1: { j1: { problem: 2 } } } },
      config: { batchCount: 3 },
      exportedAt: "2026-10-25T21:05:00.000Z",
    });
  });

  test("an empty database reads as empty maps, never null", async () => {
    db.reset({});
    await expect(loadEventData()).resolves.toEqual({
      teams: {},
      judges: {},
      competitors: {},
      scores: { first: {}, final: {} },
      config: {},
      exportedAt: "2026-10-25T21:05:00.000Z",
    });
  });

  test("the file stamp is the minute, safe for a file name", () => {
    expect(stamp()).toBe("2026-10-25-21-05");
  });
});

describe("downloading", () => {
  let clicked;
  let blobs;
  beforeEach(() => {
    // setTimeout only: jsdom's FileReader fires onload from setImmediate, and
    // faking that too would leave the reads below waiting forever
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clicked = [];
    blobs = [];
    URL.createObjectURL = vi.fn((blob) => {
      blobs.push(blob);
      return `blob:${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const read = (blob, how) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader[how](blob);
    });
  const text = (blob) => read(blob, "readAsText");
  const firstBytes = async (blob, n) => [...new Uint8Array(await read(blob, "readAsArrayBuffer"))].slice(0, n);

  test("a CSV goes out with a BOM so Excel reads the accents, as UTF-8 text/csv", async () => {
    downloadCsv("scores.csv", [["Name"], ["José"]]);
    expect(clicked).toEqual([{ href: "blob:1", download: "scores.csv", attached: true }]);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    // readAsText drops a BOM while decoding, so the bytes are checked directly
    expect(await firstBytes(blobs[0], 4)).toEqual([0xef, 0xbb, 0xbf, "N".charCodeAt(0)]);
    expect(await text(blobs[0])).toBe("Name\r\nJosé");
    expect(document.querySelector("a")).toBeNull();
  });

  test("JSON goes out indented, as application/json", async () => {
    downloadJson("event.json", { a: [1] });
    expect(clicked[0].download).toBe("event.json");
    expect(blobs[0].type).toBe("application/json");
    expect(await text(blobs[0])).toBe('{\n  "a": [\n    1\n  ]\n}');
  });

  test("the object URL is released a second later, not at once", () => {
    downloadJson("x.json", {});
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
  });
});

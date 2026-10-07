/**
 * The event overview's whole answer, pinned for each part of the day.
 *
 * eventReadiness.test.js checks the behaviours one at a time; this pins every
 * check, blocker and action word for word, because they are the text an
 * organizer reads and acts on, and a count or a link that drifts is the kind of
 * mistake nobody notices until the morning of the event.
 */
import {
  REQUIRED_RULES_VERSION,
  SETUP,
  READY,
  SCHEDULED,
  JUDGING,
  FINAL,
  phaseLabel,
  readEventState,
} from "./eventReadiness";

const rooms = ["Rice 340", "Rice 342", "Olsson 005"];
const submitted = (n, extra = {}) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, { name: `T${i}`, submitted: true, ...extra }]));
const roundOne = (n, extra = {}) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`j${i}`, { isRound1Judge: true, ...extra }]));

const RULES_UNRECORDED = {
  id: "rules",
  title: "Publish database rules version 10",
  detail:
    "Nobody has recorded which version is deployed. Until 10 is published, restoring a restore point that contains scores may fail, the database does not enforce the submissions switch or deadline, and announcements cannot be posted.",
  how: "Paste database.rules.json into Realtime Database → Rules, then set config/rulesVersion to match.",
  to: "/user/admin/control?tab=setup",
};
const CHECK_IN = { label: "Check people in", to: "/user/admin/scan" };

test("the rules this build needs, and the phase names", () => {
  expect(REQUIRED_RULES_VERSION).toBe(10);
  expect([SETUP, READY, SCHEDULED, JUDGING, FINAL]).toEqual(["setup", "ready", "scheduled", "judging", "final"]);
  expect([SETUP, READY, SCHEDULED, JUDGING, FINAL].map(phaseLabel)).toEqual([
    "Setting up",
    "Ready to schedule",
    "Schedule published",
    "Judging in progress",
    "Final round",
  ]);
  expect(phaseLabel("nonsense")).toBe("Setting up");
  expect(phaseLabel(undefined)).toBe("Setting up");
});

describe("a brand new event", () => {
  // built per test, not at collection time, so coverage tools see it run inside a test
  let state;
  beforeEach(() => {
    state = readEventState();
  });

  test("is setting up, with everything counted as zero", () => {
    expect(state.phase).toBe("setup");
    expect(state.phaseLabel).toBe("Setting up");
    expect(state.hasDraft).toBe(false);
    expect(state.counts).toEqual({
      teams: { total: 0, submitted: 0, scheduled: 0 },
      judges: { total: 0, roundOne: 0, finalRound: 0, checkedIn: 0 },
      people: { competitors: 0, checkedIn: 0 },
      rooms: 0,
      batchCount: 3,
      scoredTeams: 0,
    });
    expect(state.supply.ok).toBe(false);
  });

  test("every check is outstanding, and says where to fix it", () => {
    expect(state.checks).toEqual([
      { id: "rooms", label: "Judging rooms added", done: false, detail: "None yet. A plan cannot be built without them", to: "/user/admin/control?tab=setup" },
      { id: "judges", label: "First-round judges marked", done: false, detail: "None yet, so nobody would be assigned", to: "/user/admin/judges" },
      { id: "date", label: "Event date set", done: false, detail: "Using the built-in date", to: "/user/admin/control?tab=setup" },
      { id: "submissions", label: "Teams submitted", done: false, detail: "Submissions are closed. Open them in Event setup on the day", to: "/user/admin/control?tab=setup" },
      { id: "schedule", label: "Schedule published", done: false, detail: "Not yet. Judges see nothing until it is", to: "/user/admin/schedule" },
    ]);
  });

  test("the unrecorded rules are the one blocker", () => {
    expect(state.blockers).toEqual([RULES_UNRECORDED]);
  });

  test("the next steps are setup, people, and check-in", () => {
    expect(state.actions).toEqual([
      { label: "Finish event setup", to: "/user/admin/control?tab=setup", primary: true },
      { label: "Add people and roles", to: "/user/admin/control?tab=people" },
      CHECK_IN,
    ]);
  });
});

describe("an event ready to schedule", () => {
  const input = {
    config: { judgingRooms: rooms, eventStart: "2026-10-25T10:00", rulesVersion: 10, submissionsOpen: true },
    teams: { ...submitted(3), draft: { name: "Draft" } },
    judges: {
      ...roundOne(3, { checkedIn: true }),
      jf: { isFinalRoundJudge: true, checkedIn: "yes" },
    },
    competitors: { c1: { checkedIn: true }, c2: { checkedIn: "yes" }, c3: null },
  };

  test("counts what it has", () => {
    const state = readEventState(input);
    expect(state.phase).toBe("ready");
    expect(state.phaseLabel).toBe("Ready to schedule");
    expect(state.counts).toEqual({
      teams: { total: 4, submitted: 3, scheduled: 0 },
      judges: { total: 4, roundOne: 3, finalRound: 1, checkedIn: 3 },
      people: { competitors: 3, checkedIn: 1 },
      rooms: 3,
      batchCount: 3,
      scoredTeams: 0,
    });
  });

  test("passes every check but the schedule, each with its number", () => {
    expect(readEventState(input).checks).toEqual([
      { id: "rooms", label: "Judging rooms added", done: true, detail: "3 rooms", to: "/user/admin/control?tab=setup" },
      { id: "judges", label: "First-round judges marked", done: true, detail: "3 of 4 judges", to: "/user/admin/judges" },
      { id: "date", label: "Event date set", done: true, detail: "Set", to: "/user/admin/control?tab=setup" },
      { id: "submissions", label: "Teams submitted", done: true, detail: "3 of 4 teams", to: "/user/admin/teams" },
      { id: "schedule", label: "Schedule published", done: false, detail: "Not yet. Judges see nothing until it is", to: "/user/admin/schedule" },
    ]);
  });

  test("with the rules published, nothing is blocking", () => {
    expect(readEventState(input).blockers).toEqual([]);
  });

  test("is invited to plan, saying what is ready", () => {
    expect(readEventState(input).actions).toEqual([
      { label: "Plan the schedule", to: "/user/admin/schedule", primary: true, why: "3 teams and 3 first-round judges are ready." },
      CHECK_IN,
    ]);
  });

  test("with a draft open, finishing it comes first and planning afresh is not offered", () => {
    const state = readEventState({ ...input, hasDraft: true });
    expect(state.hasDraft).toBe(true);
    expect(state.actions).toEqual([
      {
        label: "Finish the schedule draft",
        to: "/user/admin/schedule",
        primary: true,
        why: "An unpublished plan is open. Judges see nothing until it is published.",
      },
      CHECK_IN,
    ]);
  });
});

describe("setup that cannot be scheduled yet", () => {
  test("judges marked but too few is not a passing check, and setup is not primary under a draft", () => {
    const state = readEventState({
      config: { judgingRooms: ["Rice 340"], batchCount: 1, rulesVersion: 10 },
      teams: submitted(1),
      judges: {},
      hasDraft: true,
    });
    expect(state.phase).toBe("setup");
    expect(state.counts.batchCount).toBe(1);
    expect(state.checks[0].detail).toBe("1 room");
    expect(state.checks[1]).toMatchObject({ done: false, detail: "None yet, so nobody would be assigned" });
    expect(state.actions).toEqual([
      expect.objectContaining({ label: "Finish the schedule draft" }),
      { label: "Finish event setup", to: "/user/admin/control?tab=setup", primary: false },
      { label: "Add people and roles", to: "/user/admin/control?tab=people" },
    ]);
  });

  test("a judge count too small for the batch fails the judges check though some are marked", () => {
    const state = readEventState({ config: { judgingRooms: rooms, batchCount: 1 }, teams: submitted(3), judges: roundOne(1) });
    expect(state.supply.ok).toBe(false);
    expect(state.checks[1]).toMatchObject({ done: false, detail: "1 of 1 judges" });
  });

  test("with the form open and nothing in, it counts rather than blaming the switch", () => {
    const state = readEventState({ config: { submissionsOpen: true }, teams: { t1: { name: "A" } } });
    expect(state.checks[3]).toEqual({
      id: "submissions",
      label: "Teams submitted",
      done: false,
      detail: "0 of 1 team",
      to: "/user/admin/teams",
    });
  });

  test("submissions closed after teams have submitted shows the count, not the switch", () => {
    const state = readEventState({ config: { submissionsOpen: false }, teams: submitted(2) });
    expect(state.checks[3]).toMatchObject({ done: true, detail: "2 of 2 teams", to: "/user/admin/teams" });
  });

  test("a null team or judge record counts for nothing and breaks nothing", () => {
    const state = readEventState({ teams: { t1: null, ...submitted(1) }, judges: { j1: null, ...roundOne(1) } });
    expect(state.counts.teams).toEqual({ total: 2, submitted: 1, scheduled: 0 });
    expect(state.counts.judges).toEqual({ total: 2, roundOne: 1, finalRound: 0, checkedIn: 0 });
  });

  test("a batch count that is not a number falls back to three", () => {
    expect(readEventState({ config: { batchCount: "lots" } }).counts.batchCount).toBe(3);
    expect(readEventState({ config: { batchCount: "2" } }).counts.batchCount).toBe(2);
  });

  test("a scheduled but unsubmitted team still counts as scheduled", () => {
    const state = readEventState({ teams: { t1: { schedule: { batch: 1 } } } });
    expect(state.counts.teams).toEqual({ total: 1, submitted: 0, scheduled: 1 });
    expect(state.checks[4]).toMatchObject({ done: true, detail: "1 teams scheduled" });
  });
});

describe("once the schedule is out", () => {
  const scheduled = {
    config: { judgingRooms: rooms, rulesVersion: 10 },
    teams: submitted(3, { schedule: { batch: 1 } }),
    judges: roundOne(3),
  };

  test("published: watch progress, nothing about scores yet", () => {
    const state = readEventState(scheduled);
    expect(state.phase).toBe("scheduled");
    expect(state.phaseLabel).toBe("Schedule published");
    expect(state.actions).toEqual([
      { label: "Watch judging progress", to: "/user/admin/judging", primary: true, why: undefined },
      CHECK_IN,
    ]);
  });

  test("judging: says how many are scored and offers the final round", () => {
    const state = readEventState({ ...scheduled, scoredTeams: 2 });
    expect(state.phase).toBe("judging");
    expect(state.phaseLabel).toBe("Judging in progress");
    expect(state.counts.scoredTeams).toBe(2);
    expect(state.actions).toEqual([
      { label: "Watch judging progress", to: "/user/admin/judging", primary: true, why: "2 teams have scores so far." },
      {
        label: "Plan the final round",
        to: "/user/admin/schedule?round=final",
        why: "Ranks every team and cuts the finalists. Nothing is written until you publish.",
      },
      CHECK_IN,
    ]);
  });

  test("a draft open during judging pushes check-in off the list, and progress is no longer primary", () => {
    const actions = readEventState({ ...scheduled, scoredTeams: 1, hasDraft: true }).actions;
    expect(actions.map((a) => a.label)).toEqual(["Finish the schedule draft", "Watch judging progress", "Plan the final round"]);
    expect(actions[1].primary).toBe(false);
  });

  test("the final round replaces everything with its own progress", () => {
    const state = readEventState({ ...scheduled, scoredTeams: 3, finalActive: true });
    expect(state.phase).toBe("final");
    expect(state.phaseLabel).toBe("Final round");
    expect(state.actions).toEqual([{ label: "Final round progress", to: "/user/admin/judging", primary: true }, CHECK_IN]);
  });
});

describe("blockers", () => {
  const blockers = (config, legacyScoreTeams) => readEventState({ config, legacyScoreTeams }).blockers;

  test("an old version before 5 also warns about restores", () => {
    expect(blockers({ rulesVersion: 4 })).toEqual([
      {
        ...RULES_UNRECORDED,
        detail:
          "Version 4 is recorded as published. Until 10 is, the database does not enforce the submissions switch or deadline, and announcements cannot be posted, and restoring a restore point that contains scores fails and changes nothing.",
      },
    ]);
  });

  test("version 5 or later only warns about submissions and announcements", () => {
    for (const version of [5, "9"]) {
      expect(blockers({ rulesVersion: version })[0].detail).toBe(
        `Version ${version} is recorded as published. Until 10 is, the database does not enforce the submissions switch or deadline, and announcements cannot be posted.`
      );
    }
  });

  test("a newer version than this build knows is still flagged", () => {
    expect(blockers({ rulesVersion: 11 })).toHaveLength(1);
  });

  test("the version recorded as text still clears it", () => {
    expect(blockers({ rulesVersion: "10" })).toEqual([]);
  });

  test("legacy score cards are counted in the right grammar", () => {
    const migration = (n) => blockers({ rulesVersion: 10 }, n);
    expect(migration(1)).toEqual([
      {
        id: "migration",
        title: "Finish the score migration",
        detail: "1 team still has score cards under the old location, which the app no longer reads. Those cards count for nothing until they are moved.",
        how: "Run npm run migrate:scores, then check the standings look right.",
        to: "/user/admin/control?tab=data",
      },
    ]);
    expect(migration(3)[0].detail).toMatch(/^3 teams still have score cards/);
    expect(migration(0)).toEqual([]);
  });
});

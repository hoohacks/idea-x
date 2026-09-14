/**
 * The order of the day, as the interface understands it.
 *
 * Every constraint here was already enforced somewhere -- a plan refuses
 * without rooms, refuses again without enough first-round judges -- but only at
 * the moment an organizer walked into it. This is the same arithmetic, asked
 * early enough to act on.
 */
import {
  readEventState, REQUIRED_RULES_VERSION, SETUP, READY, SCHEDULED, JUDGING, FINAL,
} from "./eventReadiness";

const teams = (n, { submitted = n, scheduled = 0 } = {}) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `t${i}`,
      {
        name: `Team ${i}`,
        submitted: i < submitted,
        ...(i < scheduled ? { schedule: { room: "Rice 110", batch: 1 } } : {}),
      },
    ])
  );

const judges = (n, { roundOne = n, checkedIn = n } = {}) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `j${i}`,
      { isRound1Judge: i < roundOne, checkedIn: i < checkedIn },
    ])
  );

const ready = {
  config: { judgingRooms: ["Rice 110", "Rice 120", "Rice 130"], batchCount: 3, eventStart: "2026-10-18" },
  teams: teams(9),
  judges: judges(12),
};

describe("the two judging roles", () => {
  const withProfessors = {
    ...ready,
    judges: {
      ...judges(12),
      p0: { isFinalRoundJudge: true, checkedIn: true },
      p1: { isFinalRoundJudge: true, checkedIn: true },
    },
  };

  test("final-round judges are counted separately from round-one judges", () => {
    const { counts } = readEventState(withProfessors);
    expect(counts.judges.roundOne).toBe(12);
    expect(counts.judges.finalRound).toBe(2);
    expect(counts.judges.total).toBe(14);
  });

  test("they do not make an unschedulable event look ready", () => {
    // supply is a first-round question: nobody marked for the final round
    // alone can stand in a room during a first-round batch
    const shortHanded = {
      ...ready,
      judges: {
        ...judges(1),
        ...Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`p${i}`, { isFinalRoundJudge: true }])
        ),
      },
    };

    expect(readEventState(shortHanded).supply.ok).toBe(false);
  });
});

describe("which part of the day this is", () => {
  test("nothing set up yet is setup", () => {
    expect(readEventState({}).phase).toBe(SETUP);
  });

  test("rooms, teams and judges in place is ready to schedule", () => {
    expect(readEventState(ready).phase).toBe(READY);
  });

  test("teams carrying a schedule means it is published", () => {
    const state = readEventState({ ...ready, teams: teams(9, { scheduled: 9 }) });
    expect(state.phase).toBe(SCHEDULED);
  });

  test("a single score means judging has started", () => {
    const state = readEventState({ ...ready, teams: teams(9, { scheduled: 9 }), scoredTeams: 1 });
    expect(state.phase).toBe(JUDGING);
  });

  test("the final round wins over everything else", () => {
    const state = readEventState({ ...ready, scoredTeams: 9, finalActive: true });
    expect(state.phase).toBe(FINAL);
  });
});

describe("what is blocking, before it blocks", () => {
  test("no rooms is named as the reason, not discovered at the planner", () => {
    const state = readEventState({ ...ready, config: { batchCount: 3 } });
    expect(state.supply.ok).toBe(false);
    expect(state.supply.error).toMatch(/judging rooms/i);
    expect(state.checks.find((c) => c.id === "rooms").done).toBe(false);
  });

  test("too few first-round judges is not a passing check", () => {
    // 20 teams over 3 batches needs a judge per team in the largest batch
    const state = readEventState({
      ...ready,
      teams: teams(20),
      judges: judges(12, { roundOne: 2 }),
    });
    expect(state.checks.find((c) => c.id === "judges").done).toBe(false);
  });

  test("a check says what the number actually is, not just that it failed", () => {
    const state = readEventState({ ...ready, judges: judges(12, { roundOne: 5 }) });
    expect(state.checks.find((c) => c.id === "judges").detail).toBe("5 of 12 judges");
  });

  test("every check knows where it gets fixed", () => {
    for (const check of readEventState({}).checks) {
      expect(check.to).toMatch(/^\/user\//);
    }
  });

  test("a control panel check lands on the tab that fixes it, not the top", () => {
    const state = readEventState({});
    expect(state.checks.find((c) => c.id === "rooms").to).toContain("tab=setup");
  });
});

describe("what to do next", () => {
  const labels = (state) => state.actions.map((a) => a.label);

  test("an unpublished draft outranks everything, because judges see nothing", () => {
    const state = readEventState({ ...ready, hasDraft: true });
    expect(labels(state)[0]).toMatch(/Finish the schedule draft/);
    expect(state.actions[0].primary).toBe(true);
  });

  test("a schedulable event is invited to schedule", () => {
    expect(labels(readEventState(ready))).toContain("Plan the schedule");
  });

  test("an unschedulable event is sent to fix it instead", () => {
    const state = readEventState({ ...ready, config: { batchCount: 3 } });
    expect(labels(state)).not.toContain("Plan the schedule");
    expect(labels(state)).toContain("Finish event setup");
  });

  test("once judging starts, the final round becomes reachable", () => {
    const state = readEventState({ ...ready, teams: teams(9, { scheduled: 9 }), scoredTeams: 4 });
    expect(labels(state)).toContain("Plan the final round");
  });

  test("the final round is not offered before there is anything to rank", () => {
    const state = readEventState({ ...ready, teams: teams(9, { scheduled: 9 }) });
    expect(labels(state)).not.toContain("Plan the final round");
  });

  test("never more than three, or it is the dropdown again", () => {
    const state = readEventState({ ...ready, teams: teams(9, { scheduled: 9 }), scoredTeams: 4, hasDraft: true });
    expect(state.actions.length).toBeLessThanOrEqual(3);
  });
});

/**
 * Two things that must happen before the event and that nothing else would
 * mention, because both fail quietly: unpublished rules make a restore point
 * silently do nothing, and an unfinished migration reads every average from two
 * places at once.
 */
describe("what fails silently if nobody does it", () => {
  const ids = (state) => state.blockers.map((b) => b.id);

  test("rules nobody has recorded as published are a blocker", () => {
    expect(ids(readEventState(ready))).toContain("rules");
  });

  test("an older recorded version is still a blocker, and says which", () => {
    const state = readEventState({ ...ready, config: { ...ready.config, rulesVersion: 3 } });
    const rules = state.blockers.find((b) => b.id === "rules");
    expect(rules.detail).toMatch(/Version 3 is recorded/);
  });

  test("the required version published clears it", () => {
    const state = readEventState({
      ...ready,
      config: { ...ready.config, rulesVersion: REQUIRED_RULES_VERSION },
    });
    expect(ids(state)).not.toContain("rules");
  });

  test("scores left under the team node are a blocker, counted", () => {
    const state = readEventState({ ...ready, legacyScoreTeams: 4 });
    const migration = state.blockers.find((b) => b.id === "migration");
    expect(migration.detail).toMatch(/4 teams still have/);
  });

  test("no legacy cards left is not a blocker", () => {
    expect(ids(readEventState({ ...ready, legacyScoreTeams: 0 }))).not.toContain("migration");
  });

  test("every blocker says how to clear it, not just that it exists", () => {
    for (const blocker of readEventState(ready).blockers) {
      expect(blocker.how.length).toBeGreaterThan(20);
    }
  });
});

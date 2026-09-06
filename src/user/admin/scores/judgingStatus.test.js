/**
 * The organizer's view of the event while it is running.
 *
 * Every number here answers a question that previously had no answer until the
 * results were tallied: which team is about to go unjudged, and which judge has
 * stopped submitting.
 */
import { buildProgress, TEAM_OK, TEAM_THIN, TEAM_UNJUDGED } from "./judgingStatus";

const card = (overrides = {}) => ({
  problem: 8,
  innovation: 8,
  impact: 8,
  viability: 4,
  pitch_quality: 4,
  fundable: true,
  ...overrides,
});

const judge = (first, extra = {}) => ({
  firstName: first,
  lastName: "Judge",
  isRound1Judge: true,
  checkedIn: true,
  ...extra,
});

const scheduleFor = (teamId, judgeIds, batch = 1) => ({
  teamName: teamId,
  id: teamId,
  room: "Rice 110",
  time: "5:00 PM",
  batch,
  judges: judgeIds.map((id) => ({ judgeId: id, judgeName: `${id} Judge` })),
});

function fixture() {
  return {
    teams: {
      t1: { name: "Alpha", submitted: true, schedule: scheduleFor("t1", ["j1", "j2"]) },
      t2: { name: "Beta", submitted: true, schedule: scheduleFor("t2", ["j1", "j2"], 2) },
      t3: { name: "Gamma", submitted: true, schedule: scheduleFor("t3", ["j1"], 3) },
    },
    judges: {
      j1: {
        ...judge("Ada"),
        teamAssignments: {
          t1: scheduleFor("t1", ["j1", "j2"]),
          t2: scheduleFor("t2", ["j1", "j2"], 2),
          t3: scheduleFor("t3", ["j1"], 3),
        },
      },
      j2: {
        ...judge("Bo", { checkedIn: false }),
        teamAssignments: {
          t1: scheduleFor("t1", ["j1", "j2"]),
          t2: scheduleFor("t2", ["j1", "j2"], 2),
        },
      },
    },
    scores: {
      t1: { j1: card(), j2: card() },
      t2: { j1: card() },
    },
  };
}

describe("teams in trouble surface first", () => {
  test("a team with no scores is flagged and sorted to the top", () => {
    const { teamRows } = buildProgress(fixture());

    expect(teamRows[0].name).toBe("Gamma");
    expect(teamRows[0].status).toBe(TEAM_UNJUDGED);
  });

  test("a team seen by one judge is thin, not fine", () => {
    const { teamRows } = buildProgress(fixture());
    const beta = teamRows.find((r) => r.name === "Beta");

    expect(beta.status).toBe(TEAM_THIN);
    expect(beta.received).toBe(1);
    expect(beta.expected).toBe(2);
  });

  test("a fully judged team is ok", () => {
    const { teamRows } = buildProgress(fixture());
    expect(teamRows.find((r) => r.name === "Alpha").status).toBe(TEAM_OK);
  });

  test("the threshold is configurable", () => {
    const { teamRows } = buildProgress({ ...fixture(), minJudges: 1 });
    expect(teamRows.find((r) => r.name === "Beta").status).toBe(TEAM_OK);
  });

  test("names who is still outstanding, so someone can be chased", () => {
    const { teamRows } = buildProgress(fixture());
    const beta = teamRows.find((r) => r.name === "Beta");
    expect(beta.outstanding.map((j) => j.judgeName)).toEqual(["Bo Judge"]);
  });

  test("the judge's own record wins over the name cached on the roster", () => {
    // the roster caches the name at generation time; if a judge later corrects
    // it, the organizer should be chasing the corrected one
    const data = fixture();
    data.judges.j2.firstName = "Robert";
    const { teamRows } = buildProgress(data);
    const beta = teamRows.find((r) => r.name === "Beta");
    expect(beta.outstanding[0].judgeName).toBe("Robert Judge");
  });
});

describe("scores from judges who are no longer assigned", () => {
  // Regenerating the schedule moves assignments but not scores, so a card can
  // outlive the assignment that produced it and keep counting toward the
  // average. Folding that in silently is how a result nobody can explain gets
  // announced.
  test("are reported rather than absorbed", () => {
    const data = fixture();
    data.scores.t1.j9 = card();
    data.judges.j9 = judge("Ghost", { isRound1Judge: false });

    const { teamRows } = buildProgress(data);
    const alpha = teamRows.find((r) => r.name === "Alpha");

    expect(alpha.unassignedScorers.map((j) => j.judgeName)).toEqual(["Ghost Judge"]);
  });

  test("still count toward the average, which is why they are shown", () => {
    const data = fixture();
    data.scores.t1.j9 = card({ problem: 1, innovation: 1, impact: 1, viability: 1, pitch_quality: 1 });

    const { teamRows } = buildProgress(data);
    const alpha = teamRows.find((r) => r.name === "Alpha");

    // received stays at the panel's own count -- the ghost card moves the
    // average without moving completeness
    expect(alpha.received).toBe(2);
    expect(alpha.averageScore).toBeLessThan(36);
  });

  test("an unknown scorer falls back to a uid stub rather than crashing", () => {
    const data = fixture();
    data.scores.t1["some-unknown-uid-1234"] = card();
    const { teamRows } = buildProgress(data);
    const alpha = teamRows.find((r) => r.name === "Alpha");
    expect(alpha.unassignedScorers[0].judgeName).toBe("some-unk");
  });

  test("do not count toward completeness -- an assigned judge outstanding still flags the team", () => {
    // Gamma's only assigned judge is j1, and j1 has not scored; a judge who is
    // not on Gamma's panel scores it instead
    const data = fixture();
    data.scores.t3 = { j9: card() };
    data.judges.j9 = judge("Ghost", { isRound1Judge: false });

    const { teamRows } = buildProgress(data);
    const gamma = teamRows.find((r) => r.name === "Gamma");

    expect(gamma.outstanding.map((j) => j.judgeId)).toEqual(["j1"]);
    expect(gamma.received).toBe(0);
    expect(gamma.status).toBe(TEAM_UNJUDGED);
  });
});

describe("judges", () => {
  test("progress is counted per judge", () => {
    const { judgeRows } = buildProgress(fixture());
    const ada = judgeRows.find((r) => r.name === "Ada Judge");

    expect(ada.assignedCount).toBe(3);
    expect(ada.submittedCount).toBe(2);
    expect(ada.outstanding.map((a) => a.id)).toEqual(["t3"]);
  });

  test("the judge with the most outstanding work sorts first", () => {
    const { judgeRows } = buildProgress(fixture());
    expect(judgeRows[0].name).toBe("Ada Judge");
  });

  test("check-in state is surfaced, because a no-show is the usual cause", () => {
    const { judgeRows } = buildProgress(fixture());
    expect(judgeRows.find((r) => r.name === "Bo Judge").checkedIn).toBe(false);
  });

  test("judges who are neither round one nor assigned are left out", () => {
    const data = fixture();
    data.judges.j5 = judge("Mentor", { isRound1Judge: false });
    const { judgeRows } = buildProgress(data);
    expect(judgeRows.map((r) => r.name)).not.toContain("Mentor Judge");
  });

  test("reads assignments stored as a legacy array", () => {
    const data = fixture();
    data.judges.j1.teamAssignments = [scheduleFor("t1", ["j1", "j2"])];
    const { judgeRows } = buildProgress(data);
    expect(judgeRows.find((r) => r.name === "Ada Judge").assignedCount).toBe(1);
  });
});

describe("totals", () => {
  test("summarise the state of the room", () => {
    const { totals } = buildProgress(fixture());

    expect(totals.teams).toBe(3);
    expect(totals.unjudged).toBe(1);
    expect(totals.thin).toBe(1);
    expect(totals.expected).toBe(5);
    expect(totals.received).toBe(3);
    expect(totals.percent).toBe(60);
    expect(totals.checkedIn).toBe(1);
  });

  test("an empty event does not divide by zero", () => {
    const { totals, teamRows, judgeRows } = buildProgress({});
    expect(totals.percent).toBe(0);
    expect(teamRows).toEqual([]);
    expect(judgeRows).toEqual([]);
  });

  test("called with nothing at all still returns a shape", () => {
    expect(() => buildProgress()).not.toThrow();
  });

  test("extra scores cannot push completion over 100%", () => {
    const data = fixture();
    data.scores.t1.j9 = card();
    expect(buildProgress(data).totals.percent).toBeLessThanOrEqual(100);
  });
});

describe("teams that are not scheduled", () => {
  test("a submitted team with no schedule still appears, with nothing assigned", () => {
    const data = fixture();
    data.teams.t4 = { name: "Delta", submitted: true };

    const { teamRows } = buildProgress(data);
    const delta = teamRows.find((r) => r.name === "Delta");

    expect(delta.status).toBe(TEAM_UNJUDGED);
    expect(delta.expected).toBe(0);
    expect(delta.room).toBeNull();
  });

  test("an unsubmitted, unscheduled team is not judging's problem", () => {
    const data = fixture();
    data.teams.t5 = { name: "Epsilon", submitted: false };
    expect(buildProgress(data).teamRows.map((r) => r.name)).not.toContain("Epsilon");
  });
});

/**
 * The final round is not a filtered view of the first.
 *
 * Switching the round used to swap nothing but which /scores node was read, so
 * the page showed every submitted team, in its first-round room, in front of
 * its first-round panel, with a Judges button that wrote to the first round's
 * assignments. None of that describes what is happening on stage.
 */
describe("the final round shows the final round", () => {
  function finalFixture() {
    return {
      teams: {
        t1: { name: "Alpha", submitted: true, schedule: scheduleFor("t1", ["j1", "j2"]),
              finalSlot: { room: "Rice 011", timeslot: "Slot 1" } },
        t2: { name: "Beta", submitted: true, schedule: scheduleFor("t2", ["j1", "j2"], 2),
              finalSlot: { room: "Rice 011", timeslot: "Slot 2" } },
        t3: { name: "Gamma", submitted: true, schedule: scheduleFor("t3", ["j1"], 3) },
      },
      judges: {
        j1: { ...judge("Ada"), teamAssignments: { t3: scheduleFor("t3", ["j1"], 3) },
              finalAssignments: { t1: { teamId: "t1", teamName: "Alpha", room: "Rice 011", timeslot: "Slot 1" } } },
        j2: { ...judge("Bo"), teamAssignments: {},
              finalAssignments: {
                t1: { teamId: "t1", teamName: "Alpha", room: "Rice 011", timeslot: "Slot 1" },
                t2: { teamId: "t2", teamName: "Beta", room: "Rice 011", timeslot: "Slot 2" },
              } },
        j3: { ...judge("Cy"), teamAssignments: {} },
      },
      scores: { t1: { j1: card() } },
      final: true,
      finalRoundTeams: {
        t1: { name: "Alpha", timeslot: "Slot 1", room: "Rice 011" },
        t2: { name: "Beta", timeslot: "Slot 2", room: "Rice 011" },
      },
    };
  }

  test("only the finalists are listed", () => {
    const { teamRows } = buildProgress(finalFixture());
    expect(teamRows.map((r) => r.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  test("the room and time come from the final slot, not the first round's", () => {
    const alpha = buildProgress(finalFixture()).teamRows.find((r) => r.name === "Alpha");
    expect(alpha.room).toBe("Rice 011");
    expect(alpha.time).toBe("Slot 1");
  });

  test("the panel comes from the judges' final assignments", () => {
    const alpha = buildProgress(finalFixture()).teamRows.find((r) => r.name === "Alpha");
    expect(alpha.assigned.map((a) => a.judgeId).sort()).toEqual(["j1", "j2"]);
    expect(alpha.expected).toBe(2);
    expect(alpha.received).toBe(1);
    expect(alpha.outstanding.map((a) => a.judgeId)).toEqual(["j2"]);
  });

  test("a finalist nobody has scored is flagged", () => {
    const beta = buildProgress(finalFixture()).teamRows.find((r) => r.name === "Beta");
    expect(beta.status).toBe(TEAM_UNJUDGED);
  });

  test("judge rows count final assignments, not first round ones", () => {
    const { judgeRows } = buildProgress(finalFixture());
    const ada = judgeRows.find((r) => r.name === "Ada Judge");
    expect(ada.assignedCount).toBe(1);
    expect(ada.submittedCount).toBe(1);
  });

  test("a round-one judge with no final assignments is not listed to chase", () => {
    const { judgeRows } = buildProgress(finalFixture());
    expect(judgeRows.map((r) => r.name)).not.toContain("Cy Judge");
  });

  test("before activation there are no finalists, not every team", () => {
    const { teamRows, totals } = buildProgress({ ...finalFixture(), finalRoundTeams: null });
    expect(teamRows).toEqual([]);
    expect(totals.percent).toBe(0);
  });

  test("the first round is untouched by any of this", () => {
    const { teamRows } = buildProgress(fixture());
    expect(teamRows).toHaveLength(3);
    expect(teamRows.find((r) => r.name === "Alpha").room).toBe("Rice 110");
  });
});

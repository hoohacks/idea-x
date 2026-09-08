/**
 * The result of the event.
 *
 * The app used to have no answer to "who won": the standings node carried the
 * first round's averages and no screen read it. The thing worth pinning here is
 * the distinction between a running total and a result -- an organizer about to
 * announce a winner must not be shown a first row that is only first because
 * somebody has not pressed submit yet.
 */
import {
  finalStandings, firstRoundStandings, panelsFrom, standingsState, winnerOf,
} from "./standings";

const card = (problem) => ({
  problem,
  innovation: problem,
  impact: problem,
  viability: problem / 2,
  pitch_quality: problem / 2,
  fundable: true,
});

const finalRoundTeams = {
  t1: { name: "Alpha", averageScore: 38, judgeCount: 3, fundableVotes: 3, timeslot: "Slot 1" },
  t2: { name: "Beta", averageScore: 36, judgeCount: 3, fundableVotes: 2, timeslot: "Slot 2" },
  t3: { name: "Gamma", averageScore: 34, judgeCount: 2, fundableVotes: 1, timeslot: "Slot 3" },
};

const panels = { t1: ["j1", "j2"], t2: ["j1", "j2"], t3: ["j1", "j2"] };

describe("reading the panels off the judges", () => {
  test("a judge's final assignments say who is expected to score what", () => {
    const judges = {
      j1: { finalAssignments: { t1: {}, t2: {} } },
      j2: { finalAssignments: { t1: {} } },
      j3: {},
    };
    expect(panelsFrom(judges)).toEqual({ t1: ["j1", "j2"], t2: ["j1"] });
  });

  test("nobody assigned is an empty map, not a crash", () => {
    expect(panelsFrom()).toEqual({});
  });
});

describe("ranking the final round", () => {
  test("it ranks on the final cards, not the ones the cut was made from", () => {
    // Gamma was third going in and wins on the night
    const finalScores = {
      t1: { j1: card(6), j2: card(6) },
      t2: { j1: card(7), j2: card(7) },
      t3: { j1: card(9), j2: card(9) },
    };
    const standings = finalStandings({ finalRoundTeams, finalScores, panels });
    expect(standings.map((t) => t.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  test("the first-round numbers are kept beside the result, not overwritten", () => {
    const finalScores = { t3: { j1: card(9), j2: card(9) } };
    const gamma = finalStandings({ finalRoundTeams, finalScores, panels })
      .find((t) => t.name === "Gamma");

    expect(gamma.firstRound.averageScore).toBe(34);
    expect(gamma.averageScore).toBeGreaterThan(34);
  });

  test("a team nobody has scored yet sorts last, whatever it did in round one", () => {
    // Alpha led the first round and has not presented
    const finalScores = { t2: { j1: card(5), j2: card(5) }, t3: { j1: card(4), j2: card(4) } };
    const standings = finalStandings({ finalRoundTeams, finalScores, panels });
    expect(standings.at(-1).name).toBe("Alpha");
  });

  test("it counts what is in against what is expected, per team", () => {
    const finalScores = { t1: { j1: card(8) } };
    const alpha = finalStandings({ finalRoundTeams, finalScores, panels }).find((t) => t.name === "Alpha");

    expect(alpha.received).toBe(1);
    expect(alpha.expected).toBe(2);
    expect(alpha.complete).toBe(false);
  });

  test("a card from a judge who is not on the panel does not count as received", () => {
    // j9 is not in t1's panel -- its card must not stand in for j2's
    const finalScores = { t1: { j1: card(8), j9: card(8) } };
    const alpha = finalStandings({ finalRoundTeams, finalScores, panels }).find((t) => t.name === "Alpha");

    expect(alpha.received).toBe(1);
    expect(alpha.expected).toBe(2);
    expect(alpha.complete).toBe(false);
  });
});

describe("a running total is not a result", () => {
  const complete = {
    t1: { j1: card(9), j2: card(9) },
    t2: { j1: card(7), j2: card(7) },
    t3: { j1: card(5), j2: card(5) },
  };

  test("every card in is settled, and has a winner", () => {
    const standings = finalStandings({ finalRoundTeams, finalScores: complete, panels });
    expect(standingsState(standings).settled).toBe(true);
    expect(winnerOf(standings).name).toBe("Alpha");
  });

  test("one card missing is not settled, and names who it is waiting on", () => {
    const finalScores = { ...complete, t2: { j1: card(7) } };
    const standings = finalStandings({ finalRoundTeams, finalScores, panels });
    const state = standingsState(standings);

    expect(state.settled).toBe(false);
    expect(state.waitingOn).toEqual([{ name: "Beta", missing: 1 }]);
  });

  test("there is no winner while a card is outstanding, even though there is a first row", () => {
    const finalScores = { ...complete, t2: { j1: card(7) } };
    const standings = finalStandings({ finalRoundTeams, finalScores, panels });

    expect(standings[0].name).toBe("Alpha");
    expect(winnerOf(standings)).toBeNull();
  });

  test("a card from an off-panel judge does not settle the round or crown a winner", () => {
    // t2's real panel is j1 and j2; j9 is scoring a team it was never assigned
    const finalScores = { ...complete, t2: { j1: card(7), j9: card(7) } };
    const standings = finalStandings({ finalRoundTeams, finalScores, panels });
    const state = standingsState(standings);

    expect(state.settled).toBe(false);
    expect(state.waitingOn).toEqual([{ name: "Beta", missing: 1 }]);
    expect(winnerOf(standings)).toBeNull();
  });

  test("nothing scored at all has no winner rather than an arbitrary one", () => {
    const standings = finalStandings({ finalRoundTeams, finalScores: {}, panels });
    expect(winnerOf(standings)).toBeNull();
    expect(standingsState(standings).cards).toBe(0);
  });

  test("no final round at all is an empty result, not a throw", () => {
    expect(finalStandings()).toEqual([]);
    expect(standingsState([]).settled).toBe(false);
    expect(winnerOf([])).toBeNull();
  });
});

/**
 * A panel nobody is assigned to is not a finished panel.
 *
 * Deactivating the final round wipes every judge's `finalAssignments`, which is
 * the population `received` and `expected` are counted over. The page no longer
 * reads a round that is not running, so this is only about the live case: an
 * open round where the plan has not seated anybody yet.
 */
describe("a round with no panels", () => {
  test("is not settled just because nobody is assigned", () => {
    const standings = finalStandings({
      finalRoundTeams,
      finalScores: { t1: { j1: card(9) } },
      panels: {},
    });
    expect(standingsState(standings).settled).toBe(false);
  });

  test("still counts the cards that were filed", () => {
    const standings = finalStandings({
      finalRoundTeams,
      finalScores: { t1: { j1: card(9) }, t2: { j1: card(7) } },
      panels: {},
    });
    expect(standings.reduce((sum, team) => sum + team.cardsFiled, 0)).toBe(2);
  });
});

/**
 * The first round, ranked by the same rule.
 *
 * The panel is the team's own schedule roster rather than the judges'
 * assignment lists, because that roster is what the judging page counts
 * against -- two populations would let a team read as fully scored on one page
 * and short a card on the other.
 */
describe("the first round", () => {
  const roster = (...ids) => ({ judges: ids.map((judgeId) => ({ judgeId })) });
  const teams = {
    a: { name: "Alpha", schedule: { batch: 1, time: "5:00 PM", room: "Rice 340", ...roster("j1", "j2") } },
    b: { name: "Bravo", schedule: { batch: 1, time: "5:00 PM", room: "Rice 342", ...roster("j1", "j2") } },
    c: { name: "Cosmo", schedule: { batch: 2, time: "5:15 PM", room: "Rice 340", ...roster("j1") } },
  };

  test("ranks by average, best first", () => {
    const standings = firstRoundStandings({
      teams,
      firstScores: { a: { j1: card(6) }, b: { j1: card(9) }, c: { j1: card(7) } },
    });
    expect(standings.map((team) => team.name)).toEqual(["Bravo", "Cosmo", "Alpha"]);
  });

  test("a team nobody has scored sorts last, by name, without a place", () => {
    const standings = firstRoundStandings({
      teams,
      firstScores: { b: { j1: card(9) } },
    });
    expect(standings.map((team) => team.name)).toEqual(["Bravo", "Alpha", "Cosmo"]);
    expect(standings[1].averageScore).toBeNull();
  });

  test("counts expected against the roster, not against whoever filed a card", () => {
    const standings = firstRoundStandings({
      teams,
      // j9 is not on Alpha's roster: the card counts toward the average but
      // cannot stand in for j2's missing one
      firstScores: { a: { j1: card(8), j9: card(8) } },
    });
    const alpha = standings.find((team) => team.name === "Alpha");
    expect(alpha.expected).toBe(2);
    expect(alpha.received).toBe(1);
    expect(alpha.complete).toBe(false);
    expect(alpha.cardsFiled).toBe(2);
  });

  test("every judge on the roster in is a complete team", () => {
    const standings = firstRoundStandings({
      teams,
      firstScores: { c: { j1: card(7) } },
    });
    expect(standings.find((team) => team.name === "Cosmo").complete).toBe(true);
  });

  test("carries where the team presented, for checking a surprising score", () => {
    const [top] = firstRoundStandings({ teams, firstScores: { a: { j1: card(9) } } });
    expect(top.batch).toBe(1);
    expect(top.timeslot).toBe("5:00 PM");
    expect(top.room).toBe("Rice 340");
  });

  test("a team with no schedule at all is ranked, not dropped", () => {
    const standings = firstRoundStandings({
      teams: { z: { name: "Zulu" } },
      firstScores: { z: { j1: card(9) } },
    });
    expect(standings[0].name).toBe("Zulu");
    expect(standings[0].expected).toBe(0);
  });

  test("no teams at all is an empty result, not a throw", () => {
    expect(firstRoundStandings()).toEqual([]);
  });
});

import { compareForRanking, rankingEntry, scoreCard, scoredJudgeCount } from "../../judge/scoreRubric.js";
import { rosterOf } from "../../judge/assignmentList.js";

/**
 * Who won.
 *
 * Nothing in the app answered that. The final round wrote its standings to
 * `/finalRound/teams` and no screen read them -- `subscribeToFinalRoundStandings`
 * was exported and never imported. Worse, those standings carry the *first*
 * round's averages, frozen at the moment the cut was made, and nothing updates
 * them as final scores arrive. So the day built to a decision the app could not
 * show you: to find the winner you exported the final round's raw cards and did
 * the arithmetic yourself.
 *
 * This ranks the final round the same way the cut was ranked -- same rubric,
 * same explicit tiebreak -- and keeps the first-round numbers beside it, because
 * a team that led the field all day and came second on the night is a thing an
 * organizer wants to see rather than infer.
 *
 * Pure.
 */

/**
 * @param finalRoundTeams the /finalRound/teams node -- who is in the round
 * @param finalScores     /scores/final, as { teamId: { judgeUid: card } }
 * @param panels          { teamId: judgeUid[] } who is expected to score, from
 *                        each judge's finalAssignments
 */
/**
 * The order a ranking is read in, for either round.
 *
 * `compareForRanking` is the tiebreak the cut is made on and the exports are
 * written with; the only thing added here is where a team with no card at all
 * goes. It sorts last whatever it did in the other round, because it has not
 * been heard yet -- a team that led the field all day and has not presented
 * tonight is not in first place, and it is not in last place either. Both
 * rounds share this so the two tabs cannot drift into ranking by different
 * rules.
 */
export function byRank(a, b) {
  const aScored = typeof a.averageScore === "number";
  const bScored = typeof b.averageScore === "number";
  if (aScored !== bScored) return aScored ? -1 : 1;
  if (!aScored) return String(a.name).localeCompare(String(b.name));
  return compareForRanking(a, b);
}

/**
 * The first round, ranked.
 *
 * Same rubric and same tiebreak as the final, so the standing a team is shown
 * here is the standing the cut was made on. The panel comes off the team's own
 * schedule roster rather than the judges' assignment lists -- that roster is
 * what the judging page counts against, and counting `received` over a
 * different population is how a team gets marked complete that a judge on its
 * panel has not actually scored.
 *
 * @param teams       the /teams node
 * @param firstScores /scores/first, as { teamId: { judgeUid: card } }
 */
export function firstRoundStandings({ teams = {}, firstScores = {} } = {}) {
  return Object.entries(teams)
    .map(([teamId, team]) => {
      const cards = firstScores[teamId] ?? {};
      const assigned = rosterOf(team?.schedule).map((entry) => entry.judgeId);
      const expected = assigned.length;
      const received = assigned.filter((judgeId) => scoreCard(cards[judgeId]) !== null).length;

      return {
        ...rankingEntry(teamId, team?.name, cards),
        submitted: Boolean(team?.submitted),
        timeslot: team?.schedule?.time ?? null,
        room: team?.schedule?.room ?? null,
        batch: team?.schedule?.batch ?? null,
        expected,
        received,
        cardsFiled: scoredJudgeCount(cards),
        complete: expected > 0 && received >= expected,
      };
    })
    .sort(byRank);
}

export function finalStandings({ finalRoundTeams = {}, finalScores = {}, panels = {} } = {}) {
  return Object.entries(finalRoundTeams)
    .map(([teamId, standing]) => {
      const cards = finalScores[teamId] ?? {};
      const assigned = panels[teamId] ?? [];
      const expected = assigned.length;
      // `expected` and `received` have to be counts over the same population --
      // the assigned panel -- or a card from a judge who isn't on it can stand
      // in for the assigned judge's still-missing one and complete a team that
      // has not actually been heard from by everyone who owes it a score.
      const received = assigned.filter((judgeId) => scoreCard(cards[judgeId]) !== null).length;
      // raw card count, not scoped to the panel -- deactivating the round wipes
      // every judge's finalAssignments but not the cards already written, so
      // this is the only proof of work standingsState has left once closed
      const cardsFiled = scoredJudgeCount(cards);

      return {
        ...rankingEntry(teamId, standing?.name, cards),
        // what the cut was made on, kept beside the result rather than
        // overwritten by it
        firstRound: {
          averageScore: standing?.averageScore ?? null,
          judgeCount: standing?.judgeCount ?? 0,
          fundableVotes: standing?.fundableVotes ?? 0,
        },
        timeslot: standing?.timeslot ?? null,
        room: standing?.room ?? null,
        expected,
        received,
        cardsFiled,
        // a ranking that is still missing cards is a running total, not a result
        complete: expected > 0 && received >= expected,
      };
    })
    .sort(byRank);
}

/** Who is expected to score each finalist, read off the judges' assignments. */
export function panelsFrom(judges = {}) {
  const panels = {};
  for (const [judgeId, judge] of Object.entries(judges)) {
    for (const teamId of Object.keys(judge?.finalAssignments ?? {})) {
      (panels[teamId] = panels[teamId] ?? []).push(judgeId);
    }
  }
  return panels;
}

/**
 * Whether these standings are final, and what is still missing if not.
 *
 * An organizer about to announce a winner needs to know the difference between
 * "this is the result" and "this is the result so far", and the gap between
 * them is usually one judge who has not pressed submit.
 *
 * There used to be a `closed` option here, for reading an archived round back
 * after deactivation had wiped the panels it counts against. The results page
 * no longer shows a round that is not running, so nothing passes it.
 */
export function standingsState(standings) {
  const outstanding = standings.filter((team) => !team.complete);
  const expected = standings.reduce((sum, team) => sum + team.expected, 0);
  const cards = standings.reduce((sum, team) => sum + team.received, 0);

  return {
    settled: standings.length > 0 && outstanding.length === 0,
    cards,
    expected,
    waitingOn: outstanding.map((team) => ({
      name: team.name,
      missing: Math.max(0, team.expected - team.received),
    })),
  };
}

/**
 * The winner, or null while it is still a tie nobody has broken.
 *
 * `compareForRanking` is a total order, so there is always a first row -- but a
 * first row and a winner are not the same claim while cards are outstanding.
 */
export function winnerOf(standings) {
  const [first] = standings;
  if (!first || typeof first.averageScore !== "number") return null;
  return standingsState(standings).settled ? first : null;
}

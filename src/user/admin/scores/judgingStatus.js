import { assignmentList } from "../../judge/assignmentList";
import { calculateAverageScore, countFundableVotes } from "../../judge/scoreRubric";

/**
 * Turns the raw judging nodes into the two questions an organizer actually has
 * during the event: which team is about to go unjudged, and which judge has
 * stopped submitting.
 *
 * Nothing answered either before. A judge saw their own "2 of 3 left to score";
 * everybody else was blind until the results were tallied, which is far too
 * late to send someone to a room.
 *
 * Pure on purpose — no Firebase in here — so the arithmetic can be tested
 * without an emulator.
 */

export const TEAM_OK = "ok";
export const TEAM_THIN = "thin";
export const TEAM_UNJUDGED = "unjudged";

function judgeName(judge, fallback) {
  const name = [judge?.firstName, judge?.lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

function rosterOf(schedule) {
  const raw = schedule?.judges;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.filter((entry) => entry && entry.judgeId);
}

/**
 * @param teams    the /teams node
 * @param judges   the /judges node
 * @param scores   { teamId: { judgeUid: card } } for the round being shown
 * @param minJudges below this a team is flagged as thinly judged
 * @param final    show the final round instead of the first
 * @param finalRoundTeams the /finalRound/teams node, required when final
 */
export function buildProgress({
  teams = {},
  judges = {},
  scores = {},
  minJudges = 2,
  final = false,
  finalRoundTeams = null,
} = {}) {
  const judgeEntries = Object.entries(judges ?? {});

  // Which teams the round is about, and where each one presents. The final
  // round is not a filtered view of the first: a different set of teams, in a
  // different room, at a different time, in front of a different panel. Reading
  // team.schedule while showing final-round scores put every submitted team on
  // the page with its first-round room and its first-round panel, none of which
  // has anything to do with what is happening on stage.
  const inRound = final
    ? Object.entries(finalRoundTeams ?? {}).map(([teamId, standing]) => [
        teamId,
        teams?.[teamId] ?? { name: standing?.name, submitted: true },
      ])
    : Object.entries(teams ?? {}).filter(([, team]) => team?.schedule || team?.submitted);

  // In the final round the panel is not on the team, it is on each judge --
  // /judges/{uid}/finalAssignments is what the rules treat as proof of
  // assignment, so it is also the truth about who is expected to score.
  const finalPanels = {};
  if (final) {
    for (const [judgeId, judge] of judgeEntries) {
      for (const teamId of Object.keys(judge?.finalAssignments ?? {})) {
        (finalPanels[teamId] ??= []).push({
          judgeId,
          judgeName: judgeName(judge, "Unnamed Judge"),
        });
      }
    }
  }

  const teamRows = inRound
    .map(([teamId, team]) => {
      const schedule = final ? team?.finalSlot : team?.schedule;
      const assigned = final
        ? (finalPanels[teamId] ?? [])
        : rosterOf(schedule).map((entry) => ({
            judgeId: entry.judgeId,
            // the roster caches the name, but the judge record is the truth if
            // they have since corrected it
            judgeName: judgeName(judges[entry.judgeId], entry.judgeName ?? "Unnamed Judge"),
          }));

      const cards = scores?.[teamId] ?? {};
      const scoredBy = new Set(Object.keys(cards));

      // a card from someone no longer assigned still counts toward the average,
      // so it has to be visible rather than quietly folded in
      const unassignedScorers = [...scoredBy]
        .filter((uid) => !assigned.some((a) => a.judgeId === uid))
        .map((uid) => ({ judgeId: uid, judgeName: judgeName(judges[uid], uid.slice(0, 8)) }));

      const outstanding = assigned.filter((a) => !scoredBy.has(a.judgeId));
      // received has to be counted over the same population as expected --
      // the assigned panel -- or a card from someone off it (see
      // unassignedScorers above) can stand in for an assigned judge's still-
      // missing card and mark a team complete that a real judge hasn't scored
      const received = assigned.length - outstanding.length;

      let status = TEAM_OK;
      if (received === 0) status = TEAM_UNJUDGED;
      else if (received < minJudges) status = TEAM_THIN;

      return {
        teamId,
        name: team?.name ?? "Unnamed Team",
        submitted: Boolean(team?.submitted),
        room: schedule?.room ?? null,
        time: (final ? schedule?.timeslot : schedule?.time) ?? null,
        batch: schedule?.batch ?? null,
        assigned,
        outstanding,
        unassignedScorers,
        received,
        expected: assigned.length,
        averageScore: calculateAverageScore(cards),
        fundableVotes: countFundableVotes(cards),
        status,
      };
    })
    .sort((a, b) => {
      // the teams in trouble first: that is the entire point of the page
      const rank = { [TEAM_UNJUDGED]: 0, [TEAM_THIN]: 1, [TEAM_OK]: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if ((a.batch ?? 0) !== (b.batch ?? 0)) return (a.batch ?? 0) - (b.batch ?? 0);
      return String(a.name).localeCompare(String(b.name));
    });

  const judgeRows = judgeEntries
    .map(([judgeId, judge]) => {
      const assignments = assignmentList(final ? judge?.finalAssignments : judge?.teamAssignments);
      const submitted = assignments.filter((assignment) => {
        const teamId = assignment.id ?? assignment.teamId;
        return Boolean(scores?.[teamId]?.[judgeId]);
      });

      return {
        judgeId,
        name: judgeName(judge, "Unnamed Judge"),
        email: judge?.email ?? null,
        checkedIn: judge?.checkedIn === true,
        isRound1Judge: judge?.isRound1Judge === true,
        assignedCount: assignments.length,
        submittedCount: submitted.length,
        outstanding: assignments.filter((assignment) => {
          const teamId = assignment.id ?? assignment.teamId;
          return !scores?.[teamId]?.[judgeId];
        }),
      };
    })
    // a round-one judge with nothing to do in the final -- every finalist
    // already scored by them -- is not somebody to chase
    .filter((row) => (final ? row.assignedCount > 0 : row.isRound1Judge || row.assignedCount > 0))
    .sort((a, b) => {
      // most outstanding work first, so the judge to chase is at the top
      const aLeft = a.assignedCount - a.submittedCount;
      const bLeft = b.assignedCount - b.submittedCount;
      if (aLeft !== bLeft) return bLeft - aLeft;
      return a.name.localeCompare(b.name);
    });

  const expected = teamRows.reduce((sum, row) => sum + row.expected, 0);
  const received = teamRows.reduce((sum, row) => sum + Math.min(row.received, row.expected), 0);

  return {
    teamRows,
    judgeRows,
    totals: {
      teams: teamRows.length,
      unjudged: teamRows.filter((row) => row.status === TEAM_UNJUDGED).length,
      thin: teamRows.filter((row) => row.status === TEAM_THIN).length,
      judges: judgeRows.length,
      checkedIn: judgeRows.filter((row) => row.checkedIn).length,
      expected,
      received,
      percent: expected ? Math.round((received / expected) * 100) : 0,
    },
  };
}

export default buildProgress;

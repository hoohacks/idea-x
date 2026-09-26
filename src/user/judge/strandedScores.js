/**
 * Which score cards a new schedule would orphan.
 *
 * Scores live at `scores/{round}/{teamId}/{judgeUid}` -- keyed by the pair, not
 * by the assignment. Republishing a schedule rewrites every assignment in the
 * event but moves no cards, so a card whose pair the new plan does not contain
 * simply stays where it is. Nothing reads it as wrong: it still counts toward
 * that team's average, and that average is what the final-round cut is made
 * from. The judge it belongs to will never be in that room.
 *
 * That is why `publishPlan` refuses a plan that would strand any card. The
 * arithmetic is here, pure, so the refusal and the message an organizer reads
 * cannot disagree about which cards are at stake.
 *
 * Re-publishing that strands nothing -- the first publish of an event, or a
 * re-plan that happens to seat every judge who has already scored -- is not
 * refused. The dangerous case is the only one blocked.
 */

/** Every card in `scoresByTeam` whose team+judge pair the plan does not seat. */
export function strandedBy(plan, scoresByTeam) {
  const seated = new Map();
  for (const assignment of Object.values(plan?.assignments ?? {})) {
    seated.set(
      assignment.id,
      new Set((assignment.judges ?? []).map((judge) => judge.judgeId))
    );
  }

  const stranded = [];
  for (const [teamId, cards] of Object.entries(scoresByTeam ?? {})) {
    for (const judgeUid of Object.keys(cards ?? {})) {
      if (!seated.get(teamId)?.has(judgeUid)) stranded.push({ teamId, judgeUid });
    }
  }
  return stranded;
}

/** How many entries a message lists before it starts counting instead. */
const SHOWN = 5;

/**
 * "Lumen by Grace, …" -- the pairs, named.
 *
 * A count alone ("30 cards would be stranded") is not something an organizer
 * can act on. Naming them is what lets them recognise the one judge who went
 * home and decide whether they care.
 */
export function describeStranded(stranded, plan) {
  const teamName = (teamId) =>
    plan?.assignments?.[teamId]?.teamName ?? plan?.teamNames?.[teamId] ?? teamId;
  const judgeName = (judgeUid) => plan?.judgeNames?.[judgeUid] ?? judgeUid;

  const named = stranded.slice(0, SHOWN).map((c) => `${teamName(c.teamId)} by ${judgeName(c.judgeUid)}`);
  const rest = stranded.length - named.length;
  return rest > 0 ? `${named.join(", ")}, and ${rest} more` : named.join(", ");
}

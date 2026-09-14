/**
 * The shape of the final round, decided before anything is written.
 *
 * This is to `finalRoundService` what `schedulePlan` is to `planSchedule`: the
 * arithmetic, with no Firebase in it, so the answer is available before the
 * write and testable without an emulator.
 *
 * Two things drive the whole file.
 *
 * 1. **One room, teams in sequence.** The final round is not a second first
 *    round. Every finalist presents to the same panel, one after another, so
 *    there is no "judge in two rooms at once" to check for -- there is one
 *    room. What an organizer edits is who is on a panel, and what order the
 *    teams go in.
 *
 * 2. **Everyone present judges everyone.** Because the finalists present one
 *    after another to the room, whoever is in that room hears every pitch, so
 *    every eligible judge is seated on every finalist. Scoring a team in round
 *    one bars nobody -- the pool is made of organizers who judged round one,
 *    so a per-team exclusion would punch a different hole in every panel and,
 *    at a small event, leave a finalist with nobody able to score it.
 */

/** Slot labels are 1-based; `order` is not. */
export function slotLabel(order) {
  return `Slot ${order + 1}`;
}

/**
 * Build the plan an organizer starts from.
 *
 * The cut is the top `size` of `ranked`, in rank order, and every finalist's
 * panel is prefilled with the whole pool -- which is exactly what activation
 * used to derive at the moment of the write. The difference is that this is now
 * a starting point rather than the answer: an organizer who wants a smaller
 * panel on one team takes people off it.
 *
 * Pure. `ranked` must already be sorted; ranking is `scoreRubric`'s job.
 */
export function buildFinalPlan({ ranked = [], pool = [], size = 4, room = "" }) {
  const assignments = {};
  ranked.slice(0, size).forEach((team, order) => {
    assignments[team.teamId] = {
      teamId: team.teamId,
      teamName: team.name,
      order,
      judges: [...pool],
    };
  });

  return {
    version: 0,
    room,
    size,
    ranked,
    assignments,
    pool,
    edits: [],
    basis: {
      cardCounts: Object.fromEntries(ranked.map((team) => [team.teamId, team.judgeCount])),
      eligibleJudges: Object.fromEntries(pool.map((judge) => [judge.judgeId, true])),
      size,
      room,
    },
  };
}

/** The finalists, in the order they present. */
export function slotsOf(plan) {
  return Object.values(plan?.assignments ?? {}).sort((a, b) => a.order - b.order);
}

/**
 * What the plan looks like right now, for the bar above the grid.
 *
 * A hand-edited plan carries none of the prefill's properties, so this reports
 * what is actually there rather than what a fresh build would have produced.
 */
export function finalStats(plan) {
  const slots = slotsOf(plan);
  const panelSizes = slots.map((slot) => slot.judges.length);

  const working = new Set();
  for (const slot of slots) for (const judge of slot.judges) working.add(judge.judgeId);

  return {
    finalists: slots.length,
    ranked: (plan?.ranked ?? []).length,
    minPanel: panelSizes.length ? Math.min(...panelSizes) : 0,
    maxPanel: panelSizes.length ? Math.max(...panelSizes) : 0,
    // a team nobody is judging presents to an empty room -- the one number
    // here that is always a mistake
    unjudged: slots.filter((slot) => slot.judges.length === 0).map((slot) => slot.teamName),
    idle: (plan?.pool ?? []).filter((judge) => !working.has(judge.judgeId)).length,
    edits: (plan?.edits ?? []).length,
  };
}

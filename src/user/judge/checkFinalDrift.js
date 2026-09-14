/**
 * Has the event moved since the final round was planned?
 *
 * `checkDrift.js` for the final round. Same split: **blocking** drift means
 * publishing would write something nobody reviewed, and comes with a targeted
 * repair so an organizer does not have to rebuild and lose their edits;
 * **advisory** drift is shown and publishes anyway.
 *
 * The score check is the one that matters most and it is checked across every
 * *ranked* team, not just the finalists. A card landing on the team just below
 * the cut line changes that team's average, not any finalist's, and can lift it
 * above one. That is the dangerous half: a team that earned a place does not
 * get one, and nothing about the finalist list looks wrong.
 *
 * Pure.
 */

import { slotsOf } from "./finalRoundPlan.js";

export const BLOCKING = "blocking";
export const ADVISORY = "advisory";

/**
 * @param plan the draft being published
 * @param live { cardCounts, eligibleJudges, submitted, room, size } read now
 * @returns an array of { kind, level, message, repair? }
 */
export function checkFinalDrift(plan, live) {
  const issues = [];

  // ---- a card arrived since the ranking was computed ----
  for (const [teamId, count] of Object.entries(plan?.basis?.cardCounts ?? {})) {
    const now = live?.cardCounts?.[teamId];
    if (now === count) continue;

    const name =
      (plan.ranked ?? []).find((team) => team.teamId === teamId)?.name ?? teamId;
    issues.push({
      kind: "scores",
      level: BLOCKING,
      teamId,
      message:
        `${name} has been scored since this ranking was computed, so the averages the cut was ` +
        `made from have moved.`,
      repair: "rerank",
    });
  }

  // ---- a finalist withdrew ----
  for (const slot of slotsOf(plan)) {
    if (live?.submitted?.[slot.teamId]) continue;
    issues.push({
      kind: "team",
      level: BLOCKING,
      teamId: slot.teamId,
      message: `${slot.teamName} is no longer a submitted team.`,
      repair: "dropTeam",
    });
  }

  // ---- a judge on a panel is no longer eligible ----
  for (const slot of slotsOf(plan)) {
    for (const judge of slot.judges) {
      if (live?.eligibleJudges?.[judge.judgeId]) continue;
      issues.push({
        kind: "judge",
        level: BLOCKING,
        teamId: slot.teamId,
        judgeId: judge.judgeId,
        message:
          `${judge.judgeName} is on ${slot.teamName}'s panel but is no longer eligible for the ` +
          `final round.`,
        repair: "removeJudge",
      });
    }
  }

  // ---- config moved under the plan ----
  if (live?.room && plan?.basis?.room && live.room !== plan.basis.room && live.room !== plan.room) {
    issues.push({
      kind: "room",
      level: ADVISORY,
      message: `The final round room was changed to ${live.room} after this plan was built.`,
      repair: "setRoom",
      room: live.room,
    });
  }

  if (live?.size && plan?.basis?.size && live.size !== plan.basis.size) {
    issues.push({
      kind: "size",
      level: ADVISORY,
      message:
        `The final round size was changed to ${live.size}. The cut in this plan is explicit, ` +
        `so publishing keeps the ${slotsOf(plan).length} teams you can see.`,
    });
  }

  return issues;
}

export function blockingOnly(issues) {
  return (issues ?? []).filter((issue) => issue.level === BLOCKING);
}

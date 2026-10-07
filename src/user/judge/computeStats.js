/**
 * The numbers describing a plan.
 *
 * These used to be computed at write time, which is the one moment nobody can
 * act on them. Here they are pure, so the preview recomputes them after every
 * edit and the bar above the grid always describes the plan on screen rather
 * than the plan as generated.
 */
export function computeStats(plan) {
  const assignments = Object.values(plan.assignments ?? {});
  const { teamIds = [], judgeIds = [], target = 3 } = plan.basis ?? {};

  const byBatch = new Map();
  for (const a of assignments) {
    byBatch.set(a.batch, (byBatch.get(a.batch) ?? 0) + 1);
  }
  const batchSizes = [...byBatch.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, size]) => size);

  const panelSizes = assignments.map((a) => a.judges.length);
  const assigned = new Set();
  for (const a of assignments) for (const j of a.judges) assigned.add(j.judgeId);

  const seenPairs = new Set();
  let repeatPairings = 0;
  for (const { judges } of assignments) {
    for (let i = 0; i < judges.length; i++) {
      for (let k = i + 1; k < judges.length; k++) {
        // JSON, not join("-"): ("a-b", "c") and ("a", "b-c") are different pairs
        const key = JSON.stringify([judges[i].judgeId, judges[k].judgeId].sort());
        if (seenPairs.has(key)) repeatPairings += 1;
        else seenPairs.add(key);
      }
    }
  }

  return {
    teams: assignments.length,
    judges: judgeIds.length,
    batchSizes,
    roomsUsed: batchSizes.length ? Math.max(...batchSizes) : 0,
    minJudgesPerTeam: panelSizes.length ? Math.min(...panelSizes) : 0,
    maxJudgesPerTeam: panelSizes.length ? Math.max(...panelSizes) : 0,
    spareJudgeIds: judgeIds.filter((uid) => !assigned.has(uid)),
    belowTarget: assignments.filter((a) => a.judges.length < target).map((a) => a.id),
    unscheduledTeamIds: teamIds.filter((id) => !plan.assignments?.[id]),
    repeatPairings,
  };
}

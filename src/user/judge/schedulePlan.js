/**
 * Deciding the shape of the judging round, with no Firebase in sight.
 *
 * planSchedule and publishPlan used to be one function that did the
 * arithmetic and the writing, which meant the only way to ask "what would
 * this event look like?" was to generate it for real. Everything here is
 * pure, so the answer is available before anything is written -- and
 * testable without an emulator.
 *
 * Two ideas drive the whole file.
 *
 * 1. A judge visits exactly one team per batch. That constraint, not the
 *    assignment code, is what fixes how many judges a team can get: a team in
 *    a batch of `s` teams draws from `judges / s`. Batches whose sizes differ
 *    therefore give teams different amounts of attention, and no cleverness in
 *    the allocator can undo it. The remedy is a batch count that divides the
 *    team count, which is what `describeSupply` recommends.
 *
 * 2. More judges is not automatically better. The old allocator sent every
 *    judge to a team in every batch, so 40 judges and 4 teams put 20 people in
 *    one room and 40 in another. Past a useful number, extra judges crowd the
 *    room and tell you nothing new. `TARGET_JUDGES_PER_TEAM` caps the panel and
 *    holds the rest back as spares, which is what you actually want on the day:
 *    someone to send when a judge does not turn up.
 */

export const BATCH_COUNT = 3;

export const BATCH_TIMES = {
  1: "5:00 PM",
  2: "5:15 PM",
  3: "5:30 PM",
};

/**
 * How many judges a team should ideally see.
 *
 * Two is the floor for an average to mean anything -- one judge is an opinion,
 * not a score. Three gives a median and absorbs one outlier. Above that the
 * marginal judge adds little and costs a seat in the room, so surplus judges
 * are held back as spares instead.
 */
export const TARGET_JUDGES_PER_TEAM = 3;
export const MIN_JUDGES_PER_TEAM = 2;

/**
 * Split teams into contiguous batches whose sizes differ by at most one.
 * Unchanged behaviour -- the remainder goes to the earliest batches.
 */
export function splitIntoBatches(items, batchCount = BATCH_COUNT) {
  const base = Math.floor(items.length / batchCount);
  const remainder = items.length % batchCount;
  const batches = [];
  let cursor = 0;
  for (let b = 0; b < batchCount; b++) {
    const size = base + (b < remainder ? 1 : 0);
    batches.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return batches;
}

/**
 * Which judges sit on which team, for one batch.
 *
 * Returns an array of `batchSize` arrays of judge indices. Guarantees:
 *
 *   - a judge appears at most once, so nobody is sent to two rooms at once
 *   - team panel sizes differ by at most one
 *   - no team exceeds `target` while any team is still below it
 *   - when there are more judges than the target needs, the surplus is left
 *     out of this batch and a DIFFERENT surplus is left out of the next one
 *
 * The rotation is what stops the same people touring the building together.
 * Positions are filled seat by seat from a judge list rotated by the batch
 * index, so a judge who shared a room with someone in batch one is very
 * unlikely to share with them again in batch two.
 */
export function allocateBatch({ judgeCount, batchSize, batchIndex = 0, target = TARGET_JUDGES_PER_TEAM }) {
  const seats = Array.from({ length: batchSize }, () => []);
  if (batchSize <= 0 || judgeCount <= 0) return seats;

  // never seat more than the panel needs, and never more than we have
  const seatsToFill = Math.min(judgeCount, batchSize * Math.max(1, target));

  // Two independent shifts, and both are needed.
  //
  // `rotation` picks WHICH judges are used, so a different group sits out as
  // spares in each batch.
  //
  // `stride` picks WHERE they sit. Without it, seat = position % batchSize puts
  // judges into fixed residue classes mod batchSize -- so the same three people
  // would tour all three rooms together, which is the exact thing the old
  // formula existed to prevent. Shifting the seat by the fill-round breaks
  // those classes apart between batches.
  const rotation = (batchIndex * (batchSize + 1)) % judgeCount;
  const stride = batchIndex + 1;

  for (let position = 0; position < seatsToFill; position++) {
    const round = Math.floor(position / batchSize);
    const slot = position % batchSize;
    const seat = (slot + round * stride) % batchSize;
    seats[seat].push((position + rotation) % judgeCount);
  }

  return seats;
}

/**
 * Can this event be scheduled at all, and what should the organizer change?
 *
 * This is the function that answers "too few judges" and "too many judges for
 * too few teams". It returns advice with real numbers in it rather than a bare
 * refusal, because "add more rooms" without saying how many is not actionable
 * at 4:45 on the day.
 */
export function describeSupply({
  teamCount,
  judgeCount,
  roomCount,
  batchCount = BATCH_COUNT,
  target = TARGET_JUDGES_PER_TEAM,
}) {
  const warnings = [];
  const advice = [];

  if (teamCount <= 0) {
    return { ok: false, error: "No teams have submitted a project yet, so there is nothing to judge.", warnings, advice };
  }
  if (judgeCount <= 0) {
    return { ok: false, error: "No judges are available to schedule.", warnings, advice };
  }
  if (roomCount <= 0) {
    return {
      ok: false,
      error: "No judging rooms are configured. Add them on the control panel, then build the plan again.",
      warnings,
      advice,
    };
  }

  const sizes = splitIntoBatches(Array.from({ length: teamCount }), batchCount)
    .map((batch) => batch.length)
    .filter((size) => size > 0);
  const largest = Math.max(...sizes);

  // ---- hard stops ----

  if (largest > roomCount) {
    const neededBatches = Math.ceil(teamCount / roomCount);
    return {
      ok: false,
      error:
        `${teamCount} teams over ${batchCount} batches need ${largest} rooms at once, but only ` +
        `${roomCount} are configured. Add ${largest - roomCount} more room(s), or raise the batch ` +
        `count to ${neededBatches} so fewer teams present at the same time.`,
      warnings,
      advice,
    };
  }

  if (judgeCount < largest) {
    const neededBatches = smallestBatchCountFor(teamCount, judgeCount, roomCount);
    return {
      ok: false,
      error:
        `${judgeCount} judges cannot cover ${largest} teams presenting at once — each judge can only ` +
        `be in one room. ` +
        (neededBatches
          ? `Either mark ${largest - judgeCount} more first-round judge(s), or raise the batch count to ` +
            `${neededBatches} so only ${Math.ceil(teamCount / neededBatches)} teams present at a time.`
          : `Mark at least ${largest - judgeCount} more first-round judge(s).`),
      warnings,
      advice,
    };
  }

  // ---- it will schedule; what will it look like ----

  const perTeam = sizes.map((size) => ({
    size,
    // what allocateBatch will actually produce for a batch of this size
    min: Math.floor(Math.min(judgeCount, size * target) / size),
    max: Math.ceil(Math.min(judgeCount, size * target) / size),
  }));

  const globalMin = Math.min(...perTeam.map((p) => p.min));
  const globalMax = Math.max(...perTeam.map((p) => p.max));

  if (globalMin < MIN_JUDGES_PER_TEAM) {
    const needed = largest * MIN_JUDGES_PER_TEAM - judgeCount;
    warnings.push(
      `Some teams will be seen by only ${globalMin} judge. An average from one judge is that ` +
        `judge's opinion, and the final round is picked on averages.`
    );
    if (needed > 0) {
      advice.push(
        `Mark ${needed} more first-round judge(s) to give every team at least ${MIN_JUDGES_PER_TEAM}.`
      );
    }
  }

  // uneven batches are the only reason a team gets systematically less attention
  if (globalMax - globalMin >= 1 && new Set(sizes).size > 1) {
    const even = evenBatchCountsFor(teamCount, roomCount, batchCount);
    if (even.length) {
      advice.push(
        `Teams are split ${sizes.join("/")}, so the smaller batches get more judges per team. ` +
          `A batch count of ${listOf(even)} divides ${teamCount} teams evenly and removes that.`
      );
    }
  }

  // the surplus case
  const seatsWanted = sizes.reduce((sum, size) => sum + Math.min(judgeCount, size * target), 0);
  const seatsAvailable = judgeCount * sizes.length;
  if (seatsAvailable > seatsWanted) {
    const spare = Math.floor((seatsAvailable - seatsWanted) / sizes.length);
    warnings.push(
      `${judgeCount} judges is more than ${teamCount} teams need. ` +
        `Panels are capped at ${target} and roughly ${spare} judge(s) are held back per batch as spares.`
    );
    advice.push(
      "Spare judges have no assignment card. Keep them on hand for a no-show, or add them to a team " +
        "from Judging progress."
    );
  }

  return {
    ok: true,
    error: null,
    warnings,
    advice,
    batchSizes: sizes,
    judgesPerTeam: { min: globalMin, max: globalMax },
  };
}

/** "4", "4 or 5", "4, 5 or 8" -- rather than "4 or 5 or 8". */
function listOf(values) {
  if (values.length < 2) return String(values[0] ?? "");
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

/** The fewest batches that let `judgeCount` judges cover every room, or null. */
function smallestBatchCountFor(teamCount, judgeCount, roomCount) {
  for (let batches = 1; batches <= teamCount; batches++) {
    const largest = Math.ceil(teamCount / batches);
    if (largest <= judgeCount && largest <= roomCount) return batches;
  }
  return null;
}

/** Batch counts that divide the teams evenly and still fit the rooms. */
function evenBatchCountsFor(teamCount, roomCount, current) {
  const options = [];
  for (let batches = 2; batches <= Math.min(8, teamCount); batches++) {
    if (batches === current) continue;
    if (teamCount % batches !== 0) continue;
    if (teamCount / batches > roomCount) continue;
    options.push(batches);
  }
  return options.slice(0, 3);
}

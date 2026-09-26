/**
 * The things an organizer can change about a final round, before it is real.
 *
 * `applyEdit.js` for the final round. Same contract: pure, returns a new plan,
 * never mutates the one it was given, appends a summary to `edits` so the
 * publish can list what was changed by hand and `undoFinalEdit` can walk back.
 *
 * The refusals are different, because the round is. There is one room, so no
 * edit can put a judge in two places at once and no op refuses on a clash.
 * Nor does scoring a team in round one bar anybody from it -- the finalists
 * present in sequence to one room, so everyone there scores everyone.
 *
 * Nor is `pool` a gate. It is who the BUILD seated -- the marked, checked-in
 * judges -- and an organizer may put any registered judge on a panel by hand.
 * That is the only way to seat somebody who registered, or was marked, after
 * the plan was built, and refusing it was a dead end with nothing on screen to
 * explain it. A caller adding somebody from outside the pool passes their
 * record as `op.judge`, and they join `pool` so the stats, the publish and the
 * drift check all agree about who is in this final round.
 *
 * What is left to refuse is bookkeeping: a judge nobody can name, or one
 * already sitting on that team.
 */

import { slotLabel, slotsOf } from "./finalRoundPlan.js";

function clone(plan) {
  return {
    ...plan,
    assignments: Object.fromEntries(
      Object.entries(plan.assignments ?? {}).map(([id, a]) => [id, { ...a, judges: [...a.judges] }])
    ),
    edits: [...(plan.edits ?? [])],
  };
}

function fail(error) {
  return { ok: false, error };
}

/**
 * `orderBefore` is the slot order as it stood, captured on every edit.
 *
 * A move, a drop and an add all renumber teams other than the one being
 * edited, so `before` -- which holds one assignment -- cannot undo them on its
 * own. Recording the whole order costs one array of team ids and makes undo
 * uniform: put the assignment back, then put the order back.
 */
function commit(plan, op, before, summary, orderBefore) {
  plan.edits.push({ op, summary, before: before ?? null, orderBefore });
  return { ok: true, plan };
}

/** Renumber `order` to 0…n-1 in the current order, so it stays a permutation. */
function reseat(plan) {
  slotsOf(plan).forEach((slot, index) => {
    plan.assignments[slot.teamId].order = index;
  });
  return plan;
}

function judgeIn(pool, judgeId) {
  return (pool ?? []).find((judge) => judge.judgeId === judgeId) ?? null;
}

/**
 * The judge record a caller passed for somebody outside the pool.
 *
 * Both halves have to be there: an id with no name would be published to the
 * team's card and every other judge's copy as "Unnamed Judge", which is how a
 * hand edit turns into a roster nobody can read.
 */
function named(judge, judgeId) {
  if (!judge || judge.judgeId !== judgeId) return null;
  const judgeName = String(judge.judgeName ?? "").trim();
  return judgeName ? { judgeId, judgeName } : null;
}

export function applyFinalEdit(plan, op) {
  const next = clone(plan);
  const current = next.assignments[op.teamId];
  const ranked = (next.ranked ?? []).find((team) => team.teamId === op.teamId);
  const teamName = current?.teamName ?? ranked?.name ?? "that team";
  const before = current ? { ...current, judges: [...current.judges] } : null;
  const orderBefore = slotsOf(plan).map((slot) => slot.teamId);

  switch (op.type) {
    case "addJudge": {
      if (!current) return fail(`${teamName} is not in the final round.`);

      // from the pool if they are in it, otherwise from the record the caller
      // supplies -- which is what lets a hand edit reach the whole roster
      const judge = judgeIn(next.pool, op.judgeId) ?? named(op.judge, op.judgeId);
      if (!judge) {
        return fail("That judge is not a registered judge in this event.");
      }
      if (current.judges.some((entry) => entry.judgeId === op.judgeId)) {
        return fail(`${judge.judgeName} is already judging ${teamName}.`);
      }

      // into the pool as well as onto the panel, so `finalStats`, the publish
      // and `checkFinalDrift` do not each reach a different conclusion about
      // whether this judge belongs here
      if (!judgeIn(next.pool, judge.judgeId)) next.pool = [...(next.pool ?? []), judge];

      current.judges.push({ judgeId: judge.judgeId, judgeName: judge.judgeName });
      return commit(next, op, before, `Added ${judge.judgeName} to ${teamName}`, orderBefore);
    }

    case "removeJudge": {
      if (!current) return fail(`${teamName} is not in the final round.`);

      const seated = current.judges.find((entry) => entry.judgeId === op.judgeId);
      if (!seated) return fail(`That judge is not judging ${teamName}.`);

      current.judges = current.judges.filter((entry) => entry.judgeId !== op.judgeId);
      return commit(next, op, before, `Removed ${seated.judgeName} from ${teamName}`, orderBefore);
    }

    case "swapJudge": {
      const out = applyFinalEdit(plan, {
        type: "removeJudge",
        teamId: op.teamId,
        judgeId: op.fromJudgeId,
      });
      if (!out.ok) return out;

      const inn = applyFinalEdit(out.plan, {
        type: "addJudge",
        teamId: op.teamId,
        judgeId: op.toJudgeId,
      });
      if (!inn.ok) return inn;

      // two operations, one entry, so undo walks the swap back in one step
      const merged = { ...inn.plan, edits: [...(plan.edits ?? [])] };
      const fromName = judgeIn(plan.pool, op.fromJudgeId)?.judgeName ?? "a judge";
      const toName = judgeIn(plan.pool, op.toJudgeId)?.judgeName ?? "a judge";
      return commit(merged, op, before, `Swapped ${fromName} for ${toName} on ${teamName}`, orderBefore);
    }

    case "moveSlot": {
      if (!current) return fail(`${teamName} is not in the final round.`);

      const slots = slotsOf(next);
      const target = Number(op.order);
      if (!Number.isInteger(target) || target < 0 || target >= slots.length) {
        return fail(`There is no slot ${Number.isFinite(target) ? target + 1 : op.order}.`);
      }
      if (target === current.order) return fail(`${teamName} is already in ${slotLabel(target)}.`);

      const without = slots.filter((slot) => slot.teamId !== op.teamId);
      without.splice(target, 0, current);
      without.forEach((slot, index) => {
        next.assignments[slot.teamId].order = index;
      });

      return commit(next, op, before, `Moved ${teamName} to ${slotLabel(target)}`, orderBefore);
    }

    case "dropTeam": {
      if (!current) return fail(`${teamName} is not in the final round.`);

      delete next.assignments[op.teamId];
      reseat(next);
      return commit(next, op, before, `Dropped ${teamName} from the final round`, orderBefore);
    }

    case "addTeam": {
      if (current) return fail(`${teamName} is already in the final round.`);
      if (!ranked) return fail("That team is not in the ranking, so it cannot be a finalist.");

      next.assignments[op.teamId] = {
        teamId: op.teamId,
        teamName: ranked.name,
        order: slotsOf(next).length,
        judges: [...(next.pool ?? [])],
      };
      reseat(next);
      return commit(next, op, before, `Added ${ranked.name} to the final round`, orderBefore);
    }

    case "setRoom": {
      const room = String(op.room ?? "").trim();
      if (!room) return fail("Give the final round a room.");
      if (room === next.room) return fail(`The final round is already in ${room}.`);

      const wasIn = next.room;
      next.room = room;
      return commit(next, op, { room: wasIn }, `Moved the final round to ${room}`, orderBefore);
    }

    default:
      return fail(`Unknown edit "${op.type}".`);
  }
}

/**
 * Walk the newest edit back. Repeated, this returns the plan to what the build
 * produced. Returns null when there is nothing left to undo.
 */
export function undoFinalEdit(plan) {
  const edits = plan.edits ?? [];
  if (!edits.length) return null;

  const last = edits[edits.length - 1];
  const next = clone(plan);
  next.edits = edits.slice(0, -1);

  if (last.op.type === "setRoom") {
    next.room = last.before?.room ?? next.room;
    return next;
  }

  if (last.op.type === "addTeam") {
    delete next.assignments[last.op.teamId];
  } else if (last.before) {
    next.assignments[last.op.teamId] = { ...last.before, judges: [...last.before.judges] };
  } else {
    // no `before` and not an add: the assignment did not exist, so it should not
    delete next.assignments[last.op.teamId];
  }

  // then the order, which a move, a drop or an add changed for other teams too
  (last.orderBefore ?? []).forEach((teamId, index) => {
    if (next.assignments[teamId]) next.assignments[teamId].order = index;
  });
  return reseat(next);
}

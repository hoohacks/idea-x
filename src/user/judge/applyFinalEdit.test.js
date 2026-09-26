/**
 * The final round edit layer, and the invariants that must hold whatever an
 * organizer does to a plan.
 *
 * The randomised walk at the bottom is the point of the file. Hand-written
 * cases pin the refusals; only a walk catches "twelve edits in, `order` is no
 * longer a permutation and two teams share Slot 3".
 */
import { applyFinalEdit, undoFinalEdit } from "./applyFinalEdit";
import { buildFinalPlan, slotsOf, finalStats } from "./finalRoundPlan";

const pool = [
  { judgeId: "j1", judgeName: "Ada" },
  { judgeId: "j2", judgeName: "Alan" },
  { judgeId: "j3", judgeName: "Grace" },
];

const ranked = [
  { teamId: "t1", name: "Alpha", averageScore: 36, fundableVotes: 2, judgeCount: 3 },
  { teamId: "t2", name: "Beta", averageScore: 34, fundableVotes: 1, judgeCount: 3 },
  { teamId: "t3", name: "Gamma", averageScore: 30, fundableVotes: 1, judgeCount: 2 },
  { teamId: "t4", name: "Delta", averageScore: 28, fundableVotes: 0, judgeCount: 2 },
  { teamId: "t5", name: "Epsilon", averageScore: 20, fundableVotes: 0, judgeCount: 2 },
];

// No scoresByTeam: the final round is one room with the teams in sequence, so
// everyone present scores everyone and a round-one card bars nobody. The plan
// builder no longer reads the first-round cards at all.
const plan = () => buildFinalPlan({ ranked, pool, size: 4, room: "Rice 011" });

describe("building the plan an organizer starts from", () => {
  test("the cut is the top `size`, in rank order", () => {
    expect(slotsOf(plan()).map((s) => s.teamName)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  test("panels are prefilled with the whole pool", () => {
    const slots = slotsOf(plan());
    expect(slots[0].judges.map((j) => j.judgeId)).toEqual(["j1", "j2", "j3"]);
    expect(slots[2].judges.map((j) => j.judgeId)).toEqual(["j1", "j2", "j3"]);
  });

  test("a judge who scored that team in round one is still seated on it", () => {
    const alpha = slotsOf(plan()).find((slot) => slot.teamName === "Alpha");
    expect(alpha.judges.map((j) => j.judgeId)).toContain("j1");
  });

  test("the basis fingerprints every ranked team, not just the finalists", () => {
    expect(Object.keys(plan().basis.cardCounts).sort()).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });
});

describe("judges on a panel", () => {
  test("a judge who scored that team in round one can be added back", () => {
    // seated by the prefill, so removing is what makes room for the add
    const removed = applyFinalEdit(plan(), { type: "removeJudge", teamId: "t1", judgeId: "j1" });
    expect(removed.ok).toBe(true);

    const result = applyFinalEdit(removed.plan, { type: "addJudge", teamId: "t1", judgeId: "j1" });
    expect(result.ok).toBe(true);
    expect(result.plan.assignments.t1.judges.map((j) => j.judgeId)).toContain("j1");
  });

  test("the same judge is fine on a team they did not score", () => {
    const start = applyFinalEdit(plan(), { type: "removeJudge", teamId: "t3", judgeId: "j1" }).plan;
    const result = applyFinalEdit(start, { type: "addJudge", teamId: "t3", judgeId: "j1" });
    expect(result.ok).toBe(true);
  });

  test("somebody the caller cannot name is refused", () => {
    const result = applyFinalEdit(plan(), { type: "addJudge", teamId: "t1", judgeId: "nobody" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a registered judge/i);
  });

  describe("a judge from outside the prefilled pool", () => {
    // The pool is who gets SEATED when the plan is built -- the marked,
    // checked-in judges. Any registered judge can be put on a panel by hand,
    // which is the only way to seat somebody who registered, or was marked,
    // after the plan was built.
    const outsider = { judgeId: "j9", judgeName: "Katherine" };

    test("can be added when the caller names them", () => {
      const result = applyFinalEdit(plan(), {
        type: "addJudge", teamId: "t1", judgeId: "j9", judge: outsider,
      });

      expect(result.ok).toBe(true);
      expect(result.plan.assignments.t1.judges.map((j) => j.judgeId)).toContain("j9");
    });

    test("joins the pool, so the publish and the stats agree about them", () => {
      const next = applyFinalEdit(plan(), {
        type: "addJudge", teamId: "t1", judgeId: "j9", judge: outsider,
      }).plan;

      expect(next.pool.map((j) => j.judgeId)).toContain("j9");
    });

    test("joining the pool does not seat them on any other team", () => {
      const next = applyFinalEdit(plan(), {
        type: "addJudge", teamId: "t1", judgeId: "j9", judge: outsider,
      }).plan;

      expect(next.assignments.t2.judges.map((j) => j.judgeId)).not.toContain("j9");
    });

    test("undo takes them back off the panel", () => {
      const next = applyFinalEdit(plan(), {
        type: "addJudge", teamId: "t1", judgeId: "j9", judge: outsider,
      }).plan;

      expect(undoFinalEdit(next).assignments.t1.judges.map((j) => j.judgeId)).not.toContain("j9");
    });
  });

  test("removing leaves the rest of the panel alone", () => {
    const next = applyFinalEdit(plan(), { type: "removeJudge", teamId: "t2", judgeId: "j1" }).plan;
    expect(next.assignments.t2.judges.map((j) => j.judgeId)).toEqual(["j2", "j3"]);
    expect(next.assignments.t3.judges).toHaveLength(3);
  });

  test("swapping in somebody already on the panel is refused", () => {
    const next = applyFinalEdit(plan(), {
      type: "swapJudge",
      teamId: "t2",
      fromJudgeId: "j1",
      toJudgeId: "j2",
    });
    expect(next.ok).toBe(false); // the prefill already seated j2 on Beta
  });

  test("a legal swap replaces one judge with another in a single entry", () => {
    const thinned = applyFinalEdit(plan(), { type: "removeJudge", teamId: "t3", judgeId: "j2" }).plan;
    const swapped = applyFinalEdit(thinned, {
      type: "swapJudge",
      teamId: "t3",
      fromJudgeId: "j1",
      toJudgeId: "j2",
    });

    expect(swapped.ok).toBe(true);
    expect(swapped.plan.edits).toHaveLength(2);
    expect(swapped.plan.assignments.t3.judges.map((j) => j.judgeId).sort()).toEqual(["j2", "j3"]);
  });

  test("a team can be left with nobody, and the stats say so", () => {
    let next = plan();
    for (const judgeId of ["j1", "j2", "j3"]) {
      next = applyFinalEdit(next, { type: "removeJudge", teamId: "t1", judgeId }).plan;
    }
    expect(finalStats(next).unjudged).toEqual(["Alpha"]);
  });
});

describe("the running order", () => {
  test("moving a team shifts everything between", () => {
    const next = applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: 2 }).plan;
    expect(slotsOf(next).map((s) => s.teamName)).toEqual(["Beta", "Gamma", "Alpha", "Delta"]);
  });

  test("a slot that does not exist is refused", () => {
    expect(applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: 9 }).ok).toBe(false);
    expect(applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: -1 }).ok).toBe(false);
  });

  test("moving a team to where it already is is refused rather than logged", () => {
    expect(applyFinalEdit(plan(), { type: "moveSlot", teamId: "t1", order: 0 }).ok).toBe(false);
  });

  test("dropping a team closes the gap", () => {
    const next = applyFinalEdit(plan(), { type: "dropTeam", teamId: "t2" }).plan;
    expect(slotsOf(next).map((s) => s.order)).toEqual([0, 1, 2]);
    expect(slotsOf(next).map((s) => s.teamName)).toEqual(["Alpha", "Gamma", "Delta"]);
  });

  test("a team from below the line can be added, panel prefilled", () => {
    const next = applyFinalEdit(plan(), { type: "addTeam", teamId: "t5" }).plan;
    expect(slotsOf(next).map((s) => s.teamName)).toEqual([
      "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
    ]);
    expect(next.assignments.t5.judges).toHaveLength(3);
  });

  test("a team that is not ranked cannot be added", () => {
    expect(applyFinalEdit(plan(), { type: "addTeam", teamId: "t99" }).ok).toBe(false);
  });
});

describe("the room", () => {
  test("is one room for the whole round", () => {
    const next = applyFinalEdit(plan(), { type: "setRoom", room: "Rice 130" }).plan;
    expect(next.room).toBe("Rice 130");
  });

  test("an empty room is refused", () => {
    expect(applyFinalEdit(plan(), { type: "setRoom", room: "   " }).ok).toBe(false);
  });

  test("undo puts the old room back", () => {
    const next = applyFinalEdit(plan(), { type: "setRoom", room: "Rice 130" }).plan;
    expect(undoFinalEdit(next).room).toBe("Rice 011");
  });
});

describe("undo", () => {
  test("nothing to undo is null, not a throw", () => {
    expect(undoFinalEdit(plan())).toBeNull();
  });

  test("a move is walked back for every team it renumbered", () => {
    const start = plan();
    const moved = applyFinalEdit(start, { type: "moveSlot", teamId: "t1", order: 3 }).plan;
    const back = undoFinalEdit(moved);

    expect(slotsOf(back).map((s) => s.teamName)).toEqual(slotsOf(start).map((s) => s.teamName));
  });

  test("a dropped team comes back in its old slot", () => {
    const start = plan();
    const dropped = applyFinalEdit(start, { type: "dropTeam", teamId: "t2" }).plan;
    const back = undoFinalEdit(dropped);

    expect(slotsOf(back).map((s) => s.teamName)).toEqual(slotsOf(start).map((s) => s.teamName));
  });
});

/**
 * 200 random walks. Every edit either refuses or leaves the plan in a state
 * that still satisfies all of these -- and undoing the whole walk returns the
 * plan the build produced.
 */
describe("invariants hold across a randomised walk", () => {
  function randomOp(rand, plan) {
    const slots = slotsOf(plan);
    const teamIds = slots.map((s) => s.teamId);
    const anyTeam = () => teamIds[Math.floor(rand() * teamIds.length)] ?? "t1";
    const anyJudge = () => pool[Math.floor(rand() * pool.length)].judgeId;

    switch (Math.floor(rand() * 6)) {
      case 0: return { type: "addJudge", teamId: anyTeam(), judgeId: anyJudge() };
      case 1: return { type: "removeJudge", teamId: anyTeam(), judgeId: anyJudge() };
      case 2: return { type: "swapJudge", teamId: anyTeam(), fromJudgeId: anyJudge(), toJudgeId: anyJudge() };
      case 3: return { type: "moveSlot", teamId: anyTeam(), order: Math.floor(rand() * slots.length) };
      case 4: return { type: "dropTeam", teamId: anyTeam() };
      default: return { type: "addTeam", teamId: ranked[Math.floor(rand() * ranked.length)].teamId };
    }
  }

  // deterministic, so a failure can be reproduced from the seed in the message
  function seeded(seed) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  test.each(Array.from({ length: 200 }, (_, i) => i))("walk %i", (seed) => {
    const rand = seeded(seed + 1);
    const start = plan();
    let current = start;

    for (let step = 0; step < 12; step++) {
      const result = applyFinalEdit(current, randomOp(rand, current));
      if (!result.ok) continue;
      current = result.plan;

      const slots = slotsOf(current);

      // order is a permutation of 0…n-1
      expect(slots.map((s) => s.order)).toEqual(slots.map((_, i) => i));

      // no team is in the final round twice, and every one of them is ranked
      const ids = slots.map((s) => s.teamId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(ranked.some((t) => t.teamId === id)).toBe(true);

      for (const slot of slots) {
        // nobody sits on a panel twice
        const judgeIds = slot.judges.map((j) => j.judgeId);
        expect(new Set(judgeIds).size).toBe(judgeIds.length);

        // nobody on a panel is outside the pool
        for (const judgeId of judgeIds) {
          expect(pool.some((j) => j.judgeId === judgeId)).toBe(true);
        }
      }
    }

    // and it all walks back to what the build produced
    let unwound = current;
    let back = undoFinalEdit(unwound);
    while (back) {
      unwound = back;
      back = undoFinalEdit(unwound);
    }

    expect(slotsOf(unwound).map((s) => [s.teamId, s.order, s.judges.map((j) => j.judgeId)]))
      .toEqual(slotsOf(start).map((s) => [s.teamId, s.order, s.judges.map((j) => j.judgeId)]));
    expect(unwound.room).toBe(start.room);
  });
});

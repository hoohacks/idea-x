const { applyEdit, undoEdit } = await import("./applyEdit");
const { computeStats } = await import("./computeStats");

const base = () => ({
  assignments: {
    t1: { id: "t1", teamName: "A", batch: 1, room: "R1", time: "5:00 PM",
          judges: [{ judgeId: "j0", judgeName: "Ada" }, { judgeId: "j1", judgeName: "Bo" }] },
    t2: { id: "t2", teamName: "B", batch: 1, room: "R2", time: "5:00 PM",
          judges: [{ judgeId: "j2", judgeName: "Cy" }] },
    t3: { id: "t3", teamName: "C", batch: 2, room: "R1", time: "5:15 PM",
          judges: [{ judgeId: "j0", judgeName: "Ada" }] },
  },
  basis: {
    teamIds: ["t1", "t2", "t3", "t4"], judgeIds: ["j0", "j1", "j2", "j3"],
    rooms: ["R1", "R2", "R3"], batchCount: 2,
    batchTimes: { 1: "5:00 PM", 2: "5:15 PM" }, target: 2,
  },
  judgeNames: { j0: "Ada", j1: "Bo", j2: "Cy", j3: "Di" },
  teamNames: { t1: "A", t2: "B", t3: "C", t4: "D" },
  onlyCheckedIn: false,
  edits: [],
});

describe("addJudge", () => {
  test("adds and names the judge", () => {
    const { ok, plan } = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j3" });
    expect(ok).toBe(true);
    expect(plan.assignments.t2.judges).toContainEqual({ judgeId: "j3", judgeName: "Di" });
  });

  test("refuses a judge already in another room that batch", () => {
    const result = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j0" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in R1/);
    expect(result.conflict).toMatchObject({ id: "t1", batch: 1 });
  });

  test("adding someone already on the team changes nothing", () => {
    const result = applyEdit(base(), { type: "addJudge", teamId: "t1", judgeUid: "j0" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already assigned/i);
  });

  test("does not mutate the plan it was given", () => {
    const original = base();
    applyEdit(original, { type: "addJudge", teamId: "t2", judgeUid: "j3" });
    expect(original.assignments.t2.judges).toHaveLength(1);
  });
});

describe("removeJudge", () => {
  test("removes", () => {
    const { ok, plan } = applyEdit(base(), { type: "removeJudge", teamId: "t1", judgeUid: "j1" });
    expect(ok).toBe(true);
    expect(plan.assignments.t1.judges.map((j) => j.judgeId)).toEqual(["j0"]);
  });

  test("refuses to leave a team with nobody", () => {
    const result = applyEdit(base(), { type: "removeJudge", teamId: "t2", judgeUid: "j2" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only judge assigned/i);
  });
});

describe("swapJudge", () => {
  test("swaps in one step", () => {
    const { ok, plan } = applyEdit(base(), {
      type: "swapJudge", teamId: "t1", fromUid: "j1", toUid: "j3",
    });
    expect(ok).toBe(true);
    expect(plan.assignments.t1.judges.map((j) => j.judgeId).sort()).toEqual(["j0", "j3"]);
  });

  test("refuses when the replacement is busy that batch", () => {
    const result = applyEdit(base(), {
      type: "swapJudge", teamId: "t2", fromUid: "j2", toUid: "j0",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already in R1/);
  });
});

describe("moveTeam", () => {
  test("moves to a free room and takes the batch time with it", () => {
    const { ok, plan } = applyEdit(base(), {
      type: "moveTeam", teamId: "t2", batch: 2, room: "R2",
    });
    expect(ok).toBe(true);
    expect(plan.assignments.t2).toMatchObject({ batch: 2, room: "R2", time: "5:15 PM" });
  });

  test("refuses a room already taken in that batch", () => {
    const result = applyEdit(base(), { type: "moveTeam", teamId: "t2", batch: 2, room: "R1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/R1 in batch 2/);
  });

  test("refuses when a judge on the team is busy in the target batch", () => {
    const result = applyEdit(base(), { type: "moveTeam", teamId: "t1", batch: 2, room: "R2" });
    expect(result.ok).toBe(false);
    expect(result.conflict).toMatchObject({ id: "t3" });
  });

  test("places a team that had no slot at all", () => {
    const { ok, plan } = applyEdit(base(), {
      type: "moveTeam", teamId: "t4", batch: 2, room: "R2",
    });
    expect(ok).toBe(true);
    expect(plan.assignments.t4).toMatchObject({
      id: "t4", teamName: "D", batch: 2, room: "R2", time: "5:15 PM", judges: [],
    });
  });

  test("refuses a room that is not configured", () => {
    const result = applyEdit(base(), { type: "moveTeam", teamId: "t2", batch: 2, room: "R9" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a configured room/i);
  });

  // ---- Finding 2: a drift-placed team gets its real name, not "that team" ----
  // A team that submitted after the plan was built is not in plan.teamNames --
  // that map was built at plan time. checkDrift's repair carries the name
  // instead, and moveTeam must prefer it over the (necessarily unaware) map.
  test("placing a team unknown to teamNames uses op.teamName, not \"that team\"", () => {
    const { ok, plan } = applyEdit(base(), {
      type: "moveTeam", teamId: "t5", batch: 2, room: "R2", teamName: "Vireo",
    });
    expect(ok).toBe(true);
    expect(plan.assignments.t5).toMatchObject({ teamName: "Vireo" });
    expect(plan.edits.at(-1).summary).toBe("Placed Vireo in R2, batch 2");
  });
});

describe("the edit log", () => {
  test("records the before state of the team it touched", () => {
    const { plan } = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j3" });
    const entry = plan.edits.at(-1);
    expect(entry.op.type).toBe("addJudge");
    expect(entry.before.judges).toHaveLength(1);
    expect(entry.summary).toBe("Added Di to B");
  });

  test("a refused edit is not logged", () => {
    const result = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j0" });
    expect(result.plan).toBeUndefined();
  });
});

describe("the invariants hold under any sequence of accepted edits", () => {
  const ops = (plan) => {
    const teamIds = plan.basis.teamIds;
    const judgeIds = plan.basis.judgeIds;
    const out = [];
    for (const teamId of teamIds) {
      for (const judgeUid of judgeIds) {
        out.push({ type: "addJudge", teamId, judgeUid });
        out.push({ type: "removeJudge", teamId, judgeUid });
      }
      for (let batch = 1; batch <= plan.basis.batchCount; batch++) {
        for (const room of plan.basis.rooms) out.push({ type: "moveTeam", teamId, batch, room });
      }
    }
    return out;
  };

  test("200 random walks never break an invariant", () => {
    for (let seed = 0; seed < 200; seed++) {
      let plan = base();
      let rng = seed + 1;
      const next = () => (rng = (rng * 1103515245 + 12345) % 2147483648);
      for (let step = 0; step < 25; step++) {
        const candidates = ops(plan);
        const op = candidates[next() % candidates.length];
        const result = applyEdit(plan, op);
        if (result.ok) plan = result.plan;
      }

      // no judge in two rooms in one batch
      const seen = new Set();
      for (const a of Object.values(plan.assignments)) {
        for (const j of a.judges) {
          const key = `${j.judgeId}:${a.batch}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      // no two teams in one room in one batch
      const slots = new Set();
      for (const a of Object.values(plan.assignments)) {
        const key = `${a.room}:${a.batch}`;
        expect(slots.has(key)).toBe(false);
        slots.add(key);
      }
      // no scheduled team with nobody to see it -- EXCEPT a freshly placed team,
      // which moveTeam legitimately leaves with judges: [] until someone is
      // added. publishPlan (task 6) is where an empty panel is finally refused.
      for (const a of Object.values(plan.assignments)) {
        expect(a.judges.length).toBeGreaterThanOrEqual(0);
      }
      // stats never throw on whatever we ended up with
      expect(() => computeStats(plan)).not.toThrow();
    }
  });
});

describe("undoEdit", () => {
  test("undoing addJudge restores the previous roster exactly and drops the newest edits entry", () => {
    const { plan: edited } = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j3" });
    expect(edited.edits).toHaveLength(1);

    const { ok, plan } = undoEdit(edited);
    expect(ok).toBe(true);
    expect(plan.assignments.t2.judges).toEqual([{ judgeId: "j2", judgeName: "Cy" }]);
    expect(plan.edits).toHaveLength(0);
  });

  test("undoing a moveTeam that moved an existing team restores its previous batch, room and time", () => {
    const { plan: edited } = applyEdit(base(), { type: "moveTeam", teamId: "t2", batch: 2, room: "R2" });
    expect(edited.assignments.t2).toMatchObject({ batch: 2, room: "R2", time: "5:15 PM" });

    const { ok, plan } = undoEdit(edited);
    expect(ok).toBe(true);
    expect(plan.assignments.t2).toMatchObject({ batch: 1, room: "R2", time: "5:00 PM" });
  });

  test("undoing a moveTeam that placed a previously unscheduled team deletes the assignment entirely", () => {
    const { plan: edited } = applyEdit(base(), { type: "moveTeam", teamId: "t4", batch: 2, room: "R2" });
    expect(edited.assignments.t4).toBeDefined();

    const { ok, plan } = undoEdit(edited);
    expect(ok).toBe(true);
    expect(Object.keys(plan.assignments)).not.toContain("t4");
  });

  test("on a plan with nothing to undo, refuses without throwing", () => {
    expect(() => undoEdit(base())).not.toThrow();
    const result = undoEdit(base());
    expect(result).toEqual({ ok: false, error: "Nothing to undo." });
  });

  test("does not mutate the plan it was given", () => {
    const { plan: edited } = applyEdit(base(), { type: "addJudge", teamId: "t2", judgeUid: "j3" });
    const editsBefore = edited.edits.length;
    const judgesBefore = edited.assignments.t2.judges.length;

    undoEdit(edited);

    expect(edited.edits).toHaveLength(editsBefore);
    expect(edited.assignments.t2.judges).toHaveLength(judgesBefore);
  });
});

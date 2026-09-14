/**
 * Has the event moved since the final round was planned?
 *
 * The split that matters is blocking versus advisory. Blocking means publishing
 * would write something nobody reviewed, and it comes with a repair so an
 * organizer does not have to rebuild and lose their edits. Advisory is shown
 * and published anyway.
 *
 * The score check is the one to get right, and it is checked across every
 * *ranked* team rather than just the finalists: a card landing on the team just
 * below the cut line changes that team's average, not any finalist's, and can
 * lift it above one. Nothing about the finalist list looks wrong in that case,
 * which is exactly why it has to be caught here.
 */
import { checkFinalDrift, blockingOnly, BLOCKING, ADVISORY } from "./checkFinalDrift";

const plan = (over = {}) => ({
  room: "Rice 011",
  ranked: [
    { teamId: "t1", name: "Alpha" },
    { teamId: "t2", name: "Beta" },
    { teamId: "t3", name: "Gamma" },
    { teamId: "t9", name: "Just Missed" },
  ],
  assignments: {
    t1: { teamId: "t1", teamName: "Alpha", order: 0, judges: [{ judgeId: "j1", judgeName: "Ada" }] },
    t2: { teamId: "t2", teamName: "Beta", order: 1, judges: [{ judgeId: "j2", judgeName: "Alan" }] },
  },
  basis: { cardCounts: { t1: 3, t2: 3, t3: 2, t9: 2 }, size: 4, room: "Rice 011" },
  ...over,
});

const live = (over = {}) => ({
  cardCounts: { t1: 3, t2: 3, t3: 2, t9: 2 },
  eligibleJudges: { j1: true, j2: true, j3: true },
  submitted: { t1: true, t2: true, t3: true, t9: true },
  room: "Rice 011",
  size: 4,
  ...over,
});

const kinds = (issues) => issues.map((issue) => issue.kind);

test("an event that has not moved has nothing to report", () => {
  expect(checkFinalDrift(plan(), live())).toEqual([]);
});

describe("a card arriving after the plan was built", () => {
  test("on a finalist, blocks", () => {
    const issues = checkFinalDrift(plan(), live({ cardCounts: { t1: 4, t2: 3, t3: 2, t9: 2 } }));

    expect(kinds(issues)).toEqual(["scores"]);
    expect(issues[0].level).toBe(BLOCKING);
    expect(issues[0].repair).toBe("rerank");
    expect(issues[0].message).toMatch(/Alpha/);
  });

  /**
   * The dangerous half. Nothing about the finalists looks wrong, and the team
   * that earned a place does not get one.
   */
  test("on a team just below the cut, also blocks", () => {
    const issues = checkFinalDrift(plan(), live({ cardCounts: { t1: 3, t2: 3, t3: 2, t9: 3 } }));

    expect(issues).toHaveLength(1);
    expect(issues[0].teamId).toBe("t9");
    expect(issues[0].message).toMatch(/Just Missed/);
  });

  test("a card removed counts too, since the average moved either way", () => {
    const issues = checkFinalDrift(plan(), live({ cardCounts: { t1: 2, t2: 3, t3: 2, t9: 2 } }));
    expect(kinds(issues)).toContain("scores");
  });

  test("every ranked team is checked, not only the ones with a slot", () => {
    const issues = checkFinalDrift(plan(), live({ cardCounts: { t1: 3, t2: 3, t3: 9, t9: 2 } }));
    expect(issues[0].teamId).toBe("t3");
  });
});

describe("a finalist that is no longer there", () => {
  test("withdrawing blocks, with a drop repair", () => {
    const issues = checkFinalDrift(plan(), live({ submitted: { t1: true, t2: false, t3: true, t9: true } }));

    expect(kinds(issues)).toEqual(["team"]);
    expect(issues[0].repair).toBe("dropTeam");
    expect(issues[0].teamId).toBe("t2");
    expect(issues[0].message).toMatch(/Beta/);
  });

  test("a team that was never in the cut is not reported", () => {
    const issues = checkFinalDrift(plan(), live({ submitted: { t1: true, t2: true, t3: false, t9: true } }));
    expect(kinds(issues)).not.toContain("team");
  });
});

describe("a judge who is no longer eligible", () => {
  test("blocks, naming the judge and the team", () => {
    const issues = checkFinalDrift(plan(), live({ eligibleJudges: { j1: true } }));

    expect(kinds(issues)).toEqual(["judge"]);
    expect(issues[0].repair).toBe("removeJudge");
    expect(issues[0].judgeId).toBe("j2");
    expect(issues[0].message).toMatch(/Alan/);
    expect(issues[0].message).toMatch(/Beta/);
  });

  test("the message does not claim round one is what makes them eligible", () => {
    // an industry judge marked for the final round only is eligible without
    // ever having been a first-round judge, so naming that mark misdescribes
    // the repair an organizer has to make
    const issues = checkFinalDrift(plan(), live({ eligibleJudges: { j1: true } }));
    expect(issues[0].message).not.toMatch(/first-round judge/);
    expect(issues[0].message).toMatch(/final round/i);
  });

  test("one issue per seat, so each has its own repair", () => {
    const twoSeats = plan({
      assignments: {
        t1: {
          teamId: "t1",
          teamName: "Alpha",
          order: 0,
          judges: [
            { judgeId: "j1", judgeName: "Ada" },
            { judgeId: "j2", judgeName: "Alan" },
          ],
        },
      },
    });
    const issues = checkFinalDrift(twoSeats, live({ eligibleJudges: {} }));

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.judgeId).sort()).toEqual(["j1", "j2"]);
  });
});

describe("configuration moving under the plan", () => {
  test("a changed room is advisory, and offers to apply itself", () => {
    const issues = checkFinalDrift(plan(), live({ room: "Rice 130" }));

    expect(issues[0].level).toBe(ADVISORY);
    expect(issues[0].repair).toBe("setRoom");
    expect(issues[0].room).toBe("Rice 130");
    expect(blockingOnly(issues)).toEqual([]);
  });

  test("a room the organizer already set on the plan is not reported back at them", () => {
    const moved = plan({ room: "Rice 130" });
    expect(kinds(checkFinalDrift(moved, live({ room: "Rice 130" })))).not.toContain("room");
  });

  test("a changed cut size is advisory, since the cut in the draft is explicit", () => {
    const issues = checkFinalDrift(plan(), live({ size: 6 }));

    expect(issues[0].kind).toBe("size");
    expect(issues[0].level).toBe(ADVISORY);
    expect(blockingOnly(issues)).toEqual([]);
  });
});

describe("blockingOnly", () => {
  test("keeps what must stop a publish and drops what must not", () => {
    const issues = checkFinalDrift(
      plan(),
      live({ room: "Rice 130", submitted: { t1: true, t2: false, t3: true, t9: true } })
    );

    expect(kinds(issues).sort()).toEqual(["room", "team"]);
    expect(kinds(blockingOnly(issues))).toEqual(["team"]);
  });

  test("nothing at all is not a blocker", () => {
    expect(blockingOnly([])).toEqual([]);
    expect(blockingOnly(undefined)).toEqual([]);
  });
});

test("a plan with no basis is not treated as drift-free by accident", () => {
  // an empty basis means nothing to compare, which must not read as "all clear"
  // for the judge and team checks that do not depend on it
  const issues = checkFinalDrift(plan({ basis: {} }), live({ eligibleJudges: {} }));
  expect(kinds(issues)).toContain("judge");
});

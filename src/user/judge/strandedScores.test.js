import { strandedBy, describeStranded } from "./strandedScores";

/**
 * Scores are keyed by team and judge. Moving an assignment does not move the
 * card, so a card whose pair no longer exists keeps counting toward that
 * team's average while belonging to a judge who will never be in the room.
 * That average is what the final-round cut is made from.
 */
const plan = {
  assignments: {
    t1: { id: "t1", teamName: "Lumen", judges: [{ judgeId: "j1" }, { judgeId: "j2" }] },
    t2: { id: "t2", teamName: "Beta", judges: [{ judgeId: "j3" }] },
  },
  judgeNames: { j1: "Ada", j2: "Alan", j3: "Grace", j9: "Katherine" },
  teamNames: { t1: "Lumen", t2: "Beta", t9: "Vireo" },
};

describe("which cards a plan would strand", () => {
  test("a card whose judge is still on that team survives", () => {
    expect(strandedBy(plan, { t1: { j1: {} } })).toEqual([]);
  });

  test("a card whose judge moved off that team is stranded", () => {
    expect(strandedBy(plan, { t1: { j3: {} } })).toEqual([{ teamId: "t1", judgeUid: "j3" }]);
  });

  test("a card for a team the plan does not place at all is stranded", () => {
    expect(strandedBy(plan, { t9: { j1: {} } })).toEqual([{ teamId: "t9", judgeUid: "j1" }]);
  });

  test("the same judge can be stranded on one team and fine on another", () => {
    const out = strandedBy(plan, { t1: { j1: {} }, t2: { j1: {} } });
    expect(out).toEqual([{ teamId: "t2", judgeUid: "j1" }]);
  });

  test("no scores at all strands nothing", () => {
    expect(strandedBy(plan, {})).toEqual([]);
    expect(strandedBy(plan, undefined)).toEqual([]);
  });

  test("a plan with no assignments strands every card", () => {
    expect(strandedBy({}, { t1: { j1: {} } })).toEqual([{ teamId: "t1", judgeUid: "j1" }]);
  });
});

describe("naming them for the organizer", () => {
  test("it names the team and the judge, not their ids", () => {
    const text = describeStranded([{ teamId: "t1", judgeUid: "j3" }], plan);
    expect(text).toMatch(/Lumen/);
    expect(text).toMatch(/Grace/);
  });

  test("a team the plan never placed is still named from teamNames", () => {
    expect(describeStranded([{ teamId: "t9", judgeUid: "j9" }], plan)).toMatch(/Vireo.*Katherine/);
  });

  test("an unknown id degrades to the id rather than 'undefined'", () => {
    const text = describeStranded([{ teamId: "zz", judgeUid: "qq" }], plan);
    expect(text).toMatch(/zz/);
    expect(text).not.toMatch(/undefined/);
  });

  test("a long list is truncated so the dialog stays readable", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ teamId: "t1", judgeUid: `j${i}` }));
    expect(describeStranded(many, plan)).toMatch(/and 7 more/);
  });
});

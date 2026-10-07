/**
 * How stranded score cards are found and named. strandedScores.test.js covers
 * the main cases; this covers the naming fallbacks and the five-card limit.
 */
import { strandedBy, describeStranded } from "./strandedScores";

const card = (teamId, judgeUid) => ({ teamId, judgeUid });

test("with no plan every card is stranded, and a panel with no judges keeps none", () => {
  expect(strandedBy(undefined, { t1: { a: {} } })).toEqual([card("t1", "a")]);
  expect(strandedBy({ assignments: { t1: { id: "t1" } } }, { t1: { a: {} } })).toEqual([card("t1", "a")]);
  expect(strandedBy({ assignments: {} }, undefined)).toEqual([]);
  expect(strandedBy({ assignments: {} }, { t1: null })).toEqual([]);
});

describe("naming them", () => {
  const plan = {
    assignments: { t1: { teamName: "Lantern (slot)" } },
    teamNames: { t1: "Lantern", t2: "Circles" },
    judgeNames: { a: "Ada" },
  };

  test("a team by its slot name, then its recorded name, then its id; a judge by name, then uid", () => {
    expect(describeStranded([card("t1", "a"), card("t2", "b"), card("t3", "c")], plan)).toBe(
      "Lantern (slot) by Ada, Circles by b, t3 by c"
    );
  });

  test("with no plan, ids throughout", () => {
    expect(describeStranded([card("t1", "a")], undefined)).toBe("t1 by a");
  });

  test("five are named in full; past five, the rest are counted", () => {
    const five = ["1", "2", "3", "4", "5"].map((n) => card(`t${n}`, "j"));
    expect(describeStranded(five, {})).toBe("t1 by j, t2 by j, t3 by j, t4 by j, t5 by j");
    expect(describeStranded([...five, card("t6", "j"), card("t7", "j")], {})).toBe(
      "t1 by j, t2 by j, t3 by j, t4 by j, t5 by j, and 2 more"
    );
  });

  test("none is nothing", () => {
    expect(describeStranded([], plan)).toBe("");
  });
});

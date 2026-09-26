import { judgesRoundOne, judgesEitherRound, judgePickerOptions } from "./judgeRoles";

const organizer = { firstName: "Ada", lastName: "Rivera", isRound1Judge: true, checkedIn: true };
const professor = { firstName: "Wei", lastName: "Chen", isFinalRoundJudge: true, checkedIn: false };
const both = { firstName: "Sam", lastName: "Okafor", isRound1Judge: true, isFinalRoundJudge: true };
const unmarked = { firstName: "Un", lastName: "Marked" };

describe("who counts as what", () => {
  test("only the round-one mark makes somebody a round-one judge", () => {
    expect(judgesRoundOne(organizer)).toBe(true);
    expect(judgesRoundOne(professor)).toBe(false);
    expect(judgesRoundOne(unmarked)).toBe(false);
  });

  test("either mark puts somebody in the final round", () => {
    expect(judgesEitherRound(organizer)).toBe(true);
    expect(judgesEitherRound(professor)).toBe(true);
    expect(judgesEitherRound(unmarked)).toBe(false);
  });

  test("the marks are independent, so somebody can carry both", () => {
    expect(judgesRoundOne(both)).toBe(true);
    expect(judgesEitherRound(both)).toBe(true);
  });

  test("a missing record is nobody", () => {
    expect(judgesRoundOne(undefined)).toBe(false);
    expect(judgesEitherRound(null)).toBe(false);
  });
});

describe("the options a per-team judge picker offers", () => {
  const world = { o1: organizer, p1: professor, b1: both, u1: unmarked };

  test("everyone marked for either round is offered", () => {
    expect(judgePickerOptions(world).map((option) => option.uid).sort())
      .toEqual(["b1", "o1", "p1"]);
  });

  test("somebody marked for neither round is not offered", () => {
    expect(judgePickerOptions(world).map((option) => option.uid)).not.toContain("u1");
  });

  test("a final-only judge is flagged, because seating one is a deliberate reach", () => {
    const byUid = Object.fromEntries(judgePickerOptions(world).map((o) => [o.uid, o]));
    expect(byUid.p1.finalOnly).toBe(true);
    expect(byUid.o1.finalOnly).toBe(false);
    // carrying both marks is a round-one judge, so nothing to flag
    expect(byUid.b1.finalOnly).toBe(false);
  });

  test("checked-in judges come first, then alphabetically", () => {
    expect(judgePickerOptions(world).map((option) => option.name))
      .toEqual(["Ada Rivera", "Sam Okafor", "Wei Chen"]);
  });

  test("a judge with no name still has something to click", () => {
    expect(judgePickerOptions({ x1: { isRound1Judge: true } })[0].name).toBe("Unnamed Judge");
  });

  test("no judges at all is an empty list, not a crash", () => {
    expect(judgePickerOptions(undefined)).toEqual([]);
  });
});

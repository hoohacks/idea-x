/**
 * The scanner's role-resolution and check-in-target decision, pulled out of
 * Scan.js so it can be tested without a camera or a database.
 *
 * Roles are additive (roles.js): one uid can hold both a competitor and a
 * judge record. The bug this guards against is that the scanner used to
 * resolve to whichever snapshot existed first -- competitor always won -- and
 * wrote only that one. A dual-role person's judges/{uid}/checkedIn could
 * never be set by scanning, and planSchedule.js filters round-one judges by
 * exactly that flag, so that judge was silently dropped from panel
 * allocation while the scanner told the organizer "Checked in".
 */
jest.mock("../../firebase", () => ({ database: {} }));
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: jest.fn(),
  update: jest.fn(),
}));
jest.mock("react-zxing", () => ({ useZxing: () => ({ ref: { current: null } }) }));

const { resolveCheckIn } = require("./Scan");

describe("resolveCheckIn", () => {
  test("nobody holds that code", () => {
    expect(resolveCheckIn({ competitor: null, judge: null, field: "checkedIn" })).toEqual({ found: false });
  });

  test("a competitor-only record checks in on the competitor node", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Grace", lastName: "Hopper", checkedIn: false },
      judge: null,
      field: "checkedIn",
    });
    expect(decision).toMatchObject({ found: true, name: "Grace Hopper", dual: false, alreadyDone: false, pendingRoles: ["competitors"] });
  });

  test("a competitor-only record already checked in is a repeat, not a re-write", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Grace", checkedIn: true },
      judge: null,
      field: "checkedIn",
    });
    expect(decision.alreadyDone).toBe(true);
    expect(decision.pendingRoles).toEqual([]);
  });

  test("a judge-only record checks in on the judge node", () => {
    const decision = resolveCheckIn({
      competitor: null,
      judge: { firstName: "Alan", lastName: "Turing", checkedIn: false },
      field: "checkedIn",
    });
    expect(decision).toMatchObject({ found: true, dual: false, alreadyDone: false, pendingRoles: ["judges"] });
  });

  /**
   * This is the bug. Somebody who holds both records is one person who
   * walked through one door -- the scan has to reach both, or the judge half
   * of them is invisible to planSchedule.js no matter how many times they
   * are scanned.
   */
  test("a dual-role person neither role has checked in yet gets both", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Ada", lastName: "Lovelace", checkedIn: false },
      judge: { firstName: "Ada", lastName: "Lovelace", checkedIn: false },
      field: "checkedIn",
    });
    expect(decision.found).toBe(true);
    expect(decision.dual).toBe(true);
    expect(decision.alreadyDone).toBe(false);
    expect(decision.pendingRoles.sort()).toEqual(["competitors", "judges"]);
  });

  /**
   * The exact failure described in the bug report: the competitor copy was
   * checked in (by scan or by hand), so the old code's `person[field]`
   * lookup on the competitor snapshot alone read true and called it done --
   * while the judge copy, the one planSchedule.js actually reads, was still
   * false and never got touched.
   */
  test("a dual-role person whose competitor copy is already checked in still needs the judge copy done", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Ada", checkedIn: true },
      judge: { firstName: "Ada", checkedIn: false },
      field: "checkedIn",
    });
    expect(decision.alreadyDone).toBe(false);
    expect(decision.pendingRoles).toEqual(["judges"]);
  });

  test("a dual-role person checked in on both copies is a genuine repeat", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Ada", checkedIn: true },
      judge: { firstName: "Ada", checkedIn: true },
      field: "checkedIn",
    });
    expect(decision.alreadyDone).toBe(true);
    expect(decision.pendingRoles).toEqual([]);
  });

  test("the name is filled in from whichever record has it, not blanked by the other", () => {
    // an organizer-created record has empty name fields (see roles.js);
    // preferring the competitor snapshot outright would show a blank name
    // for someone attached as a competitor after registering as a judge
    const decision = resolveCheckIn({
      competitor: { firstName: "", lastName: "", checkedIn: false },
      judge: { firstName: "Alan", lastName: "Turing", checkedIn: false },
      field: "checkedIn",
    });
    expect(decision.name).toBe("Alan Turing");
  });

  test("no name anywhere falls back rather than rendering blank", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "", lastName: "", checkedIn: false },
      judge: null,
      field: "checkedIn",
    });
    expect(decision.name).toBe("Name not on file");
  });

  test("food check-in uses the same field-driven logic", () => {
    const decision = resolveCheckIn({
      competitor: { firstName: "Grace", foodCheckIn: false },
      judge: { firstName: "Grace", foodCheckIn: true },
      field: "foodCheckIn",
    });
    expect(decision.alreadyDone).toBe(false);
    expect(decision.pendingRoles).toEqual(["competitors"]);
  });
});

/**
 * The role helpers, and the profile merge behind them.
 *
 * A person can hold more than one role, and each role is a separate record.
 * The merge is what turns them into the one `userData` the app renders, so it
 * is the place a blank field on one record can erase a real one on another.
 */
import { personName, hasRole, roleList, isAdmin, isJudge, mergeRoleProfiles, ROLES } from "./roles";

describe("role predicates", () => {
  test("a missing list is not a role", () => {
    expect(hasRole(undefined, "admin")).toBe(false);
    expect(roleList(undefined)).toEqual([]);
    expect(isAdmin(null)).toBe(false);
    expect(isJudge("judge")).toBe(false);
  });

  test("membership is membership", () => {
    expect(hasRole(["judge", "admin"], "admin")).toBe(true);
    expect(isJudge(["judge"])).toBe(true);
  });
});

describe("merging one person's role records", () => {
  const competitor = {
    firstName: "Alt", lastName: "Account", email: "alt@example.com",
    major: "CS", teamId: "t1",
  };

  test("a later record never blanks a field an earlier one filled in", () => {
    // a judge record granted from the control panel carries empty strings, not
    // absent keys -- spreading it last used to erase the name and the email,
    // which is what "all my data disappeared" looked like from the inside
    const judge = { firstName: "", lastName: "", email: "", company: "", isRound1Judge: false };

    const merged = mergeRoleProfiles([competitor, judge]);

    expect(merged.firstName).toBe("Alt");
    expect(merged.lastName).toBe("Account");
    expect(merged.email).toBe("alt@example.com");
    expect(merged.isRound1Judge).toBe(false);
    expect(merged.major).toBe("CS");
  });

  test("a real value on a later record still wins", () => {
    const judge = { firstName: "Alternate", company: "Acme" };
    const merged = mergeRoleProfiles([competitor, judge]);
    expect(merged.firstName).toBe("Alternate");
    expect(merged.company).toBe("Acme");
  });

  test("an empty field lands when nothing else supplies one", () => {
    expect(mergeRoleProfiles([{ major: "" }]).major).toBe("");
  });

  test("nothing to merge stays null, so a login with no record is still nobody", () => {
    expect(mergeRoleProfiles([null, undefined])).toBeNull();
  });

  test("a record that exists but is empty still counts as a profile", () => {
    expect(mergeRoleProfiles([{}])).toEqual({});
  });

  test("roles are merged in ROLES order", () => {
    expect(ROLES).toEqual(["competitor", "judge", "admin"]);
  });
});

/**
 * A name that is present but empty is the case that kept slipping through.
 *
 * Granting someone a role from the control panel seeds `firstName: ""` rather
 * than leaving it out, so `${first} ${last}` produced a single space -- which
 * renders as a blank row in a team roster and a blank name on the check-in
 * screen, where a volunteer is trying to confirm they scanned the right person.
 * A record missing the fields entirely produced "undefined undefined".
 */
describe("a name for display", () => {
  test("uses both parts when both are there", () => {
    expect(personName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
  });

  test("uses whichever part exists, without a stray space", () => {
    expect(personName({ firstName: "Ada", lastName: "" })).toBe("Ada");
    expect(personName({ lastName: "Lovelace" })).toBe("Lovelace");
  });

  test("an empty record falls back rather than rendering a space", () => {
    expect(personName({ firstName: "", lastName: "" }, "Name not on file")).toBe("Name not on file");
    expect(personName({}, "Name not on file")).toBe("Name not on file");
    expect(personName(null, "Name not on file")).toBe("Name not on file");
    expect(personName(undefined)).toBe("Unnamed");
  });

  test("whitespace-only names are not names", () => {
    expect(personName({ firstName: "   ", lastName: " " }, "fallback")).toBe("fallback");
  });
});

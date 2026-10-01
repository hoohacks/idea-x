/**
 * Reading a team's roster in each shape it can be stored in, and finding the
 * one child to clear when someone leaves.
 */
import { memberIds, isMember, memberRemovalPath } from "./teamMembers";

describe("who is on the roster", () => {
  test("an array, holes and all, is read by value", () => {
    expect(memberIds(["a", null, "b", ""])).toEqual(["a", "b"]);
  });

  test("a keyed set is read by key, a legacy slot by value, and a false entry not at all", () => {
    expect(memberIds({ a: true, 0: "b", c: false })).toEqual(["b", "a"]);
  });

  test("anything else is nobody", () => {
    expect(memberIds(undefined)).toEqual([]);
    expect(memberIds("a")).toEqual([]);
    expect(memberIds(7)).toEqual([]);
    expect(isMember("a", "a")).toBe(false);
    expect(isMember({ a: true }, "")).toBe(false);
  });
});

describe("what to clear when someone leaves", () => {
  test("their own key, or the legacy slot holding their uid", () => {
    expect(memberRemovalPath({ a: true, b: true }, "b")).toEqual({ key: "b", before: true });
    expect(memberRemovalPath(["x", "b"], "b")).toEqual({ key: "1", before: "b" });
  });

  test("a key that is theirs but not set to true is not a membership", () => {
    expect(memberRemovalPath({ b: false }, "b")).toBeNull();
    expect(memberRemovalPath({ b: "someone-else" }, "b")).toBeNull();
  });

  test("someone else's true key is not theirs", () => {
    expect(memberRemovalPath({ a: true }, "b")).toBeNull();
  });

  test("no uid, no roster, or a roster that is not a collection", () => {
    expect(memberRemovalPath({ a: true }, "")).toBeNull();
    expect(memberRemovalPath(null, "a")).toBeNull();
    expect(memberRemovalPath("a", "a")).toBeNull();
  });
});

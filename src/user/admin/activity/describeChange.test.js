/**
 * Rendering a before/after pair as one readable line.
 *
 * The feed is read while something is going wrong, so a change has to be
 * scannable without expanding it. Long values are summarised rather than dumped.
 */
const { describeChange } = await import("./describeChange");

describe("describing one change", () => {
  test("a scalar shows both values", () => {
    expect(describeChange({ path: "teams/t1/name", before: "Alpha", after: "Omega" }))
      .toBe("name: Alpha → Omega");
  });

  test("a boolean reads as a word, not as true/false noise", () => {
    expect(describeChange({ path: "competitors/u1/checkedIn", before: true, after: false }))
      .toBe("checkedIn: yes → no");
  });

  test("a created value shows it came from nothing", () => {
    expect(describeChange({ path: "admins/u9", before: null, after: true }))
      .toBe("u9: - → yes");
  });

  test("a deleted value shows it went to nothing", () => {
    expect(describeChange({ path: "teams/t1/schedule", before: { room: "A" }, after: null }))
      .toBe("schedule: 1 field → -");
  });

  test("an array is summarised by length, not dumped", () => {
    expect(describeChange({
      path: "config/judgingRooms",
      before: ["A", "B", "C"],
      after: ["A", "B"],
    })).toBe("judgingRooms: 3 items → 2 items");
  });

  test("a long string is truncated", () => {
    const line = describeChange({ path: "a/notes", before: "x".repeat(200), after: "short" });
    expect(line.length).toBeLessThan(80);
    expect(line).toContain("…");
  });
});

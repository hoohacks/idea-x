/**
 * The resource helpers: which links are allowed, who sees which, when the home
 * page shows them, and which icon a link gets.
 */
const {
  isResourceUrl,
  sortedResources,
  visibleResources,
  resourcesOpen,
  resourceKind,
  MAX_RESOURCE_TITLE,
  MAX_RESOURCE_DESCRIPTION,
} = await import("./resources");

describe("limits", () => {
  test("match what the rules allow", () => {
    expect(MAX_RESOURCE_TITLE).toBe(80);
    expect(MAX_RESOURCE_DESCRIPTION).toBe(140);
  });
});

describe("isResourceUrl", () => {
  test("accepts https links, with surrounding spaces", () => {
    expect(isResourceUrl("https://example.com/a?b=1")).toBe(true);
    expect(isResourceUrl("  https://youtu.be/abc  ")).toBe(true);
  });

  test.each(["http://example.com", "javascript:alert(1)", "ftp://example.com", "not a url", "https://", "", null, undefined])(
    "rejects %s",
    (value) => expect(isResourceUrl(value)).toBe(false)
  );
});

const all = {
  c: { title: "Third", url: "https://example.com/3", forJudges: false, order: 2, createdAt: 1 },
  a: { title: "First", url: "https://example.com/1", forJudges: true, order: 0, createdAt: 5 },
  b: { title: "Second", url: "https://example.com/2", forJudges: false, order: 1, createdAt: 3 },
};

describe("sortedResources", () => {
  test("lists them by order with their ids", () => {
    expect(sortedResources(all).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("breaks a tie by when it was added", () => {
    const tied = {
      x: { title: "X", url: "https://example.com", order: 1, createdAt: 9 },
      y: { title: "Y", url: "https://example.com", order: 1, createdAt: 2 },
    };
    expect(sortedResources(tied).map((r) => r.id)).toEqual(["y", "x"]);
  });

  test("skips anything without a title or link, and copes with nothing", () => {
    expect(sortedResources({ a: { title: "No link" }, b: { url: "https://example.com" } })).toEqual([]);
    expect(sortedResources(null)).toEqual([]);
    expect(sortedResources(undefined)).toEqual([]);
  });
});

describe("visibleResources", () => {
  const ids = (userTypes) => visibleResources(all, userTypes).map((r) => r.id);

  test("a competitor sees every one", () => expect(ids(["competitor"])).toEqual(["a", "b", "c"]));
  test("a judge sees only those for judges", () => expect(ids(["judge"])).toEqual(["a"]));
  test("an admin sees every one", () => expect(ids(["admin"])).toEqual(["a", "b", "c"]));
  test("someone who is both competitor and judge sees every one", () => {
    expect(ids(["competitor", "judge"])).toEqual(["a", "b", "c"]);
  });
  test("nobody, or an organizer alone, sees none", () => {
    expect(ids([])).toEqual([]);
    expect(ids(undefined)).toEqual([]);
    expect(ids(["organizer"])).toEqual([]);
  });
});

describe("resourcesOpen", () => {
  // 10:00 am Eastern on the event day
  const start = "2026-10-25T10:00:00-04:00";
  const at = (iso) => new Date(iso);

  test("closed before the event starts", () => {
    expect(resourcesOpen(start, at("2026-10-25T09:59:59-04:00"))).toBe(false);
  });
  test("open at the start", () => {
    expect(resourcesOpen(start, at("2026-10-25T10:00:00-04:00"))).toBe(true);
  });
  test("still open after 7:30 pm the same day, for a late final round", () => {
    expect(resourcesOpen(start, at("2026-10-25T19:45:00-04:00"))).toBe(true);
    expect(resourcesOpen(start, at("2026-10-25T23:59:00-04:00"))).toBe(true);
  });
  test("closed the next day", () => {
    expect(resourcesOpen(start, at("2026-10-26T00:00:00-04:00"))).toBe(false);
  });
  test("showNow opens it any time", () => {
    expect(resourcesOpen(start, at("2026-10-01T09:00:00-04:00"), true)).toBe(true);
    expect(resourcesOpen(start, at("2026-11-01T09:00:00-04:00"), true)).toBe(true);
    expect(resourcesOpen("garbage", at("2026-10-25T12:00:00-04:00"), true)).toBe(true);
  });
  test("only a real true counts as showNow", () => {
    expect(resourcesOpen(start, at("2026-10-01T09:00:00-04:00"), "yes")).toBe(false);
  });
  test("an invalid or missing start is closed", () => {
    expect(resourcesOpen("not a date", at("2026-10-25T12:00:00-04:00"))).toBe(false);
    expect(resourcesOpen(undefined, at("2026-10-25T12:00:00-04:00"))).toBe(false);
  });
  test("accepts a Date for the start", () => {
    expect(resourcesOpen(new Date(start), at("2026-10-25T12:00:00-04:00"))).toBe(true);
  });
});

describe("resourceKind", () => {
  test.each([
    ["https://www.youtube.com/watch?v=1", "video"],
    ["https://youtube.com/watch?v=1", "video"],
    ["https://m.youtube.com/watch?v=1", "video"],
    ["https://youtu.be/abc", "video"],
    ["https://example.com/rubric.pdf", "pdf"],
    ["https://example.com/RUBRIC.PDF", "pdf"],
    ["https://docs.google.com/document/d/1", "doc"],
    ["https://drive.google.com/file/d/1", "doc"],
    ["https://example.com/page", "link"],
    ["garbage", "link"],
  ])("%s is a %s", (url, kind) => expect(resourceKind(url)).toBe(kind));
});

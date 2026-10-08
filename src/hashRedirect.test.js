/**
 * The URL somebody actually writes down.
 *
 * This app is a HashRouter, so `/judge-registration` is not a route --
 * `#/judge-registration` is. The path-shaped URL has an empty hash, which
 * matches "/", which is the **competitor** form. A judge sent that link signs
 * up as a competitor and nothing on screen says so.
 */
import { hashTargetFor, basePath } from "./hashRedirect";

describe("with no base, as when served from the root of a domain", () => {
  const at = (pathname, extra = {}) => hashTargetFor({ pathname, base: "", ...extra });

  test("a path-shaped route goes to the hash route of the same name", () => {
    expect(at("/judge-registration")).toBe("/#/judge-registration");
  });

  test("a deep path keeps its shape", () => {
    expect(at("/user/admin/schedule")).toBe("/#/user/admin/schedule");
  });

  test("the query string comes along", () => {
    expect(at("/user/admin/schedule", { search: "?round=final" }))
      .toBe("/#/user/admin/schedule?round=final");
  });

  test("the root is left alone", () => {
    expect(at("/")).toBeNull();
    expect(at("")).toBeNull();
    expect(at("/index.html")).toBeNull();
  });

  test("a URL that already has a hash route is left alone", () => {
    expect(at("/", { hash: "#/judge-registration" })).toBeNull();
    expect(at("/judge-registration", { hash: "#/login" })).toBeNull();
  });

  test("the bare # an href=\"#\" leaves behind is not a hash route", () => {
    expect(at("/judge-registration", { hash: "#" })).toBe("/#/judge-registration");
  });
});

describe("outside the base, where a fallback server can still serve the app", () => {
  // The base is /idea-x in development as well as production, but a server
  // that falls back to index.html can serve the bundle from anywhere.
  // Prepending the base anyway points at a directory that only resolves
  // through that fallback.
  const at = (pathname, extra = {}) =>
    hashTargetFor({ pathname, base: "/idea-x", ...extra });

  test("a path outside the base does not have the base invented for it", () => {
    expect(at("/judge-registration")).toBe("/#/judge-registration");
  });

  test("a deep path likewise stays where it was served from", () => {
    expect(at("/user/admin/schedule", { search: "?round=final" }))
      .toBe("/#/user/admin/schedule?round=final");
  });

  test("the root is still left alone", () => {
    expect(at("/")).toBeNull();
  });
});

describe("in production, where it is served from a subdirectory", () => {
  const base = "/idea-x";
  const at = (pathname, extra = {}) => hashTargetFor({ pathname, base, ...extra });

  test("the base path is not mistaken for part of the route", () => {
    expect(at("/idea-x/judge-registration"))
      .toBe("/idea-x/#/judge-registration");
  });

  test("the site root is left alone, with or without its trailing slash", () => {
    expect(at("/idea-x/")).toBeNull();
    expect(at("/idea-x")).toBeNull();
  });

  test("a deep path keeps the base and the route separate", () => {
    expect(at("/idea-x/user/admin/control"))
      .toBe("/idea-x/#/user/admin/control");
  });
});

describe("normalising the base", () => {
  test("a full URL contributes only its path", () => {
    expect(basePath("https://hoohacks.github.io/idea-x"))
      .toBe("/idea-x");
  });

  test("a trailing slash is dropped, so paths do not double up", () => {
    expect(basePath("https://hoohacks.github.io/idea-x/"))
      .toBe("/idea-x");
  });

  test("an empty base is no base", () => {
    expect(basePath("")).toBe("");
  });

  test("Vite's base, which ends in a slash, loses it", () => {
    // import.meta.env.BASE_URL is "/idea-x/" in development and production alike
    expect(basePath("/idea-x/")).toBe("/idea-x");
  });
});

describe("the edges", () => {
  test("several leading and trailing slashes are all trimmed", () => {
    expect(hashTargetFor({ pathname: "///judge-registration///", base: "" })).toBe("/#/judge-registration");
    expect(hashTargetFor({ pathname: "/idea-x//judge//", base: "/idea-x" })).toBe("/idea-x/#/judge");
  });

  test("a slash inside the path is kept", () => {
    expect(hashTargetFor({ pathname: "/user/admin/", base: "" })).toBe("/#/user/admin");
  });

  test("with nothing given it is the root, and stays put", () => {
    expect(hashTargetFor({})).toBeNull();
  });

  test("a search with no hash comes along exactly", () => {
    expect(hashTargetFor({ pathname: "/scan", search: "?team=1" })).toBe("/#/scan?team=1");
  });

  test("an http URL, several trailing slashes, and a base mentioning https elsewhere", () => {
    expect(basePath("http://localhost:3000/idea-x///")).toBe("/idea-x");
    expect(basePath("/apps/https://x")).toBe("/apps/https://x");
  });

  test("with no argument the build's base is used, and the root is no base", () => {
    const saved = import.meta.env.BASE_URL;
    try {
      vi.stubEnv("BASE_URL", "/idea-x/");
      expect(basePath()).toBe("/idea-x");
      vi.stubEnv("BASE_URL", "/");
      expect(basePath()).toBe("");
    } finally {
      vi.stubEnv("BASE_URL", saved);
    }
  });
});

describe("redirecting the browser", async () => {
  const { redirectToHashRoute } = await import("./hashRedirect");
  const saved = import.meta.env.BASE_URL;
  beforeEach(() => {
    vi.stubEnv("BASE_URL", "/idea-x/");
  });
  afterEach(() => {
    vi.stubEnv("BASE_URL", saved);
  });

  test("replaces a path-shaped URL with its hash route, and says where", () => {
    const location = { pathname: "/idea-x/judge-registration", search: "?ref=email", hash: "", replace: vi.fn() };
    expect(redirectToHashRoute(location)).toBe("/idea-x/#/judge-registration?ref=email");
    expect(location.replace).toHaveBeenCalledWith("/idea-x/#/judge-registration?ref=email");
  });

  test("leaves a hash route alone", () => {
    const location = { pathname: "/idea-x/", search: "", hash: "#/login", replace: vi.fn() };
    expect(redirectToHashRoute(location)).toBeNull();
    expect(location.replace).not.toHaveBeenCalled();
  });

  test("reads the real location by default", () => {
    // jsdom serves the tests from the root, which is already where it should be
    expect(redirectToHashRoute()).toBeNull();
  });
});

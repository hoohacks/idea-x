/**
 * The URL somebody actually writes down.
 *
 * This app is a HashRouter, so `/judge-registration` is not a route --
 * `#/judge-registration` is. The path-shaped URL has an empty hash, which
 * matches "/", which is the **competitor** form. A judge sent that link signs
 * up as a competitor and nothing on screen says so.
 */
import { hashTargetFor, basePath } from "./hashRedirect";

describe("locally, where the app is served from the root", () => {
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

describe("in development, where the server answers on the root", () => {
  // PUBLIC_URL is /idea-x here too, but localhost:3000 serves
  // the app from /. Prepending the base anyway pointed at a directory that only
  // resolves through the dev server's index.html fallback.
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

describe("reading the base out of package.json's homepage", () => {
  test("a full URL contributes only its path", () => {
    expect(basePath("https://hoohacks.github.io/idea-x"))
      .toBe("/idea-x");
  });

  test("a trailing slash is dropped, so paths do not double up", () => {
    expect(basePath("https://hoohacks.github.io/idea-x/"))
      .toBe("/idea-x");
  });

  test("no homepage at all has no base", () => {
    expect(basePath("")).toBe("");
  });

  test("development gets the same base as production, because CRA derives both from homepage", () => {
    // react-scripts sets PUBLIC_URL to paths.publicUrlOrPath.slice(0, -1), and
    // in development that is the homepage's *pathname* -- not an empty string
    expect(basePath("/idea-x")).toBe("/idea-x");
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

  test("with no argument the build's PUBLIC_URL is used, or nothing", () => {
    const saved = process.env.PUBLIC_URL;
    try {
      process.env.PUBLIC_URL = "https://hoohacks.github.io/idea-x/";
      expect(basePath()).toBe("/idea-x");
      delete process.env.PUBLIC_URL;
      expect(basePath()).toBe("");
    } finally {
      if (saved === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = saved;
    }
  });
});

describe("redirecting the browser", () => {
  const { redirectToHashRoute } = require("./hashRedirect");
  const saved = process.env.PUBLIC_URL;
  beforeEach(() => {
    process.env.PUBLIC_URL = "/idea-x";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = saved;
  });

  test("replaces a path-shaped URL with its hash route, and says where", () => {
    const location = { pathname: "/idea-x/judge-registration", search: "?ref=email", hash: "", replace: jest.fn() };
    expect(redirectToHashRoute(location)).toBe("/idea-x/#/judge-registration?ref=email");
    expect(location.replace).toHaveBeenCalledWith("/idea-x/#/judge-registration?ref=email");
  });

  test("leaves a hash route alone", () => {
    const location = { pathname: "/idea-x/", search: "", hash: "#/login", replace: jest.fn() };
    expect(redirectToHashRoute(location)).toBeNull();
    expect(location.replace).not.toHaveBeenCalled();
  });

  test("reads the real location by default", () => {
    // jsdom serves the tests from the root, which is already where it should be
    expect(redirectToHashRoute()).toBeNull();
  });
});

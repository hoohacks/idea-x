/**
 * The route guard.
 *
 * This is the component every authenticated page in the app is wrapped in, and
 * it had no tests. Note what it is and is not: it decides what *renders*, not
 * what a person can *read*. Anyone can set `userTypes` in DevTools and paint an
 * admin page; the database rules are what keep it empty. These tests cover the
 * navigation behaviour, including the loading gate that exists to fix a real
 * bug — without it a signed-in user was briefly treated as signed out and
 * bounced to /login on every refresh.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

jest.mock("./firebase", () => ({ database: {}, storage: {}, auth: {} }));
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: jest.fn(async () => ({ exists: () => false, val: () => null })),
  onValue: () => () => {},
}));
jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: null }),
  onAuthStateChanged: () => () => {},
  signInWithEmailAndPassword: jest.fn(),
  browserLocalPersistence: {},
}));

const { AuthContext, NavDrawerProvider, ProtectedRoute } = require("./App");
const Layout = require("./user/Layout").default;

const SIGNED_IN = { user: { uid: "u1" } };

function renderGuard({ auth, requiredRoles, start = "/secret" }) {
  const value = {
    userCredential: null,
    userTypes: [],
    loadingAuth: false,
    loadingUserData: false,
    ...auth,
  };

  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route
            path="/secret"
            element={
              <ProtectedRoute requiredRoles={requiredRoles}>
                <div>secret content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/user/home" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("while the session is still resolving", () => {
  // The gate below is not cosmetic. Without it `userCredential` is null on the
  // first render of every page load, the guard concludes "signed out", and a
  // signed-in user is redirected to /login before Firebase has answered.
  test.each([
    ["auth", { loadingAuth: true }],
    ["the role lookup", { loadingUserData: true }],
  ])("waits for %s rather than redirecting", (_label, flags) => {
    renderGuard({ auth: { userCredential: null, ...flags } });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  test("a signed-in user is not bounced to login mid-load", () => {
    renderGuard({ auth: { userCredential: SIGNED_IN, loadingUserData: true } });
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });
});

describe("signed out", () => {
  test("goes to the login page", () => {
    renderGuard({ auth: { userCredential: null } });
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  test("goes to login even when no role is required", () => {
    renderGuard({ auth: { userCredential: null }, requiredRoles: undefined });
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});

describe("signed in", () => {
  test("an unguarded route renders for anyone, including a roleless account", () => {
    renderGuard({ auth: { userCredential: SIGNED_IN, userTypes: [] } });
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  test("the right role renders", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["admin"] },
      requiredRoles: ["admin"],
    });
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  test("any one of several accepted roles is enough", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["judge"] },
      requiredRoles: ["judge", "admin"],
    });
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  test("the wrong role goes home, not to login", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["competitor"] },
      requiredRoles: ["admin"],
    });
    expect(screen.getByText("home page")).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  test("a competitor cannot reach an admin page", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["competitor"] },
      requiredRoles: ["admin"],
    });
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  test("a judge cannot reach an admin page", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["judge"] },
      requiredRoles: ["admin"],
    });
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  test("a roleless account cannot reach a guarded page", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: [] },
      requiredRoles: ["admin"],
    });
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  test("an account holding several roles gets the union of them", () => {
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: ["competitor", "judge"] },
      requiredRoles: ["judge"],
    });
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  test("userTypes that is not an array does not throw", () => {
    // it is [] before the provider resolves, but the guard should not explode
    // if it is ever handed something else
    renderGuard({
      auth: { userCredential: SIGNED_IN, userTypes: undefined },
      requiredRoles: ["admin"],
    });
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
});

describe("every admin route is actually guarded", () => {
  /**
   * The tests above prove ProtectedRoute redirects correctly. They cannot prove
   * a given route was wrapped in it -- and forgetting the wrapper on a new admin
   * page is the mistake that renders the whole control panel to anyone who
   * types the URL. This reads App.js the way schema.test.js reads the rules
   * file: it catches a missing guard, not a wrong one.
   */
  const fs = require("fs");
  const path = require("path");
  const APP = fs.readFileSync(path.join(process.cwd(), "src", "App.js"), "utf8");

  /**
   * Slice out the <Route path="admin"> branch and look only inside it. Matching
   * on path names alone does not work: there are two routes called "judging" --
   * the judge-facing /user/judging, which is correctly open to judges, and the
   * admin /user/admin/judging, which is not.
   */
  const lines = APP.split("\n");
  const start = lines.findIndex((line) => line.includes('<Route path="admin">'));
  const end = lines.findIndex((line, i) => i > start && line.includes("</Route>"));
  const adminRoutes = lines
    .slice(start + 1, end)
    .filter((line) => line.includes("<Route path="));

  test("the control panel route exists", () => {
    expect(APP).toContain('<Route path="control"');
  });

  test("every route naming an admin page requires the admin role", () => {
    const unguarded = adminRoutes.filter(
      (line) => !/requiredRoles=\{\["admin"\]\}/.test(line)
    );
    expect(unguarded).toEqual([]);
  });

  test("the admin branch is not empty, so the filter above is really matching", () => {
    // guards the guard: a regex that matches nothing would pass silently
    expect(adminRoutes.length).toBeGreaterThanOrEqual(7);
  });
});

/**
 * A tap on the menu is not thrown away by the page finishing loading.
 *
 * The guard renders its own `Layout` while it waits for a role, and the page it
 * then renders brings another one. React sees a different element in that
 * position and discards the first, nav included -- so the drawer opened during
 * the wait disappeared the moment the role arrived, and the person had to tap
 * again. That window is short on a laptop and long on conference wifi, which is
 * where the app is actually used.
 *
 * The open flag lives above the guard now. This test is the reason it does:
 * revert that and the drawer is gone by the second assertion.
 */
describe("the phone drawer across the loading swap", () => {
  // Every real page is a component that renders its own Layout. That shape is
  // the whole point: React compares `Page` against the guard's own `Layout`,
  // decides they are different, and throws the mounted one away. Putting a
  // `Layout` here directly would reconcile instead, and the test would pass
  // whether or not the bug is present.
  const Page = () => <Layout>page content</Layout>;

  function renderChrome(loadingUserData) {
    const value = {
      userCredential: SIGNED_IN,
      userTypes: ["judge"],
      userData: { firstName: "Ada", lastName: "Lovelace" },
      loadingAuth: false,
      loadingUserData,
    };

    return (
      <NavDrawerProvider>
        <AuthContext.Provider value={value}>
          <MemoryRouter initialEntries={["/secret"]}>
            <Routes>
              <Route
                path="/secret"
                element={
                  <ProtectedRoute>
                    <Page />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </NavDrawerProvider>
    );
  }

  test("stays open when the role arrives and the page replaces the frame", async () => {
    const { rerender } = render(renderChrome(true));

    // the frame is up but the page is not: exactly when a first tap lands
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();

    rerender(renderChrome(false));

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });
});

/**
 * Assignments behaviour that pages.smoke.test.js does not pin down: a judge's
 * assignments staying live while the page is open, and a failed final-round
 * read being told apart from an empty one.
 *
 * The firebase/database mock below is path-aware, unlike the generic stub in
 * pages.smoke.test.js, because these tests need to (a) push a second value
 * down the same `onValue` subscription to prove the page is actually live,
 * and (b) fail one specific path without failing every other read on the
 * page.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../theme";
import { AuthContext } from "../../App";

jest.mock("../../firebase", () => ({ database: {} }));

// One in-memory subscriber list per database path, so a test can push a new
// value down the exact listener the component registered and assert the
// page picks it up without a remount -- the thing a one-shot `get` cannot do.
const listenersByPath = {};
async function pushValue(path, val) {
  for (const cb of listenersByPath[path] ?? []) {
    await act(async () => cb({ exists: () => val !== null && val !== undefined, val: () => val }));
  }
}
async function failPath(path, error) {
  for (const cb of failListenersByPath[path] ?? []) {
    await act(async () => cb(error));
  }
}
const failListenersByPath = {};

// Controls for `get`, used only by the out-of-order-snapshot tests below.
// Default mode resolves immediately, matching every other test's expectations.
// "queue" mode defers each call's resolution to the test, which can then
// resolve two overlapping calls in whichever order it chooses -- modeling two
// in-flight network reads that land out of sequence. Names start with "mock"
// so the jest.mock factory below is allowed to close over them.
const mockGetMode = { current: "default" };
const mockGetQueue = [];

// create-react-app's `resetMocks: true` strips the implementation off every
// jest.fn before each test (see the comment in pages.smoke.test.js), so
// these are plain functions rather than jest.fn(impl) -- there is nothing
// for resetMocks to strip.
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: async (r) => {
    if (mockGetMode.current === "queue") {
      return new Promise((resolve) => {
        mockGetQueue.push({ path: r.path, resolve });
      });
    }
    return { exists: () => false, val: () => null };
  },
  onValue: (r, onNext, onError) => {
    listenersByPath[r.path] = listenersByPath[r.path] ?? [];
    listenersByPath[r.path].push(onNext);
    if (onError) {
      failListenersByPath[r.path] = failListenersByPath[r.path] ?? [];
      failListenersByPath[r.path].push(onError);
    }
    // fire once synchronously, the way a real onValue does on subscribe
    onNext({ exists: () => false, val: () => null });
    return () => {
      listenersByPath[r.path] = (listenersByPath[r.path] ?? []).filter((fn) => fn !== onNext);
    };
  },
  query: (r) => r,
  orderByChild: () => {},
  equalTo: () => {},
  serverTimestamp: () => 0,
}));

jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "judge-1", email: "judge@example.com" } }),
}));

const Assignments = require("./Assignments").default;

const baseAuth = {
  userCredential: { user: { uid: "judge-1", email: "judge@example.com" } },
  userData: { firstName: "Alex", lastName: "Kim", email: "judge@example.com" },
  userTypes: ["judge"],
  loadingAuth: false,
  loadingUserData: false,
  refreshUserData: jest.fn(),
  handleLogin: jest.fn(),
  token: null,
};

let currentUnmount = null;

function renderJudge() {
  const result = render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={baseAuth}>
        <MemoryRouter>
          <Assignments />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
  currentUnmount = result.unmount;
  return result;
}

beforeEach(() => {
  for (const key of Object.keys(listenersByPath)) delete listenersByPath[key];
  for (const key of Object.keys(failListenersByPath)) delete failListenersByPath[key];
});

afterEach(() => {
  if (currentUnmount) currentUnmount();
  currentUnmount = null;
});

test("an assignment pushed to the judge's node after the page is already open shows up without a reload", async () => {
  renderJudge();
  await screen.findByText("No assignments yet. They appear once an admin generates the schedule.");

  // an organizer edits the schedule while this judge's tab has been open --
  // the only subscription this test's mock supports is the live one, so this
  // can only pass if Assignments is actually listening rather than having
  // read the node once at mount
  await pushValue("judges/judge-1/teamAssignments", {
    t1: { id: "t1", teamName: "Team Rocket", room: "Rice 100", time: "10:00", batch: 0 },
  });

  expect(await screen.findByText("Team Rocket")).toBeInTheDocument();
});

test("a failed final-round read says so instead of quietly claiming there are no assignments", async () => {
  renderJudge();
  await screen.findByText("No assignments yet. They appear once an admin generates the schedule.");

  // activate the final round for this judge
  await pushValue("finalRound/active", true);
  await screen.findByText("No final round assignments for you.");

  await failPath("judges/judge-1/finalAssignments", new Error("permission_denied"));

  expect(
    await screen.findByText("Could not load your final round assignments. Check your connection and reload.")
  ).toBeInTheDocument();
});

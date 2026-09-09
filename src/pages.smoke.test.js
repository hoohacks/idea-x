/**
 * Render smoke tests.
 *
 * Most of this app sits behind authentication, so the signed-in pages cannot be
 * opened in a browser without a real account. These render each one against a
 * stubbed Firebase and a fake auth context, which catches the crashes a build
 * cannot: bad prop shapes, undefined reads during render, invalid element
 * nesting. It asserts the page paints something recognisable, not how it looks.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";
import { AuthContext } from "./App";

// ---- Firebase stubs -------------------------------------------------------

jest.mock("./firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "judge-1", email: "judge@example.com" } },
}));

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: jest.fn(async () => ({ exists: () => false, val: () => null })),
  set: jest.fn(async () => {}),
  update: jest.fn(async () => {}),
  push: jest.fn(() => ({ key: "new-team" })),
  onValue: (_ref, cb) => {
    cb({ exists: () => false, val: () => null });
    return () => {};
  },
  query: (r) => r,
  orderByChild: jest.fn(),
  equalTo: jest.fn(),
  limitToLast: jest.fn(),
  serverTimestamp: () => 0,
}));

jest.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "judge-1", email: "judge@example.com" } }),
  sendPasswordResetEmail: jest.fn(async () => {}),
  signInWithEmailAndPassword: jest.fn(async () => ({ user: { uid: "u1" } })),
  createUserWithEmailAndPassword: jest.fn(async () => ({ user: { uid: "u1" } })),
  onAuthStateChanged: () => () => {},
  browserLocalPersistence: {},
}));

jest.mock("firebase/storage", () => ({
  getStorage: () => ({}),
  ref: jest.fn(),
  uploadBytesResumable: jest.fn(),
  getDownloadURL: jest.fn(async () => "https://example.com/deck.pdf"),
}));

// react-zxing wants a camera
jest.mock("react-zxing", () => ({ useZxing: () => ({ ref: { current: null } }) }));

// chart.js draws to a canvas, which jsdom does not implement
jest.mock("react-chartjs-2", () => ({ Line: () => null, Bar: () => null }));

// Assignments' "Resume draft" test needs readDraft to resolve a real draft --
// the generic firebase stub above always reads as not-exists, which is right
// for every other page here, so only readDraft is overridden. SchedulePreview
// (rendered by the "schedule preview" test below) imports subscribeDraft,
// saveDraft and clearDraft from this same module, so those are left as the
// real implementation rather than replaced with undefined.
const mockReadDraft = jest.fn();
jest.mock("./user/judge/draftStore", () => ({
  ...jest.requireActual("./user/judge/draftStore"),
  readDraft: (...args) => mockReadDraft(...args),
}));

// ---- Helpers --------------------------------------------------------------

const baseAuth = {
  userCredential: { user: { uid: "u1", email: "person@example.com" } },
  userData: { firstName: "Alex", lastName: "Kim", email: "person@example.com" },
  userTypes: [],
  loadingAuth: false,
  loadingUserData: false,
  refreshUserData: jest.fn(),
  handleLogin: jest.fn(),
  token: null,
};

function renderPage(Component, authOverrides = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={{ ...baseAuth, ...authOverrides }}>
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

// ---- Pages ----------------------------------------------------------------

const Home = require("./user/Home").default;
const Profile = require("./user/Profile").default;
const CheckIn = require("./user/CheckIn").default;
const Team = require("./user/team/Team").default;
const CreateTeam = require("./user/team/CreateTeam").default;
const JoinTeam = require("./user/team/NewJoinTeam").default;
const Assignments = require("./user/judge/Assignments").default;
const Search = require("./user/admin/Search").default;
const JudgeSearch = require("./user/admin/JudgeSearch").default;
const TeamSearch = require("./user/admin/TeamSearch").default;
const JudgingProgress = require("./user/admin/JudgingProgress").default;
const Registration = require("./Registration").default;
const JudgeRegistration = require("./JudgeRegistration").default;
const SchedulePreview = require("./user/admin/schedule/SchedulePreview").default;
const SchedulePlanner = require("./user/admin/schedule/SchedulePlanner").default;
const Metrics = require("./RegisteredAtDisplay").default;
const Scan = require("./user/admin/Scan").default;
const Control = require("./user/admin/Control").default;
const Login = require("./Login").default;
const ForgotPassword = require("./ForgotPassword").default;

describe("pages render without crashing", () => {
  // create-react-app's `resetMocks: true` strips the implementation off
  // every jest.fn before each test, so the module-level mock above needs
  // re-establishing here.
  beforeEach(() => {
    mockReadDraft.mockReset();
    mockReadDraft.mockResolvedValue(null);
  });

  test("home", async () => {
    renderPage(Home, { userTypes: ["competitor"] });
    expect(await screen.findByText(/Welcome/)).toBeInTheDocument();
  });

  test("an organizer's dashboard tells them where the day is", async () => {
    // it used to build cards for competitors and for judges and nothing for
    // organizers, so the people running the event landed on an empty page
    renderPage(Home, { userTypes: ["admin"] });

    expect(await screen.findByText("Event status")).toBeInTheDocument();
    expect(screen.getByText("Before judging can run")).toBeInTheDocument();
    expect(screen.getByText("Judging rooms added")).toBeInTheDocument();
  });

  test("a competitor's dashboard is unchanged by that", async () => {
    renderPage(Home, { userTypes: ["competitor"] });
    await screen.findByText(/Welcome/);
    expect(screen.queryByText("Event status")).not.toBeInTheDocument();
  });

  test("profile", async () => {
    renderPage(Profile, { userTypes: ["competitor"] });
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("Alex Kim")).toBeInTheDocument();
  });

  test("profile with no record shows a fallback rather than crashing", async () => {
    renderPage(Profile, { userData: null, userTypes: [] });
    expect(await screen.findByText(/No profile found/)).toBeInTheDocument();
  });

  test("check in", async () => {
    renderPage(CheckIn, { userTypes: ["competitor"] });
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument();
  });

  test("team page with no team", async () => {
    renderPage(Team, { userTypes: ["competitor"] });
    expect(await screen.findByText(/not on a team yet/)).toBeInTheDocument();
  });

  test("create team", async () => {
    renderPage(CreateTeam, { userTypes: ["competitor"] });
    expect(await screen.findByRole("heading", { name: "Create a team" })).toBeInTheDocument();
  });

  test("join team", async () => {
    renderPage(JoinTeam, { userTypes: ["competitor"] });
    expect(await screen.findByRole("heading", { name: "Join a team" })).toBeInTheDocument();
  });

  test("judging as a judge", async () => {
    renderPage(Assignments, { userTypes: ["judge"] });
    expect(await screen.findByRole("heading", { name: "Judging" })).toBeInTheDocument();
    expect(await screen.findByText("First round")).toBeInTheDocument();
  });

  test("judging as an admin shows the schedule controls", async () => {
    renderPage(Assignments, { userTypes: ["admin"] });
    expect(await screen.findByText("Plan schedule")).toBeInTheDocument();
  });

  // ---- Finding 7e: a live draft is not invisible from the page an
  // organizer starts on ----
  test("judging as an admin with an unpublished draft offers to resume it, not plan a new one", async () => {
    mockReadDraft.mockResolvedValue({
      edits: [{ summary: "a" }, { summary: "b" }],
    });
    renderPage(Assignments, { userTypes: ["admin"] });
    expect(await screen.findByText("Resume draft (2 edits)")).toBeInTheDocument();
    expect(screen.queryByText("Plan schedule")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan a new schedule")).not.toBeInTheDocument();
  });

  test("judging progress", async () => {
    renderPage(JudgingProgress, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Judging progress" })).toBeInTheDocument();
    // the two things an organizer is actually watching during the event
    expect(await screen.findByText(/scores in/)).toBeInTheDocument();
    expect(await screen.findByText(/no scores/)).toBeInTheDocument();
  });

  test("the public pages ask different people for different things", async () => {
    // they share RegistrationShell and Hero, so they look alike -- the thing
    // worth pinning is that they are not the same form
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <MemoryRouter><JudgeRegistration /></MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText("Judge and mentor sign-up")).toBeInTheDocument();
    // each section name appears twice: once in the progress rail, once on the
    // section itself
    expect(screen.getAllByText("Mentoring").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Judging").length).toBeGreaterThan(0);
    expect(screen.queryByText("Studies")).not.toBeInTheDocument();
    unmount();

    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter><Registration /></MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText("Student registration")).toBeInTheDocument();
    expect(screen.getAllByText("Studies").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mentoring")).not.toBeInTheDocument();
  });

  /**
   * The page is titled once, above the tabs that divide it.
   *
   * It used to open with the tab strip and no title at all, and the only h1 on
   * the page was the heading of the card underneath -- so "Schedule preview"
   * read as the name of the page while the round, which is what the tabs
   * actually choose between, had nothing over it.
   */
  test("the planner opens on the first round", async () => {
    renderPage(SchedulePlanner, { userTypes: ["admin"] });
    expect(await screen.findByRole("tab", { name: "First round" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Judging schedule" })).toBeInTheDocument();
  });

  test("the planner draws one page frame, not two", async () => {
    // Layout is the whole frame -- a 100vh box with the nav and the footer in
    // it. Two of them stacked pushed the planner a full screen below the fold,
    // which reads as a blank page in a browser and as a pass in jsdom, since
    // jsdom has no viewport. Counting frames is the part jsdom can see.
    renderPage(SchedulePlanner, { userTypes: ["admin"] });
    await screen.findByRole("tab", { name: "First round" });

    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  test("the final round tab draws one page frame too", async () => {
    renderPage(SchedulePlanner, { userTypes: ["admin"] });
    fireEvent.click(await screen.findByRole("tab", { name: "Final round" }));

    // the round is the tab, not a second title repeating it
    expect(await screen.findByRole("tab", { name: "Final round", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Judging schedule" })).toBeInTheDocument();
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Build a final round plan/ })).toBeInTheDocument();
  });

  // rendered on its own, without the planner's header, so what it owns is the
  // draft state and the way out of it
  test("schedule preview", async () => {
    renderPage(SchedulePreview, { userTypes: ["admin"] });
    expect(await screen.findByRole("button", { name: "Build a plan" })).toBeInTheDocument();
  });

  test("competitor dashboard", async () => {
    renderPage(Search, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Competitors" })).toBeInTheDocument();
  });

  test("judge dashboard", async () => {
    renderPage(JudgeSearch, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Judges" })).toBeInTheDocument();
  });

  test("team dashboard", async () => {
    renderPage(TeamSearch, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
  });

  test("metrics", async () => {
    renderPage(Metrics, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Registration Metrics" })).toBeInTheDocument();
  });

  test("check-in scanner", async () => {
    renderPage(Scan, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Scan check-in" })).toBeInTheDocument();
    // the two things it can record, and the camera it records them with
    expect(screen.getByRole("button", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Food" })).toBeInTheDocument();
  });

  test("control panel", async () => {
    renderPage(Control, { userTypes: ["admin"] });
    expect(await screen.findByRole("heading", { name: "Control panel" })).toBeInTheDocument();
  });

  /**
   * The order is the point, not just the presence.
   *
   * The panel is read top to bottom on the day, so the sections you reach for
   * while things are going well come first and the ones you reach for when they
   * are not come last. Recent activity sits near the bottom, above the danger
   * zone. Asserting the whole sequence is what stops a later import being
   * dropped into the middle of the list by accident.
   */
  /**
   * Nine sections on one scroll was four unrelated jobs stacked: event setup,
   * managing people, exporting data, and recovering from a bad write. They are
   * tabs now, and the danger zone is no longer three flicks below whatever you
   * came for.
   */
  const sectionsOn = () =>
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

  test("the control panel opens on event setup", async () => {
    renderPage(Control, { userTypes: ["admin"] });
    await screen.findByRole("heading", { name: "Control panel" });

    expect(sectionsOn()).toEqual(["Judging rooms", "Judging schedule", "Event", "Advanced"]);
  });

  test("recovery is its own tab, not the bottom of the page", async () => {
    renderPage(Control, { userTypes: ["admin"] });
    await screen.findByRole("heading", { name: "Control panel" });

    // not reachable by scrolling past everything else
    expect(sectionsOn()).not.toContain("Danger zone");

    fireEvent.click(screen.getByRole("tab", { name: "Recovery" }));
    expect(sectionsOn()).toEqual(["Restore points", "Danger zone"]);
  });

  test("people and data each get their own tab", async () => {
    renderPage(Control, { userTypes: ["admin"] });
    await screen.findByRole("heading", { name: "Control panel" });

    fireEvent.click(screen.getByRole("tab", { name: "People" }));
    expect(sectionsOn()).toEqual(["People and roles"]);

    fireEvent.click(screen.getByRole("tab", { name: "Data and activity" }));
    expect(sectionsOn()).toEqual(["Export", "Recent activity"]);
  });

  test("a tab can be linked to, so a check can send someone straight to it", async () => {
    render(
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={{ ...baseAuth, userTypes: ["admin"] }}>
          <MemoryRouter initialEntries={["/user/admin/control?tab=recovery"]}>
            <Control />
          </MemoryRouter>
        </AuthContext.Provider>
      </ThemeProvider>
    );

    await screen.findByRole("heading", { name: "Control panel" });
    expect(sectionsOn()).toContain("Danger zone");
  });

  test("metrics with no registrations invites rather than showing empty axes", async () => {
    renderPage(Metrics, { userTypes: ["admin"] });
    expect(await screen.findByText(/No registrations yet/)).toBeInTheDocument();
  });

  test("login", async () => {
    renderPage(Login);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  test("forgot password", async () => {
    renderPage(ForgotPassword);
    expect(await screen.findByRole("heading", { name: "Reset password" })).toBeInTheDocument();
  });
});

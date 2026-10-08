/**
 * task-9-context.md's controller ruling: no browser to drive by hand, so this
 * exercises the page against a stubbed Firebase and a fake auth context,
 * copying the pattern from src/pages.smoke.test.js -- `App.js` (which
 * `AuthContext` comes from) transitively imports nearly every page in the
 * app, so the same full mock set that file uses is copied here rather than
 * a trimmed-down guess at what SchedulePreview alone needs.
 *
 * `draftStore` is mocked directly rather than through the generic Firebase
 * stub, so each test controls exactly what the draft subscription delivers
 * without fighting draftStore's own optimistic-concurrency version check.
 * `applyEdit` and `computeStats` are left real -- both are pure, and a real
 * refusal from `applyEdit` is exactly what the "refused edit" case needs.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../../theme";
import { AuthContext } from "../../../App";

// ---- Firebase stubs, copied from src/pages.smoke.test.js -----------------

jest.mock("../../../firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "admin-1", email: "admin@example.com" } },
}));

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: jest.fn(async () => ({ exists: () => false, val: () => null })),
  set: jest.fn(async () => {}),
  update: jest.fn(async () => {}),
  push: jest.fn(() => ({ key: "new-id" })),
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
  getAuth: () => ({ currentUser: { uid: "admin-1", email: "admin@example.com" } }),
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

jest.mock("react-zxing", () => ({ useZxing: () => ({ ref: { current: null } }) }));
jest.mock("react-chartjs-2", () => ({ Line: () => null, Bar: () => null }));

// roles.js (hasRole, requireAdmin, ...) is left real -- hasRole is pure and
// Nav (rendered by Layout) needs it to work, and requireAdmin is never
// reached here since draftStore/planSchedule/publishPlan/scheduleConfig are
// all mocked below.

// ---- The modules this page owns its actions through -----------------------

const mockSubscribeDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();
const mockReadDraft = jest.fn();

jest.mock("../../judge/draftStore.js", () => ({
  subscribeDraft: (...args) => mockSubscribeDraft(...args),
  saveDraft: (...args) => mockSaveDraft(...args),
  clearDraft: (...args) => mockClearDraft(...args),
  readDraft: (...args) => mockReadDraft(...args),
}));

jest.mock("../../judge/planSchedule.js", () => ({ planSchedule: jest.fn() }));
jest.mock("../../judge/publishPlan.js", () => ({ publishPlan: jest.fn() }));
jest.mock("../../judge/scheduleConfig.js", () => ({
  readScheduleMeta: jest.fn(async () => null),
}));

const SchedulePreview = require("./SchedulePreview").default;
const DriftPanel = require("./DriftPanel").default;
const { readScheduleMeta } = require("../../judge/scheduleConfig.js");
const { publishPlan } = require("../../judge/publishPlan.js");
const { get: mockGet } = require("firebase/database");

// ---- Helpers ---------------------------------------------------------------

function renderPage(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={{ userTypes: ["admin"] }}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

function makePlan(overrides = {}) {
  return {
    assignments: {
      t1: {
        id: "t1", teamName: "Aurora", room: "R1", time: "5:00 PM", batch: 1,
        judges: [
          { judgeId: "j0", judgeName: "Ada Lovelace" },
          { judgeId: "j1", judgeName: "Bo Diaz" },
        ],
      },
      t2: {
        id: "t2", teamName: "Borealis", room: "R2", time: "5:00 PM", batch: 1,
        judges: [{ judgeId: "j2", judgeName: "Cy Young" }],
      },
    },
    basis: {
      teamIds: ["t1", "t2"], judgeIds: ["j0", "j1", "j2", "j3"],
      rooms: ["R1", "R2", "R3"], batchCount: 1,
      batchTimes: { 1: "5:00 PM" }, target: 2,
    },
    onlyCheckedIn: false,
    judgeNames: { j0: "Ada Lovelace", j1: "Bo Diaz", j2: "Cy Young", j3: "Di Prince" },
    teamNames: { t1: "Aurora", t2: "Borealis" },
    edits: [],
    version: 1,
    createdAt: 1700000000000,
    createdByName: "Sam Organizer",
    ...overrides,
  };
}

beforeEach(() => {
  mockSaveDraft.mockResolvedValue({ ok: true, version: 2 });
  mockClearDraft.mockResolvedValue({ ok: true });
  mockReadDraft.mockResolvedValue(null);
  readScheduleMeta.mockResolvedValue(null);
  // create-react-app's `resetMocks: true` strips the implementation off
  // every jest.fn before each test, including the one the firebase/database
  // factory above defines inline -- see draftStore.test.js's note on the
  // same behaviour. Re-established here since openPublishConfirm's own
  // `get(ref(database, "config/eventName"))` call needs it.
  mockGet.mockResolvedValue({ exists: () => false, val: () => null });
});

// ---- 1. No draft ------------------------------------------------------------

test("with no draft, the build control renders and the page does not crash", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(null); return () => {}; });
  renderPage(<SchedulePreview />);
  expect(await screen.findByRole("button", { name: "Build a plan" })).toBeInTheDocument();
});

// ---- 2. A draft's teams and judges render -----------------------------------

test("a draft's teams and judges render in the grid", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan()); return () => {}; });
  renderPage(<SchedulePreview />);

  expect(await screen.findByText("Aurora")).toBeInTheDocument();
  expect(screen.getByText("Borealis")).toBeInTheDocument();
  expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  expect(screen.getByText("Bo Diaz")).toBeInTheDocument();
  expect(screen.getByText("Cy Young")).toBeInTheDocument();
});

// ---- 3. A refused edit surfaces its error ------------------------------------

test("a refused edit surfaces its error message in the drawer", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan()); return () => {}; });
  renderPage(<SchedulePreview />);
  await screen.findByText("Borealis");

  // Borealis (t2) has exactly one judge -- applyEdit refuses to remove the
  // only judge on a team, for real, with no mocking needed to force it.
  userEvent.click(screen.getByRole("button", { name: "Open Borealis" }));
  userEvent.click(await screen.findByRole("button", { name: "Remove" }));

  expect(await screen.findByText(/only judge assigned/i)).toBeInTheDocument();
  expect(mockSaveDraft).not.toHaveBeenCalled();
});

// ---- Finding 4: a failed saveDraft must not read as success in the drawer --

test("a saveDraft failure is returned to the drawer, not swallowed as success", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan()); return () => {}; });
  mockSaveDraft.mockResolvedValueOnce({
    ok: false,
    error: "Sam changed this draft while you were looking. Reload the preview to pick up their version.",
  });
  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");

  // Aurora (t1) has two judges, so applyEdit accepts removing one -- the
  // failure this test forces comes from saveDraft, not applyEdit.
  userEvent.click(screen.getByRole("button", { name: "Open Aurora" }));
  const removeButtons = await screen.findAllByRole("button", { name: "Remove" });
  userEvent.click(removeButtons[0]);

  // The same message reaches both the page Snackbar (who moved it) and the
  // drawer (its own save failed) -- neither one alone used to be wrong, but
  // the drawer previously got told `{ ok: true }` and showed nothing at all.
  await waitFor(() => {
    expect(screen.getAllByText(/Sam changed this draft/i)).toHaveLength(2);
  });
});

// ---- 4. Undo is disabled with no edits, enabled with some --------------------

test("undo is disabled when there are no edits", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan({ edits: [] })); return () => {}; });
  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("undo is enabled and labelled with the newest edit once there are some", async () => {
  mockSubscribeDraft.mockImplementation((cb) => {
    cb(makePlan({
      edits: [{
        op: { type: "addJudge", teamId: "t2", judgeUid: "j3" },
        summary: "Added Di Prince to Borealis",
        before: null,
      }],
    }));
    return () => {};
  });
  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");
  expect(
    screen.getByRole("button", { name: 'Undo "Added Di Prince to Borealis"' })
  ).toBeEnabled();
});

// ---- 5. DriftPanel renders each blocking item individually -------------------

test("DriftPanel renders a separate repair control for each blocking item on the same removed room", () => {
  const drift = {
    blocking: [
      {
        kind: "roomRemoved",
        message: "R1 is no longer a configured room, but Aurora is using it in batch 1.",
        repair: { type: "moveTeam", teamId: "t1", batch: 1, room: "R3" },
      },
      {
        kind: "roomRemoved",
        message: "R1 is no longer a configured room, but Borealis is using it in batch 1.",
        repair: { type: "moveTeam", teamId: "t2", batch: 1, room: "R4" },
      },
    ],
    advisory: [],
  };
  const onRepair = jest.fn();
  const onRebuild = jest.fn();

  renderPage(<DriftPanel drift={drift} onRepair={onRepair} onRebuild={onRebuild} />);

  const buttons = screen.getAllByRole("button", { name: "Place" });
  expect(buttons).toHaveLength(2);

  userEvent.click(buttons[0]);
  userEvent.click(buttons[1]);

  expect(onRepair).toHaveBeenCalledWith({ type: "moveTeam", teamId: "t1", batch: 1, room: "R3" });
  expect(onRepair).toHaveBeenCalledWith({ type: "moveTeam", teamId: "t2", batch: 1, room: "R4" });
  expect(onRebuild).not.toHaveBeenCalled();
});

// ---- Fix round 1, item 1: a failed schedule-meta read fails closed ----------

test("a failed schedule-meta read still requires the typed confirmation to publish", async () => {
  readScheduleMeta.mockRejectedValue(new Error("network blip"));
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan()); return () => {}; });
  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");

  userEvent.click(screen.getByRole("button", { name: "Publish schedule" }));

  // computeStats(makePlan()).teams is 2, and no config/eventName is stubbed
  // to exist, so the required phrase falls back to "2" -- the point under
  // test is that a phrase is required at all despite the failed read.
  expect(await screen.findByText(/could not be checked/i)).toBeInTheDocument();
  const confirmButton = screen.getByRole("button", { name: "Publish" });
  expect(confirmButton).toBeDisabled();

  userEvent.type(screen.getByLabelText(/type/i), "2");
  expect(confirmButton).toBeEnabled();
});

// ---- Fix round 1, item 2: Drop is gated behind its own confirmation --------

test("the Drop repair opens a confirmation instead of dropping immediately", () => {
  const drift = {
    blocking: [{
      kind: "teamWithdrew",
      message: "Borealis withdrew its submission since this plan was built.",
      repair: { type: "dropTeam", teamId: "t2" },
    }],
    advisory: [],
  };
  const onRepair = jest.fn();

  renderPage(<DriftPanel drift={drift} onRepair={onRepair} onRebuild={jest.fn()} />);

  userEvent.click(screen.getByRole("button", { name: "Drop" }));
  expect(onRepair).not.toHaveBeenCalled();
  expect(screen.getByText(/cannot be undone with Undo/i)).toBeInTheDocument();

  userEvent.click(screen.getByRole("button", { name: "Drop the team" }));
  expect(onRepair).toHaveBeenCalledWith({ type: "dropTeam", teamId: "t2" });
});

// ---- Finding 5: a dropped team stops being reported as unscheduled --------
// computeStats.unscheduledTeamIds derives from basis.teamIds. A dropTeam
// repair deletes the assignment directly (it bypasses applyEdit by design),
// so if it does not also drop the team from basis.teamIds, the team
// reappears instantly in PlanGrid's "Unscheduled teams" panel with a Place
// button -- inviting the organizer to re-place a team that just withdrew.

test("dropping a team through drift repair also removes it from basis.teamIds", async () => {
  mockSubscribeDraft.mockImplementation((cb) => { cb(makePlan()); return () => {}; });
  const drift = {
    blocking: [{
      kind: "teamWithdrew",
      message: "Borealis withdrew its submission since this plan was built.",
      repair: { type: "dropTeam", teamId: "t2" },
    }],
    advisory: [],
  };
  publishPlan.mockResolvedValue({ ok: false, drift });

  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");

  userEvent.click(screen.getByRole("button", { name: "Publish schedule" }));
  userEvent.click(await screen.findByRole("button", { name: "Publish" }));

  userEvent.click(await screen.findByRole("button", { name: "Drop" }));
  userEvent.click(await screen.findByRole("button", { name: "Drop the team" }));

  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled());
  const [savedPlan] = mockSaveDraft.mock.calls[0];
  expect(savedPlan.assignments.t2).toBeUndefined();
  expect(savedPlan.basis.teamIds).not.toContain("t2");
});

// ---- Finding 6: sequential edits do not get told another organizer moved
// the draft --------------------------------------------------------------
// handleRepair used to build every op from the `plan` captured at the last
// render, relying on the subscription echo to advance `version` before the
// next op ran. Two repairs applied back to back -- normal when working
// through a drift list -- would both be built from the SAME stale plan if
// the echo had not landed yet, and the second saveDraft would either be
// refused as stale or (as this test proves) silently discard the first edit.

test("applying two repairs in a row builds the second on top of the first, not the stale render-time plan", async () => {
  const basis = {
    // t3 and t4 submitted AFTER this plan was built -- they are deliberately
    // absent from basis.teamIds (the world at plan-build time), so PlanGrid's
    // "Unscheduled teams" sidebar does not ALSO render a "Place" button for
    // them alongside DriftPanel's, which would make the two indistinguishable
    // by accessible name below.
    teamIds: ["t1", "t2"], judgeIds: ["j0", "j1", "j2", "j3"],
    rooms: ["R1", "R2", "R3", "R4"], batchCount: 1,
    batchTimes: { 1: "5:00 PM" }, target: 2,
  };
  const initialPlan = makePlan({
    basis,
    teamNames: { t1: "Aurora", t2: "Borealis", t3: "Vireo", t4: "Wren" },
  });

  mockSubscribeDraft.mockImplementation((cb) => { cb(initialPlan); return () => {}; });
  mockSaveDraft.mockImplementation(async (savedPlan) => ({
    ok: true, version: (savedPlan.version ?? 0) + 1,
  }));

  const drift = {
    blocking: [
      {
        kind: "teamAppeared",
        message: "Vireo submitted after this plan was built and has no slot.",
        repair: { type: "moveTeam", teamId: "t3", batch: 1, room: "R3", teamName: "Vireo" },
      },
      {
        kind: "teamAppeared",
        message: "Wren submitted after this plan was built and has no slot.",
        repair: { type: "moveTeam", teamId: "t4", batch: 1, room: "R4", teamName: "Wren" },
      },
    ],
    advisory: [],
  };
  publishPlan.mockResolvedValue({ ok: false, drift });

  renderPage(<SchedulePreview />);
  await screen.findByText("Aurora");

  userEvent.click(screen.getByRole("button", { name: "Publish schedule" }));
  userEvent.click(await screen.findByRole("button", { name: "Publish" }));

  const firstPlace = await screen.findAllByRole("button", { name: "Place" });
  expect(firstPlace).toHaveLength(2);
  userEvent.click(firstPlace[0]);

  // Wait for the DOM, not just the mock call count -- `mockSaveDraft`'s call
  // count ticks up the instant it is INVOKED, before its promise resolves and
  // before the repaired item is filtered out of the drift panel. Waiting on
  // the panel itself (down to one "Place" button) guarantees the first
  // repair's state update has actually landed before the second click fires.
  await waitFor(() => {
    expect(screen.getAllByRole("button", { name: "Place" })).toHaveLength(1);
  });
  const secondPlace = screen.getAllByRole("button", { name: "Place" });
  userEvent.click(secondPlace[0]);
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(2));

  const [firstCallPlan] = mockSaveDraft.mock.calls[0];
  const [secondCallPlan] = mockSaveDraft.mock.calls[1];

  // Under the bug, both saves are built from the same render-time `plan`
  // (version 1): the second call's version would equal the first's, and its
  // assignments would carry only t4, not both t3 and t4.
  expect(secondCallPlan.version).toBe(firstCallPlan.version + 1);
  expect(secondCallPlan.assignments.t3).toBeDefined();
  expect(secondCallPlan.assignments.t4).toBeDefined();
});

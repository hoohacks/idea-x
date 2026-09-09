/**
 * Team.js's save behaviour: a teammate's stale form must never overwrite a
 * submission it never saw.
 *
 * The idea name, problem statement and target industry are seeded from the
 * database exactly once per team -- deliberately, so a live update (a
 * teammate joining, an organizer editing something else) does not stomp on
 * what somebody is mid-sentence typing. Commit a5ed600 added that guard for
 * exactly that reason, and it must stay.
 *
 * But the guard has a mirror-image failure: a tab that has been open since
 * before a teammate finished and saved the REAL submission still holds
 * whatever text was there when THIS tab loaded, and clicking Save wrote that
 * straight over the real thing. This test drives the actual component
 * (rather than a pulled-out function -- the save logic lives inline in
 * handleSubmitProject) through that exact sequence: seed blank, a teammate
 * saves for real directly against the database, then this tab -- still
 * showing its own stale placeholder text -- hits Save.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

jest.mock("../../firebase", () => ({
  database: {},
  auth: { currentUser: { uid: "me" } },
  storage: {},
}));

// Layout brings in Nav, the drawer context and the footer -- none of which
// this test cares about, and all of which would need their own scaffolding
// to render. Standing in for it keeps this test about the save behaviour,
// not the chrome around it.
jest.mock("../Layout", () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

// A real AuthContext without the rest of App.js -- App.js pulls in every
// page in the site, none of which this test needs just to read `userData`
// off the context Team.js consumes.
jest.mock("../../App", () => ({
  __esModule: true,
  AuthContext: require("react").createContext(null),
}));

/** A tiny in-memory "database", keyed by the same path strings Team.js uses. */
const store = {};

const snap = (value) => ({
  exists: () => value !== undefined && value !== null,
  val: () => value,
});

let teamSnapshotCallback = null;

// These are plain functions, not jest.fn() wrappers -- react-scripts's Jest
// config sets `resetMocks: true`, which strips any implementation given to a
// jest.fn() before every single test (the first one included). A plain
// closure over `store` has no such implementation to strip.
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: async ({ path }) => snap(store[path]),
  set: async ({ path }, value) => {
    store[path] = value;
  },
  // Mirrors the real semantics used elsewhere in this codebase (see
  // draftConcurrency.test.js): the update function decides, from the value
  // actually stored right now, whether to commit -- returning undefined aborts.
  runTransaction: async ({ path }, updateFn) => {
    const current = store[path] ?? null;
    const next = updateFn(current);
    if (next === undefined) {
      return { committed: false, snapshot: snap(current) };
    }
    store[path] = next;
    return { committed: true, snapshot: snap(next) };
  },
  onValue: (_ref, cb) => {
    teamSnapshotCallback = cb;
    return () => {};
  },
}));

jest.mock("firebase/storage", () => ({
  ref: (_storage, path) => ({ path }),
  uploadBytesResumable: () => ({ on: () => {}, snapshot: { ref: {} } }),
  getDownloadURL: async () => "https://example.com/new-deck.pdf",
}));

const { AuthContext } = require("../../App");
const Team = require("./Team").default;

/** Pushes the current team value to the live subscription, the way onValue
 *  fires again after any write anywhere on the team -- a teammate's save
 *  included. */
function emitTeamSnapshot() {
  return teamSnapshotCallback(snap(store["teams/t1"]));
}

beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  teamSnapshotCallback = null;
});

function renderTeam() {
  const userData = { teamId: "t1" };
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ userData, refreshUserData: jest.fn() }}>
        <Team />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

test("a teammate's stale save does not overwrite a submission it never saw", async () => {
  // Nobody has submitted yet when this tab loads.
  store["teams/t1"] = { name: "Lumen", members: { me: true, ally: true } };

  renderTeam();
  await waitFor(() => expect(teamSnapshotCallback).not.toBeNull());
  await act(async () => {
    await emitTeamSnapshot();
  });

  // This tab was open early and typed a placeholder, then walked away.
  fireEvent.change(screen.getByLabelText(/idea name/i), {
    target: { value: "Placeholder idea" },
  });
  fireEvent.change(screen.getByLabelText(/problem statement/i), {
    target: { value: "TBD, need to think about this more" },
  });
  fireEvent.change(screen.getByLabelText(/target industry/i), {
    target: { value: "Uncertain" },
  });

  // Meanwhile, the real teammate finishes and saves -- directly against the
  // database, exactly as if it happened in a different tab this one never
  // saw update.
  store["teams/t1/submission"] = {
    ideaName: "Real Idea",
    problemStatement: "The real problem statement, written by the teammate who finished it.",
    targetIndustry: "Healthcare",
    pitchDeckName: "final-deck.pdf",
    pitchDeckURL: "https://example.com/final-deck.pdf",
  };
  store["teams/t1/submitted"] = true;

  // The live subscription fires again -- this is real, not a test shortcut:
  // onValue fires for every change to the team, including a teammate's save.
  // The seed guard is what keeps this tab's three text fields unchanged
  // afterward; it does not freeze `teamData` itself.
  await act(async () => {
    await emitTeamSnapshot();
  });

  // Sanity check that the guard under test is actually doing what commit
  // a5ed600 needs it to do: the fields still show this tab's own stale text,
  // not the teammate's, even though the live subscription just updated.
  expect(screen.getByLabelText(/idea name/i)).toHaveValue("Placeholder idea");

  // Now this tab does "one unrelated thing" -- picks a new pitch deck -- and
  // hits Save, never having seen the teammate's text.
  const fileInput = document.querySelector('input[type="file"]');
  fireEvent.change(fileInput, {
    target: { files: [new File(["deck bytes"], "updated-deck.pdf", { type: "application/pdf" })] },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /save submission/i }));
  });

  await waitFor(() => {
    expect(store["teams/t1/submission"].ideaName).toBe("Real Idea");
  });

  // The teammate's real text must survive completely, not just the idea name.
  expect(store["teams/t1/submission"].problemStatement).toBe(
    "The real problem statement, written by the teammate who finished it."
  );
  expect(store["teams/t1/submission"].targetIndustry).toBe("Healthcare");

  // The save must have refused, not silently "succeeded" over the real data.
  expect(screen.queryByText(/submission received/i)).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(/reload the page/i);
});

test("an uncontested save still writes normally", async () => {
  store["teams/t1"] = { name: "Lumen", members: { me: true } };

  renderTeam();
  await waitFor(() => expect(teamSnapshotCallback).not.toBeNull());
  await act(async () => {
    await emitTeamSnapshot();
  });

  fireEvent.change(screen.getByLabelText(/idea name/i), {
    target: { value: "My Idea" },
  });
  fireEvent.change(screen.getByLabelText(/problem statement/i), {
    target: { value: "A problem worth solving." },
  });
  fireEvent.change(screen.getByLabelText(/target industry/i), {
    target: { value: "Education" },
  });

  const fileInput = document.querySelector('input[type="file"]');
  fireEvent.change(fileInput, {
    target: { files: [new File(["deck bytes"], "deck.pdf", { type: "application/pdf" })] },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /save submission/i }));
  });

  await waitFor(() => {
    expect(store["teams/t1/submission"]).toMatchObject({ ideaName: "My Idea" });
  });
  expect(store["teams/t1/submitted"]).toBe(true);
  expect(await screen.findByText(/submission received/i)).toBeInTheDocument();
});

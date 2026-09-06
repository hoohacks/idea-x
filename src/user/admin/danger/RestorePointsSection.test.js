/**
 * The restore point list, rendered with a point in it.
 *
 * The page smoke test renders the whole control panel against a stubbed
 * database that returns nothing, so `points` is always empty there and the row
 * body never runs. That blind spot is how this section shipped rendering an
 * entire copy of the Registration Metrics page inside every row: the timestamp
 * was `<RegisteredAtDisplay value={point.at} />`, and RegisteredAtDisplay is
 * the metrics *page*, which takes no props, renders its own Layout and header,
 * and opens its own /competitors subscription.
 *
 * These render with a point present, which is the only state where that is
 * visible. The Preview dialog gets its own coverage below: it is what stands
 * between "Restore" and actually overwriting live data, so what it shows --
 * and what it falls back to when the judges read fails -- is worth pinning.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../../theme";

jest.mock("../../../firebase", () => ({ database: {} }));
const mockGet = jest.fn();
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
}));

const RestorePointsSection = require("./RestorePointsSection").default;

const mockPoint = {
  id: "snap-1",
  label: "Before the schedule was generated",
  at: Date.UTC(2026, 7, 30, 16, 1, 14),
  byName: "admin YtLiqYzF",
  bytes: 8192,
  paths: ["teams", "judges", "scores"],
};

/**
 * A snapshot with one added team, one lost score card by default.
 *
 * `extraJudgeScore: false` drops the live j1 card so live matches the
 * snapshot exactly on the scores path -- used to model the moment Preview is
 * first opened, before a judge has filed anything, in the race test below.
 */
function mockPreviewResult({ extraJudgeScore = true } = {}) {
  return {
    ok: true,
    entries: [
      { path: "teams", value: JSON.stringify({ t1: { name: "Aurora" } }) },
      { path: "scores", value: JSON.stringify({ first: { t1: { j0: { total: 30 } } } }) },
    ],
    live: {
      teams: { t1: { name: "Aurora" }, t2: { name: "New Team" } },
      scores: extraJudgeScore
        ? { first: { t1: { j0: { total: 30 }, j1: { total: 28 } } } }
        : { first: { t1: { j0: { total: 30 } } } },
    },
  };
}

jest.mock("../snapshots", () => ({
  JUDGING_PATHS: ["teams", "judges", "scores", "finalRound", "config/scheduleMeta"],
  subscribeToSnapshots: (callback) => {
    callback([mockPoint]);
    return () => {};
  },
  captureSnapshot: jest.fn(async () => ({ ok: true })),
  restoreSnapshot: jest.fn(async () => ({ ok: true, restored: 3 })),
  previewSnapshot: jest.fn(async () => mockPreviewResult()),
  readJudgeNames: jest.fn(async () => ({ ok: true, names: { j1: "Judge Smith" } })),
}));

const { restoreSnapshot, previewSnapshot, readJudgeNames } = require("../snapshots");

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation
 * off every jest.fn before each test -- so an implementation passed to
 * jest.fn() at declaration is gone by the time the first test runs. Every
 * implementation has to be re-established here.
 */
beforeEach(() => {
  restoreSnapshot.mockReset();
  restoreSnapshot.mockResolvedValue({ ok: true, restored: 3 });
  previewSnapshot.mockReset();
  previewSnapshot.mockResolvedValue(mockPreviewResult());
  readJudgeNames.mockReset();
  readJudgeNames.mockResolvedValue({ ok: true, names: { j1: "Judge Smith" } });
  mockGet.mockReset();
  mockGet.mockResolvedValue({ exists: () => false, val: () => null });
});

function renderSection(onResult = jest.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <RestorePointsSection onResult={onResult} />
    </ThemeProvider>
  );
}

describe("a restore point row", () => {
  test("shows when it was taken, who by, and how big", () => {
    renderSection();

    expect(screen.getByText("Before the schedule was generated")).toBeInTheDocument();

    // the date matters as well as the time -- a restore point can be older than today
    const caption = screen.getByText(/admin YtLiqYzF/);
    expect(caption).toHaveTextContent(new Date(mockPoint.at).toLocaleString());
    expect(caption).toHaveTextContent("8 KB");

    // restoring happens from inside the preview dialog now, not straight off the row
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  test("does not render another page inside itself", () => {
    renderSection();

    // the metrics page, if it leaks back in, announces itself with this heading
    expect(screen.queryByRole("heading", { name: "Registration Metrics" })).toBeNull();

    // and a nested Layout would put a second navigation landmark on the page
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
  });
});

describe("the preview dialog", () => {
  test("names the team and judge behind a lost score", async () => {
    renderSection();
    userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(previewSnapshot).toHaveBeenCalledWith("snap-1");
    expect(
      await screen.findByText("1 score card will be destroyed: Aurora by Judge Smith (first)")
    ).toBeInTheDocument();

    // the per-path counts are shown too -- scoped to the diff line's <strong>,
    // since "teams" also appears in the row's path Chip
    const teamsLine = screen.getByText("teams", { selector: "strong" }).closest("p");
    expect(teamsLine).toHaveTextContent("teams — 0 added, 0 changed, 1 removed");
  });

  test("names both cards distinguishably when the same team+judge loses a card in two different rounds", async () => {
    // The bare "scores" path lets one team+judge pair carry a card in more
    // than one round -- a first-round judge not excluded from that team in
    // the final, scored in both. Without the round in the line, two
    // distinct destroyed cards for "Aurora by Judge Smith" would render as
    // the same text twice.
    previewSnapshot.mockResolvedValue({
      ok: true,
      entries: [
        { path: "teams", value: JSON.stringify({ t1: { name: "Aurora" } }) },
        { path: "scores", value: JSON.stringify({}) },
      ],
      live: {
        teams: { t1: { name: "Aurora" } },
        scores: {
          first: { t1: { j1: { total: 30 } } },
          final: { t1: { j1: { total: 45 } } },
        },
      },
    });
    renderSection();
    userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      await screen.findByText(
        "2 score cards will be destroyed: Aurora by Judge Smith (first), Aurora by Judge Smith (final)"
      )
    ).toBeInTheDocument();
  });

  test("falls back to the judge's uid when the one-shot judges read fails", async () => {
    readJudgeNames.mockResolvedValue({ ok: false, error: "no permission", names: {} });
    renderSection();
    userEvent.click(screen.getByRole("button", { name: "Preview" }));

    // the dialog still opens and still names the team -- only the judge falls back
    expect(
      await screen.findByText("1 score card will be destroyed: Aurora by j1 (first)")
    ).toBeInTheDocument();
  });

  // ---- Finding 3: the typed confirmation is never the restore point's own
  // label. A label like "Manual restore point — 9/2/2026, 4:17:00 PM" cannot
  // be retyped on autopilot, on the one path used when something has already
  // gone wrong -- so this now follows the same rule as SchedulePreview's
  // publish confirmation: config/eventName when set, otherwise a short count.

  test("with no event name configured, restoring requires typing a short count -- typing the label does not work", async () => {
    const onResult = jest.fn();
    renderSection(onResult);
    userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText(/score card will be destroyed/);

    userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const confirmButton = await screen.findByRole("button", { name: "Restore" });
    // mockPreviewResult's `entries` cover two paths (teams, scores), and no
    // config/eventName is stubbed to exist -- so the phrase falls back to "2".
    const typedField = screen.getByLabelText('Type "2" to confirm');

    // The restore point's own label -- what this used to require -- must no
    // longer work.
    userEvent.type(typedField, "Before the schedule was generated");
    expect(confirmButton).toBeDisabled();

    userEvent.clear(typedField);
    userEvent.type(typedField, "2");
    expect(confirmButton).toBeEnabled();

    userEvent.click(confirmButton);

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(restoreSnapshot).toHaveBeenCalledWith("snap-1");
    expect(onResult).toHaveBeenCalledWith(
      { ok: true, restored: 3 },
      expect.stringContaining("Restored 3 path(s)")
    );
  });

  test("with an event name configured, restoring requires typing it instead of the count", async () => {
    mockGet.mockResolvedValue({ exists: () => true, val: () => "HooHacks Ideathon" });
    renderSection();
    userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText(/score card will be destroyed/);

    userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const confirmButton = await screen.findByRole("button", { name: "Restore" });
    const typedField = screen.getByLabelText('Type "HooHacks Ideathon" to confirm');

    userEvent.type(typedField, "2");
    expect(confirmButton).toBeDisabled();

    userEvent.clear(typedField);
    userEvent.type(typedField, "HooHacks Ideathon");
    expect(confirmButton).toBeEnabled();
  });

  // ---- Bug: the diff shown in Preview was computed once, when the dialog
  // opened, and never refreshed. An organizer can sit on "0 score cards will
  // be destroyed" for as long as it takes to talk a decision over -- and a
  // judge filing a card in that window was invisible to that diff. Clicking
  // Restore then destroyed a card that had appeared in no warning anyone saw,
  // even though restoreSnapshot itself is safe to call (it takes its own
  // pre-restore point) -- the organizer simply had no reason to look, because
  // nothing on screen ever told them there was now something to lose.
  test("refuses to restore silently when what would be destroyed changed after the preview was shown", async () => {
    const onResult = jest.fn();
    // Preview opens showing nothing at risk...
    previewSnapshot.mockReset();
    previewSnapshot
      .mockResolvedValueOnce(mockPreviewResult({ extraJudgeScore: false }))
      // ...but a judge files a card before the organizer gets to Restore, so
      // the re-check made at confirm time finds one.
      .mockResolvedValueOnce(mockPreviewResult({ extraJudgeScore: true }));

    renderSection(onResult);
    userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("teams", { selector: "strong" });
    expect(screen.queryByText(/score card will be destroyed/)).toBeNull();

    userEvent.click(screen.getByRole("button", { name: "Restore…" }));
    const confirmButton = await screen.findByRole("button", { name: "Restore" });
    userEvent.type(screen.getByLabelText('Type "2" to confirm'), "2");
    userEvent.click(confirmButton);

    // The restore must not go through on the stale, already-confirmed diff --
    // the organizer confirmed "0 score cards", not "1".
    await waitFor(() => expect(previewSnapshot).toHaveBeenCalledTimes(2));
    expect(restoreSnapshot).not.toHaveBeenCalled();

    // The newly-discovered loss is surfaced, not swallowed -- the preview
    // dialog is still open (or reopened) showing the up-to-date warning, so
    // the organizer can see exactly what they'd now be confirming.
    expect(
      await screen.findByText("1 score card will be destroyed: Aurora by Judge Smith (first)")
    ).toBeInTheDocument();
  });
});

/**
 * Judging progress, the page organizers watch while the pitches run.
 *
 * The arithmetic is tested in scores/judgingStatus.test.js. These check the page
 * built on it: that the teams in trouble come first and say so, that the header
 * adds up, that switching to the final round shows the finalists rather than a
 * filtered first round, and that the judges tab says who still owes a card.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import JudgingProgress from "./JudgingProgress";
import { renderPage } from "../../testing/renderPage";

vi.mock("../../firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "admin-1", email: "admin@example.com" } },
}));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
const db = await import("../../testing/fakeDatabase");

// the three one-team edits are stubbed, so these check the page asks for the
// right one; what each writes is tested in judge/assignmentEdits.test.js
const mockEdits = { assign: vi.fn(), unassign: vi.fn(), swap: vi.fn() };
vi.mock("../judge/assignmentEdits", async () => ({
  ...await vi.importActual("../judge/assignmentEdits"),
  assignJudgeToTeam: (...a) => mockEdits.assign(...a),
  unassignJudgeFromTeam: (...a) => mockEdits.unassign(...a),
  swapJudges: (...a) => mockEdits.swap(...a),
}));

const card = { problem: 7, innovation: 7, impact: 7, viability: 4, pitch_quality: 4 };
const NAMES = { j1: "Priya Raman", j2: "Sam Whitaker" };
// the roster on a schedule entry carries each judge's id and cached name
const slot = (room, time, batch, judges) => ({
  room, time, batch, judges: judges.map((judgeId) => ({ judgeId, judgeName: NAMES[judgeId] })),
});

beforeEach(() => {
  Object.values(mockEdits).forEach((fn) => fn.mockReset().mockResolvedValue({ ok: true }));
  db.reset({
    teams: {
      a: { name: "Almanac", submitted: true, schedule: slot("Rice 340", "5:00 PM", 1, ["j1", "j2"]) },
      b: { name: "Beacon", submitted: true, schedule: slot("Rice 342", "5:00 PM", 1, ["j1", "j2"]) },
      c: { name: "Compass", submitted: true, schedule: slot("Rice 344", "5:15 PM", 2, ["j1", "j2"]) },
    },
    judges: {
      j1: { firstName: "Priya", lastName: "Raman", email: "priya@capone.com", checkedIn: true, isRound1Judge: true,
        teamAssignments: { a: { teamName: "Almanac" }, b: { teamName: "Beacon" }, c: { teamName: "Compass" } } },
      j2: { firstName: "Sam", lastName: "Whitaker", email: "sam@deloitte.com", checkedIn: false, isRound1Judge: true,
        teamAssignments: { a: { teamName: "Almanac" }, b: { teamName: "Beacon" }, c: { teamName: "Compass" } },
        finalAssignments: { a: { teamName: "Almanac" } } },
    },
    scores: {
      first: {
        a: { j1: card, j2: card },
        b: { j1: card },
      },
    },
  });
});

const teamOrder = () =>
  screen.getAllByText(/^(Almanac|Beacon|Compass)$/).map((el) => el.textContent);

test("the teams in trouble come first, each saying what is wrong", () => {
  renderPage(<JudgingProgress />);
  expect(teamOrder()).toEqual(["Compass", "Beacon", "Almanac"]);

  const compass = within(screen.getByText("Compass").closest("[class*='MuiStack-root']").parentElement);
  expect(compass.getByText("No scores")).toBeInTheDocument();
  expect(screen.getByText("Thinly judged")).toBeInTheDocument();
});

test("the header adds up cards, gaps and arrivals", () => {
  renderPage(<JudgingProgress />);
  const count = (label) => screen.getByText(label).previousSibling.textContent;
  expect(count("scores in")).toBe("3/6");
  expect(count("no scores")).toBe("1");
  expect(count("thinly judged")).toBe("1");
  expect(count("judges checked in")).toBe("1/2");
});

test("a team with no scores raises a warning that says what to do", () => {
  renderPage(<JudgingProgress />);
  expect(screen.getByText(/1 team has no scores at all\. Use Judges on a row to send someone\./)).toBeInTheDocument();
});

test("each row names who is still to score it", () => {
  renderPage(<JudgingProgress />);
  expect(screen.getByText(/waiting on Sam Whitaker$/)).toBeInTheDocument();
});

test("search narrows by room as well as team", () => {
  renderPage(<JudgingProgress />);
  fireEvent.change(screen.getByPlaceholderText("Search teams or rooms"), { target: { value: "342" } });
  expect(teamOrder()).toEqual(["Beacon"]);
});

test("the judges tab says who has cards outstanding", () => {
  renderPage(<JudgingProgress />);
  fireEvent.click(screen.getByRole("tab", { name: "Judges (2)" }));
  expect(screen.getByText("Priya Raman")).toBeInTheDocument();
  expect(screen.getByText("Sam Whitaker")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Search judges")).toBeInTheDocument();
});

test("the final round, before it is activated, says there are no finalists yet", () => {
  renderPage(<JudgingProgress />);
  fireEvent.mouseDown(screen.getByRole("button", { name: /First round/ }));
  fireEvent.click(screen.getByRole("option", { name: "Final round" }));
  expect(screen.getByText(/The final round has not been activated/)).toBeInTheDocument();
});

test("the final round shows the finalists and their own panel, not the first round's", () => {
  db.setData("finalRound/teams", { a: { name: "Almanac" } });
  db.setData("teams/a/finalSlot", { room: "Rice 011", timeslot: "6:30 PM" });
  renderPage(<JudgingProgress />);

  fireEvent.mouseDown(screen.getByRole("button", { name: /First round/ }));
  fireEvent.click(screen.getByRole("option", { name: "Final round" }));

  expect(teamOrder()).toEqual(["Almanac"]);
  expect(screen.getByText(/Rice 011/)).toBeInTheDocument();
  expect(screen.getByText(/waiting on Sam Whitaker$/)).toBeInTheDocument();
  expect(screen.getByText(/Check the panel is in the room\./)).toBeInTheDocument();
});

test("a card that arrives is counted without a reload", () => {
  renderPage(<JudgingProgress />);
  // another device's write, arriving through the live subscription
  act(() => db.setData("scores/first/c/j1", card));
  expect(screen.getByText("scores in").previousSibling.textContent).toBe("4/6");
  expect(screen.queryByText("No scores")).not.toBeInTheDocument();
});

describe("changing one team's judges", () => {
  // three unassigned judges to choose from as well as the two on every panel
  beforeEach(() => {
    db.setData("judges/j3", { firstName: "Noor", lastName: "Haddad", checkedIn: false, isRound1Judge: true });
  });

  const openJudges = async (teamName) => {
    renderPage(<JudgingProgress />);
    let node = screen.getByText(teamName);
    while (node && !within(node).queryByRole("button", { name: "Judges" })) node = node.parentElement;
    fireEvent.click(within(node).getByRole("button", { name: "Judges" }));
    return within(await screen.findByRole("dialog"));
  };
  const pick = async (dialog, label, option) => {
    fireEvent.mouseDown(dialog.getByLabelText(label));
    fireEvent.click(await screen.findByRole("option", { name: option }));
  };

  test("adding offers only judges not already on the panel, and says who has not arrived", async () => {
    const dialog = await openJudges("Compass");
    expect(dialog.getByText("Judges for Compass")).toBeInTheDocument();
    fireEvent.mouseDown(dialog.getByLabelText("Judge"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Noor Haddad (not checked in)"]);
  });

  test("adding a judge asks for exactly that judge on exactly that team", async () => {
    const dialog = await openJudges("Compass");
    await pick(dialog, "Judge", /Noor Haddad/);
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockEdits.assign).toHaveBeenCalledWith({ judgeUid: "j3", teamId: "c" }));
    await waitFor(() => expect(screen.getByText("Updated the judges for Compass.")).toBeInTheDocument());
  });

  test("removing offers only the panel", async () => {
    const dialog = await openJudges("Compass");
    await pick(dialog, "Change", "Remove a judge");
    fireEvent.mouseDown(dialog.getByLabelText("Judge to remove"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Priya Raman", "Sam Whitaker"]);
    fireEvent.click(screen.getByRole("option", { name: "Sam Whitaker" }));
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockEdits.unassign).toHaveBeenCalledWith({ judgeUid: "j2", teamId: "c" }));
  });

  test("a swap needs both who leaves and who arrives", async () => {
    const dialog = await openJudges("Compass");
    await pick(dialog, "Change", "Swap a judge out");
    await pick(dialog, "Judge", /Noor Haddad/);
    expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();

    await pick(dialog, "Replace", "Sam Whitaker");
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(mockEdits.swap).toHaveBeenCalledWith({ teamId: "c", fromJudgeUid: "j2", toJudgeUid: "j3" })
    );
  });

  test("a refused change stays open and says why", async () => {
    mockEdits.assign.mockResolvedValue({ ok: false, error: "Noor Haddad is in another room at 5:15 PM." });
    const dialog = await openJudges("Compass");
    await pick(dialog, "Judge", /Noor Haddad/);
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(await dialog.findByText("Noor Haddad is in another room at 5:15 PM.")).toBeInTheDocument();
  });

  test("record score opens the paper form for that team", async () => {
    renderPage(<JudgingProgress />);
    let node = screen.getByText("Beacon");
    while (node && !within(node).queryByRole("button", { name: "Record score" })) node = node.parentElement;
    fireEvent.click(within(node).getByRole("button", { name: "Record score" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Record a score")).toBeInTheDocument();
    expect(dialog.getByText("Beacon")).toBeInTheDocument();
  });
});

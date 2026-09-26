/**
 * The final round planner, driven through its page.
 *
 * The plan arithmetic (buildFinalPlan, applyFinalEdit) is real here; only the
 * edges are stubbed -- where a plan is read from and saved to, and the publish.
 * So what is checked is that each button asks for the edit it says, that the
 * edited plan is the one saved, and that a publish goes through a confirmation
 * and reports what happened, including when the event moved underneath it.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import FinalRoundPlanner from "./FinalRoundPlanner";
import { renderPage } from "../../../testing/renderPage";
import { buildFinalPlan } from "../../judge/finalRoundPlan";

jest.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
jest.mock("../../../firebase.js", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
const db = require("../../../testing/fakeDatabase");

const mock = {
  planFinalRound: jest.fn(),
  publishFinalRound: jest.fn(),
  saveFinalDraft: jest.fn(),
  clearFinalDraft: jest.fn(),
};
let pushDraft = () => {};
jest.mock("../../judge/finalRoundService.js", () => ({
  ...jest.requireActual("../../judge/finalRoundService.js"),
  planFinalRound: (...a) => mock.planFinalRound(...a),
  publishFinalRound: (...a) => mock.publishFinalRound(...a),
}));
jest.mock("../../judge/finalDraftStore.js", () => ({
  subscribeFinalDraft: (callback) => {
    pushDraft = callback;
    return () => {};
  },
  saveFinalDraft: (...a) => mock.saveFinalDraft(...a),
  clearFinalDraft: (...a) => mock.clearFinalDraft(...a),
}));

const ranked = [
  { teamId: "a", name: "Almanac", averageScore: 34.5, judgeCount: 3, fundableVotes: 3 },
  { teamId: "b", name: "Beacon", averageScore: 31, judgeCount: 3, fundableVotes: 2 },
  { teamId: "c", name: "Compass", averageScore: 22, judgeCount: 2, fundableVotes: 0 },
];
const pool = [
  { judgeId: "j1", judgeName: "Priya Raman" },
  { judgeId: "j2", judgeName: "Sam Whitaker" },
];
const plan = () => buildFinalPlan({ ranked, pool, size: 2, room: "Rice 011" });

beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.saveFinalDraft.mockImplementation(async (next) => {
    // the store echoes a saved draft back to every subscriber, this page included
    act(() => pushDraft(next));
    return { ok: true };
  });
  mock.clearFinalDraft.mockImplementation(async () => {
    act(() => pushDraft(null));
    return { ok: true };
  });
  db.reset({
    judges: {
      j1: { firstName: "Priya", lastName: "Raman", isFinalRoundJudge: true },
      j2: { firstName: "Sam", lastName: "Whitaker", isFinalRoundJudge: true },
      j3: { firstName: "Noor", lastName: "Haddad" },
    },
  });
});

const openWith = (draft) => {
  renderPage(<FinalRoundPlanner />);
  act(() => pushDraft(draft));
};
const lastSaved = () => mock.saveFinalDraft.mock.calls[mock.saveFinalDraft.mock.calls.length - 1][0];
const orderIn = (saved) =>
  Object.values(saved.assignments).sort((x, y) => x.order - y.order).map((slot) => slot.teamName);

test("while the draft is loading it holds the page's shape", () => {
  renderPage(<FinalRoundPlanner />);
  expect(screen.getByRole("status", { name: "Loading the final round plan" })).toBeInTheDocument();
});

test("with no draft, building one writes nothing but the draft", async () => {
  mock.planFinalRound.mockResolvedValue({ ok: true, plan: plan() });
  openWith(null);

  fireEvent.click(screen.getByRole("button", { name: "Build a final round plan" }));
  await waitFor(() => expect(mock.saveFinalDraft).toHaveBeenCalled());
  expect(lastSaved().version).toBe(0);
  expect(mock.publishFinalRound).not.toHaveBeenCalled();
  expect(await screen.findByText(/Built a final round plan/)).toBeInTheDocument();
});

test("a build that fails says why and stays on the empty state", async () => {
  mock.planFinalRound.mockResolvedValue({ ok: false, error: "Nobody has been scored yet." });
  openWith(null);
  fireEvent.click(screen.getByRole("button", { name: "Build a final round plan" }));
  expect(await screen.findByText("Nobody has been scored yet.")).toBeInTheDocument();
  expect(mock.saveFinalDraft).not.toHaveBeenCalled();
});

test("a plan shows the running order, each panel, and the numbers above it", () => {
  openWith(plan());
  expect(screen.getByText("Running order in Rice 011")).toBeInTheDocument();
  expect(screen.getByText("Almanac")).toBeInTheDocument();
  expect(screen.getByText("Beacon")).toBeInTheDocument();
  expect(screen.getAllByText("Priya Raman, Sam Whitaker")).toHaveLength(2);
  expect(screen.getByText("2 of 3")).toBeInTheDocument();
});

test("moving a team later saves the plan with the order swapped", async () => {
  openWith(plan());
  const laterButtons = screen.getAllByRole("button").filter((b) => b.textContent === "↓");
  expect(laterButtons[laterButtons.length - 1]).toBeDisabled();

  fireEvent.click(laterButtons[0]);
  await waitFor(() => expect(mock.saveFinalDraft).toHaveBeenCalled());
  expect(orderIn(lastSaved())).toEqual(["Beacon", "Almanac"]);
  expect(await screen.findByRole("button", { name: "Undo (1)" })).toBeEnabled();
});

test("undo puts the last edit back", async () => {
  openWith(plan());
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

  fireEvent.click(screen.getAllByRole("button").filter((b) => b.textContent === "↓")[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Undo (1)" }));
  await waitFor(() => expect(orderIn(lastSaved())).toEqual(["Almanac", "Beacon"]));
});

test("the ranking can drop a finalist and bring in the next team", async () => {
  openWith(plan());
  fireEvent.click(screen.getByRole("button", { name: "Change who is in" }));

  const ranking = within(screen.getByText("The ranking").parentElement);
  expect(ranking.getByText("34.5 · 3 judges · 3 fundable")).toBeInTheDocument();

  const compassRow = ranking.getByText("Compass").parentElement;
  fireEvent.click(within(compassRow).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(Object.keys(lastSaved().assignments)).toContain("c"));

  const beaconRow = within(screen.getByText("The ranking").parentElement).getByText("Beacon").parentElement;
  fireEvent.click(within(beaconRow).getByRole("button", { name: "Drop" }));
  await waitFor(() => expect(Object.keys(lastSaved().assignments)).not.toContain("b"));
});

test("a finalist with nobody on its panel is called out, before and at publish", async () => {
  const empty = plan();
  empty.assignments.b.judges = [];
  openWith(empty);

  expect(screen.getByText("nobody on the panel, so it presents to an empty room")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Publish the final round" }));
  expect(await screen.findByText("Beacon has nobody on its panel.")).toBeInTheDocument();
});

test("publishing asks first, then reports how many teams went out and where", async () => {
  mock.publishFinalRound.mockResolvedValue({ ok: true, warnings: ["Two judges are not checked in."] });
  openWith(plan());

  fireEvent.click(screen.getByRole("button", { name: "Publish the final round" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("2 teams in Rice 011.")).toBeInTheDocument();
  expect(mock.publishFinalRound).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
  expect(await screen.findByText("2 teams in Rice 011")).toBeInTheDocument();
  expect(screen.getByText("Two judges are not checked in.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Watch final round progress" })).toHaveAttribute("href", "/user/admin/judging");
});

test("a publish refused because the event moved names what moved and offers the repair", async () => {
  mock.publishFinalRound.mockResolvedValue({
    ok: false,
    drift: [{ level: "blocking", message: "Sam Whitaker is no longer a judge.", repair: "removeJudge", teamId: "a", judgeId: "j2" }],
  });
  openWith(plan());
  fireEvent.click(screen.getByRole("button", { name: "Publish the final round" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));

  expect(await screen.findByText("The event moved since this plan was built. Nothing was written.")).toBeInTheDocument();
  expect(screen.getByText("Sam Whitaker is no longer a judge.")).toBeInTheDocument();

  // the confirmation is still leaving, and hides the page from roles until it has
  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(lastSaved().assignments.a.judges.map((judge) => judge.judgeId)).toEqual(["j1"])
  );
});

test("a publish that fails outright says so and keeps the plan", async () => {
  mock.publishFinalRound.mockResolvedValue({ ok: false, error: "Could not reach the database." });
  openWith(plan());
  fireEvent.click(screen.getByRole("button", { name: "Publish the final round" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));

  expect(await screen.findByText("Could not reach the database.")).toBeInTheDocument();
  expect(screen.getByText("Running order in Rice 011")).toBeInTheDocument();
});

test("discarding asks first, and says how many hand edits it loses", async () => {
  openWith(plan());
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("0 hand edits would be lost.")).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(mock.clearFinalDraft).toHaveBeenCalled());
  expect(await screen.findByRole("button", { name: "Build a final round plan" })).toBeInTheDocument();
});

test("a refused save is shown and the plan is left as it was", async () => {
  mock.saveFinalDraft.mockResolvedValue({ ok: false, error: "Another organizer changed this draft." });
  openWith(plan());
  fireEvent.click(screen.getAllByRole("button").filter((b) => b.textContent === "↓")[0]);
  expect(await screen.findByText("Another organizer changed this draft.")).toBeInTheDocument();
  expect(screen.getAllByText(/^(Almanac|Beacon)$/).map((el) => el.textContent)).toEqual(["Almanac", "Beacon"]);
});

/**
 * The Teams page against a populated database.
 *
 * What an organizer reads here decides the final round: which teams have been
 * scored, by whom, and how they rank. So the score summary, the sort, and the
 * one destructive action on the page (deleting a card) are what is checked.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TeamSearch from "./TeamSearch";
import { renderPage } from "../../testing/renderPage";

jest.mock("../../firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "admin-1", email: "admin@example.com" } },
}));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const db = require("../../testing/fakeDatabase");

// the one write on this page with consequences is stubbed, so the test sees
// exactly what it was asked to delete
const mockDeleteScore = jest.fn();
jest.mock("./danger/dangerZone", () => ({
  ...jest.requireActual("./danger/dangerZone"),
  deleteScore: (...args) => mockDeleteScore(...args),
}));

const card = (points, extra = {}) => ({
  problem: points, innovation: points, impact: points,
  viability: Math.round(points / 2), pitch_quality: Math.round(points / 2),
  ...extra,
});

beforeEach(() => {
  mockDeleteScore.mockReset();
  mockDeleteScore.mockResolvedValue({ ok: true, card: card(6) });
  db.reset({
    teams: {
      a: {
        name: "Almanac", submitted: true, members: { c1: true, c2: true },
        schedule: { time: "5:00 PM", room: "Rice 340" },
        submission: { ideaName: "Field Ledger", problemStatement: "Farm records are on paper.", targetIndustry: "Agriculture" },
      },
      b: { name: "Beacon", submitted: true, members: { c3: true } },
      c: { name: "Compass", submitted: false },
    },
    competitors: {
      c1: { firstName: "Maya", lastName: "Okafor" },
      c2: { firstName: "Theo", lastName: "Brandt" },
      c3: { firstName: "Noor", lastName: "Haddad" },
    },
    judges: { j1: { firstName: "Priya", lastName: "Raman" }, j2: { firstName: "Sam", lastName: "Whitaker" } },
    scores: {
      first: {
        a: { j1: card(6, { fundable: true }), j2: card(4) },
        b: { j1: card(10, { fundable: true, notes: "Strongest demo of the day" }) },
      },
    },
  });
});

const teamNames = () =>
  screen.getAllByText(/^(Almanac|Beacon|Compass)$/, { selector: "p" }).map((el) => el.textContent);

test("the header counts teams and how many have submitted", async () => {
  renderPage(<TeamSearch />);
  expect(await screen.findByText("67%")).toBeInTheDocument();
  expect(screen.getByText("of teams")).toBeInTheDocument();
});

test("a team lists its members by name, not by account id", async () => {
  renderPage(<TeamSearch />);
  expect(await screen.findByText("Maya Okafor, Theo Brandt")).toBeInTheDocument();
  expect(screen.getByText("Noor Haddad")).toBeInTheDocument();
});

test("the first round summary gives the average, the judge count and fundable votes", async () => {
  renderPage(<TeamSearch />);
  // Almanac: cards of 24 and 16 out of 40, so an average of 20
  expect(await screen.findByText(/20\.0 \/ 40 · 2 judges · 1 fundable/)).toBeInTheDocument();
  expect(screen.getByText(/40\.0 \/ 40 · 1 judge · 1 fundable/)).toBeInTheDocument();
});

test("teams are listed by name, and by score on request", async () => {
  renderPage(<TeamSearch />);
  await screen.findByText("Maya Okafor, Theo Brandt");
  expect(teamNames()).toEqual(["Almanac", "Beacon", "Compass"]);

  fireEvent.click(within(screen.getByRole("group", { name: "Sort by" })).getByRole("button", { name: "First round score" }));
  // Beacon 40, Almanac 20, Compass unscored
  expect(teamNames()).toEqual(["Beacon", "Almanac", "Compass"]);
});

test("search matches the idea name as well as the team name", async () => {
  renderPage(<TeamSearch />);
  await screen.findByText("Maya Okafor, Theo Brandt");
  fireEvent.change(screen.getByPlaceholderText("Search team or idea name"), { target: { value: "ledger" } });
  expect(teamNames()).toEqual(["Almanac"]);
});

test("opening a summary shows each judge's card, by name, with their note", async () => {
  renderPage(<TeamSearch />);
  const summary = await screen.findByText(/40\.0 \/ 40 · 1 judge/);
  fireEvent.click(summary);
  const opened = within(summary.closest(".MuiAccordion-root"));
  expect(opened.getByText("Priya Raman", { exact: false })).toBeInTheDocument();
  expect(opened.getByText("“Strongest demo of the day”")).toBeInTheDocument();
});

test("deleting a card asks first, and deletes exactly that card", async () => {
  renderPage(<TeamSearch />);
  fireEvent.click(await screen.findByText(/40\.0 \/ 40 · 1 judge/));
  fireEvent.click(await screen.findByRole("button", { name: "Delete this card" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Priya Raman's first round card for/)).toBeInTheDocument();
  expect(mockDeleteScore).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(mockDeleteScore).toHaveBeenCalledWith(
      expect.objectContaining({ round: "first", teamId: "b", judgeUid: "j1" })
    )
  );
});

test("cancelling the delete leaves the card alone", async () => {
  renderPage(<TeamSearch />);
  fireEvent.click(await screen.findByText(/40\.0 \/ 40 · 1 judge/));
  fireEvent.click(await screen.findByRole("button", { name: "Delete this card" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mockDeleteScore).not.toHaveBeenCalled();
});

test("a refused delete says why and keeps the dialog open", async () => {
  mockDeleteScore.mockResolvedValue({ ok: false, error: "Only an admin can delete a card." });
  renderPage(<TeamSearch />);
  fireEvent.click(await screen.findByText(/40\.0 \/ 40 · 1 judge/));
  fireEvent.click(await screen.findByRole("button", { name: "Delete this card" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("Only an admin can delete a card.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

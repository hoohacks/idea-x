/**
 * Entering a judge's paper score by hand.
 *
 * This is the fallback when the network gives out in a judging room, so it is
 * used at the worst moment and has to be right first time: it must refuse a
 * half-filled card, file the score under the judge picked (not the organizer
 * typing it), and turn the form's strings into the numbers and boolean the
 * rules require.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import PaperScoreDialog from "./PaperScoreDialog";
import { renderPage } from "../../../testing/renderPage";

vi.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
vi.mock("firebase/database", async () => (await import("../../../testing/fakeDatabase")).module);

const mockWrite = vi.fn();
vi.mock("../../judge/getTeamInfo", async () => ({
  ...await vi.importActual("../../judge/getTeamInfo"),
  writeScoreOnBehalf: (...args) => mockWrite(...args),
}));

const team = { teamId: "t1", name: "Lantern", room: "Rice 340", time: "5:00 PM" };
const judges = [
  { judgeId: "j1", judgeName: "Priya Raman" },
  { judgeId: "j2", judgeName: "Sam Whitaker" },
];

let onClose;
let onSaved;
beforeEach(() => {
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  onClose = vi.fn();
  onSaved = vi.fn();
});

const open = (props = {}) =>
  renderPage(
    <PaperScoreDialog team={team} judges={judges} round="first" onClose={onClose} onSaved={onSaved} {...props} />
  );

const pick = async (label, option) => {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

async function fillCard() {
  await pick("Judge", "Sam Whitaker");
  await pick("Problem (of 10)", "8");
  await pick("Innovation (of 10)", "7");
  await pick("Impact (of 10)", "9");
  await pick("Viability (of 5)", "4");
  await pick("Pitch quality (of 5)", "5");
  await pick("Worth funding?", "Yes");
}

test("it names the team and counts what is still to fill in", () => {
  open();
  expect(screen.getByText("Lantern")).toBeInTheDocument();
  expect(screen.getByText("6 left to fill in")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record score" })).toBeDisabled();
});

test("a complete card shows its total and can be recorded", async () => {
  open();
  await fillCard();
  expect(screen.getByText("Total 33 / 40")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record score" })).toBeEnabled();
});

test("the score is filed under the judge picked, as numbers and a boolean", async () => {
  open();
  await fillCard();
  fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Strong demo" } });
  fireEvent.click(screen.getByRole("button", { name: "Record score" }));

  await waitFor(() => expect(mockWrite).toHaveBeenCalled());
  expect(mockWrite).toHaveBeenCalledWith({
    round: "first",
    teamId: "t1",
    teamName: "Lantern",
    judgeUid: "j2",
    score: {
      problem: 8, innovation: 7, impact: 9, viability: 4, pitch_quality: 5,
      fundable: true, notes: "Strong demo",
      teamName: "Lantern", room: "Rice 340", time: "5:00 PM",
    },
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Recorded a score for Lantern."));
  expect(onClose).toHaveBeenCalled();
});

test("a card with every criterion but no judge cannot be recorded", async () => {
  open();
  await pick("Problem (of 10)", "8");
  await pick("Innovation (of 10)", "7");
  await pick("Impact (of 10)", "9");
  await pick("Viability (of 5)", "4");
  await pick("Pitch quality (of 5)", "5");
  await pick("Worth funding?", "No");
  expect(screen.getByRole("button", { name: "Record score" })).toBeDisabled();
});

test("a refused write keeps the dialog open and says why", async () => {
  mockWrite.mockRejectedValue(new Error("PERMISSION_DENIED"));
  open();
  await fillCard();
  fireEvent.click(screen.getByRole("button", { name: "Record score" }));
  expect(await screen.findByText("PERMISSION_DENIED")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("re-entering a deleted card starts from its values and its judge", () => {
  open({
    initialJudgeUid: "j1",
    initialValues: { problem: "6", innovation: "6", impact: "6", viability: "3", pitch_quality: "3", fundable: "no" },
  });
  expect(screen.getByText("Total 24 / 40")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record score" })).toBeEnabled();
});

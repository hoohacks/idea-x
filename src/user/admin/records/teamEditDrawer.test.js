/**
 * The team edit drawer.
 *
 * Each control is a separate write with a different fan-out (a rename reaches
 * every judge's copy, a slot move reaches every assigned judge, a delete clears
 * every member), so each is checked to call exactly its own service with
 * exactly this team, and to stop and say so when that service refuses.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TeamEditDrawer from "./TeamEditDrawer";
import { renderPage } from "../../../testing/renderPage";

jest.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
const db = require("../../../testing/fakeDatabase");

const mock = {
  renameTeam: jest.fn(),
  overrideTeamSlot: jest.fn(),
  setTeamSubmitted: jest.fn(),
  forceIntoFinalRound: jest.fn(),
  listRooms: jest.fn(),
  findOpenSlots: jest.fn(),
  scheduleTeamIntoBatch: jest.fn(),
  deleteTeam: jest.fn(),
};
jest.mock("./recordEdits", () => ({ renameTeam: (...a) => mock.renameTeam(...a) }));
jest.mock("../danger/dangerZone", () => ({
  overrideTeamSlot: (...a) => mock.overrideTeamSlot(...a),
  setTeamSubmitted: (...a) => mock.setTeamSubmitted(...a),
  forceIntoFinalRound: (...a) => mock.forceIntoFinalRound(...a),
}));
jest.mock("../rooms/roomsService", () => ({ listRooms: (...a) => mock.listRooms(...a) }));
jest.mock("../../judge/assignmentEdits", () => ({
  findOpenSlots: (...a) => mock.findOpenSlots(...a),
  scheduleTeamIntoBatch: (...a) => mock.scheduleTeamIntoBatch(...a),
}));
jest.mock("../people/peopleService", () => ({ deleteTeam: (...a) => mock.deleteTeam(...a) }));

const scheduled = {
  name: "Lantern",
  submitted: true,
  members: { c1: true, c2: true },
  submission: { ideaName: "Night bus tracker" },
  schedule: { room: "Rice 340", time: "5:00 PM", batch: 1 },
};

let onClose;
let onResult;
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  for (const name of ["renameTeam", "overrideTeamSlot", "setTeamSubmitted", "forceIntoFinalRound", "scheduleTeamIntoBatch", "deleteTeam"]) {
    mock[name].mockResolvedValue({ ok: true });
  }
  mock.listRooms.mockResolvedValue(["Rice 340", "Rice 342"]);
  mock.findOpenSlots.mockResolvedValue([]);
  db.reset({
    judges: {
      j1: { firstName: "Priya", lastName: "Raman", isRound1Judge: true, checkedIn: true },
      j2: { firstName: "Sam", lastName: "Whitaker", isFinalRoundJudge: true, checkedIn: false },
    },
  });
  onClose = jest.fn();
  onResult = jest.fn();
});

const open = (team = scheduled) =>
  renderPage(<TeamEditDrawer team={team} teamId="t1" onClose={onClose} onResult={onResult} />);

const pick = async (label, option) => {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

test("it opens on the team, with the idea underneath", () => {
  open();
  expect(screen.getByText("Lantern", { selector: "h2, h6, p, span, div" })).toBeInTheDocument();
  expect(screen.getByText("Night bus tracker")).toBeInTheDocument();
  expect(screen.getByLabelText("Team name")).toHaveValue("Lantern");
  expect(screen.getByText("Batch 1 · moves every assigned judge too")).toBeInTheDocument();
});

test("nothing changed means nothing to save", () => {
  open();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a rename goes through the rename, and closes when it lands", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "  Lighthouse " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(mock.renameTeam).toHaveBeenCalledWith("t1", "  Lighthouse "));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true }, "Renamed to Lighthouse"));
  expect(mock.overrideTeamSlot).not.toHaveBeenCalled();
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("a refused rename stays open and says why", async () => {
  mock.renameTeam.mockResolvedValue({ ok: false, error: "Another team is already called that." });
  open();
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Beacon" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Another team is already called that.")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("moving the slot goes through the override with the new room and time", async () => {
  open();
  await pick("Room", "Rice 342");
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "5:30 PM" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(mock.overrideTeamSlot).toHaveBeenCalledWith({ teamId: "t1", teamName: "Lantern", room: "Rice 342", time: "5:30 PM" })
  );
  expect(mock.renameTeam).not.toHaveBeenCalled();
});

test("a room that is no longer on the list is still offered, so the slot is not blanked", async () => {
  mock.listRooms.mockResolvedValue(["Rice 342"]);
  open();
  fireEvent.mouseDown(screen.getByLabelText("Room"));
  expect(await screen.findByRole("option", { name: "Rice 340" })).toBeInTheDocument();
  expect(await screen.findByRole("option", { name: "Rice 342" })).toBeInTheDocument();
});

test("marking a team not submitted is written straight away", async () => {
  open();
  await pick("Submitted", "No");
  await waitFor(() =>
    expect(mock.setTeamSubmitted).toHaveBeenCalledWith({ teamId: "t1", teamName: "Lantern", submitted: false })
  );
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true }, "Marked as not submitted"));
});

test("the final round needs both a room and a time before it can be added", async () => {
  open();
  const add = screen.getByRole("button", { name: "Add to the final round" });
  expect(add).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Final round room"), { target: { value: "Rice 011" } });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Final round timeslot"), { target: { value: "6:30 PM" } });
  fireEvent.click(add);

  await waitFor(() =>
    expect(mock.forceIntoFinalRound).toHaveBeenCalledWith({ teamId: "t1", teamName: "Lantern", room: "Rice 011", timeslot: "6:30 PM" })
  );
});

test("a team already in the final round says where, and offers an update instead", () => {
  open({ ...scheduled, finalSlot: { room: "Rice 011", timeslot: "6:30 PM" } });
  expect(screen.getByText("Already in the final round: Rice 011 at 6:30 PM.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Update final round slot" })).toBeInTheDocument();
});

test("deleting asks first, names what goes with it, and can be backed out of", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Delete this team" }));
  expect(screen.getByText(/also clears 2 members' team/)).toBeInTheDocument();

  // the confirmation's own Cancel, not the drawer's
  const cancel = screen
    .getAllByRole("button", { name: "Cancel" })
    .find((button) => button.classList.contains("MuiButton-text"));
  fireEvent.click(cancel);
  expect(screen.getByRole("button", { name: "Delete this team" })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(mock.deleteTeam).not.toHaveBeenCalled();
});

test("a confirmed delete removes this team and closes", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Delete this team" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete Lantern" }));

  await waitFor(() => expect(mock.deleteTeam).toHaveBeenCalledWith({ teamId: "t1", teamName: "Lantern" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

describe("a team that submitted after the schedule was built", () => {
  const late = { name: "Latecomer", submitted: true, members: { c9: true } };

  test("with no schedule at all, it says there is nothing to slot into", async () => {
    open(late);
    expect(await screen.findByText(/No schedule has been generated yet/)).toBeInTheDocument();
  });

  test("full batches are offered but cannot be picked", async () => {
    mock.findOpenSlots.mockResolvedValue([
      { batch: 1, time: "5:00 PM", freeRooms: [] },
      { batch: 2, time: "5:15 PM", freeRooms: ["Rice 344"] },
    ]);
    open(late);
    fireEvent.mouseDown(await screen.findByLabelText("Batch"));
    expect(await screen.findByRole("option", { name: /Batch 1 · 5:00 PM · no free rooms/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: /Batch 2 · 5:15 PM · 1 room\(s\) free/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  test("it is slotted into the picked batch, room and judges, at that batch's time", async () => {
    mock.findOpenSlots.mockResolvedValue([{ batch: 2, time: "5:15 PM", freeRooms: ["Rice 344"] }]);
    open(late);

    await screen.findByLabelText("Batch");
    await pick("Batch", /Batch 2/);
    await pick("Room", "Rice 344");
    fireEvent.mouseDown(screen.getByLabelText("Judges"));
    fireEvent.click(await screen.findByRole("option", { name: /Priya Raman/ }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Add to batch 2" }));
    await waitFor(() =>
      expect(mock.scheduleTeamIntoBatch).toHaveBeenCalledWith({
        teamId: "t1", batch: 2, room: "Rice 344", time: "5:15 PM", judgeUids: ["j1"],
      })
    );
  });

  test("a final-round judge and one not yet checked in are labelled as such", async () => {
    mock.findOpenSlots.mockResolvedValue([{ batch: 2, time: "5:15 PM", freeRooms: ["Rice 344"] }]);
    open(late);
    await screen.findByLabelText("Batch");
    await pick("Batch", /Batch 2/);
    fireEvent.mouseDown(screen.getByLabelText("Judges"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText(/Sam Whitaker \(final round judge\) \(not checked in\)/)).toBeInTheDocument();
  });
});

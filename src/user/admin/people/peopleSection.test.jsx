/**
 * The People tab of the control panel.
 *
 * Every control on a row changes who someone is to the event -- their role,
 * whether they are an organizer, whether they exist at all -- so each is checked
 * to ask first where it should, and to hand the service exactly the person and
 * the change the organizer picked. The service itself (what those writes are)
 * is tested in peopleService.test.js; here it is stubbed so the page is what is
 * under test.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import PeopleSection from "./PeopleSection";
import { renderPage } from "../../../testing/renderPage";

jest.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);

const mockService = {
  listPeople: jest.fn(),
  setSoleRole: jest.fn(),
  setOrganizer: jest.fn(),
  deletePerson: jest.fn(),
  sendReset: jest.fn(),
  listArchived: jest.fn(),
  restoreArchived: jest.fn(),
  bulkSet: jest.fn(),
};
jest.mock("./peopleService", () => ({
  ...jest.requireActual("./peopleService"),
  listPeople: (...a) => mockService.listPeople(...a),
  setSoleRole: (...a) => mockService.setSoleRole(...a),
  setOrganizer: (...a) => mockService.setOrganizer(...a),
  deletePerson: (...a) => mockService.deletePerson(...a),
  sendReset: (...a) => mockService.sendReset(...a),
  listArchived: (...a) => mockService.listArchived(...a),
  restoreArchived: (...a) => mockService.restoreArchived(...a),
  bulkSet: (...a) => mockService.bulkSet(...a),
}));

const PEOPLE = [
  { uid: "admin-1", name: "Olu Admin", email: "olu@example.com", roles: ["admin", "judge"], judge: {}, competitor: null },
  { uid: "c-1", name: "Maya Okafor", email: "maya@virginia.edu", roles: ["competitor"], judge: null, competitor: {} },
  { uid: "j-1", name: "Priya Raman", email: "priya@capone.com", roles: ["judge"], judge: {}, competitor: null },
  { uid: "x-1", name: "(no profile) x-1", email: "", roles: [], judge: null, competitor: null },
];

let onResult;
beforeEach(() => {
  Object.values(mockService).forEach((fn) => fn.mockReset());
  mockService.listPeople.mockResolvedValue(PEOPLE);
  for (const name of ["setSoleRole", "setOrganizer", "deletePerson", "sendReset", "restoreArchived", "bulkSet"]) {
    mockService[name].mockResolvedValue({ ok: true });
  }
  mockService.listArchived.mockResolvedValue([]);
  onResult = jest.fn();
});

const open = async () => {
  renderPage(<PeopleSection onResult={onResult} />);
  await screen.findByText("Maya Okafor");
};

// a person's row: the smallest ancestor of their name that holds their role picker
const rowElement = (name) => {
  let node = screen.getByText(name);
  while (node && !within(node).queryByRole("button", { name: /More for/ })) node = node.parentElement;
  return node;
};
const row = (name) => within(rowElement(name));
// The role picker is named by an aria-labelledby pointing at a React useId,
// whose colons jsdom's name lookup cannot resolve (a browser can). So it is
// found by what it shows.
const rolePicker = (name) => rowElement(name).querySelector(".MuiSelect-select");

test("each person shows their name and email, with admins counted separately", async () => {
  await open();
  expect(screen.getByText("maya@virginia.edu")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Everyone 4" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Admins 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Judges 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Competitors 1" })).toBeInTheDocument();
});

test("someone with no email says so rather than showing a blank", async () => {
  await open();
  expect(row("(no profile) x-1").getByText("No email on file")).toBeInTheDocument();
});

test("the role filter narrows the list", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Competitors 1" }));
  expect(screen.getByText("Maya Okafor")).toBeInTheDocument();
  expect(screen.queryByText("Priya Raman")).not.toBeInTheDocument();
  expect(screen.getByText("Showing 1 of 4")).toBeInTheDocument();
});

test("search matches on email", async () => {
  await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Search name, email or uid" }), { target: { value: "capone" } });
  expect(screen.getByText("Priya Raman")).toBeInTheDocument();
  expect(screen.queryByText("Maya Okafor")).not.toBeInTheDocument();
});

test("the admin switch sits beside the role and flips only admin access", async () => {
  await open();
  const priya = row("Priya Raman");
  const admin = priya.getByRole("checkbox", { name: "Admin" });
  expect(admin).not.toBeChecked();

  fireEvent.click(admin);
  await waitFor(() =>
    expect(mockService.setOrganizer).toHaveBeenCalledWith({ uid: "j-1", name: "Priya Raman", enabled: true })
  );
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true }, "Priya Raman is now an admin"));
  expect(mockService.setSoleRole).not.toHaveBeenCalled();
});

test("an admin's switch is on, and the role underneath it still shows", async () => {
  await open();
  const olu = row("Olu Admin");
  expect(olu.getByRole("checkbox", { name: "Admin" })).toBeChecked();
  expect(rolePicker("Olu Admin")).toHaveTextContent("Judge");
});

test("changing a role asks first, and cancelling changes nothing", async () => {
  await open();
  fireEvent.mouseDown(rolePicker("Maya Okafor"));
  fireEvent.click(await screen.findByRole("option", { name: "Judge" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Make Maya Okafor a judge?")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mockService.setSoleRole).not.toHaveBeenCalled();
});

test("confirming a role change hands over exactly that person and role", async () => {
  await open();
  fireEvent.mouseDown(rolePicker("Maya Okafor"));
  fireEvent.click(await screen.findByRole("option", { name: "Judge" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Change role" }));

  await waitFor(() =>
    expect(mockService.setSoleRole).toHaveBeenCalledWith({ uid: "c-1", name: "Maya Okafor", role: "judge" })
  );
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true }, "Maya Okafor is now a judge"));
});

test("removing a role is worded as a removal", async () => {
  await open();
  fireEvent.mouseDown(rolePicker("Priya Raman"));
  fireEvent.click(await screen.findByRole("option", { name: "No role" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Remove Priya Raman's role?")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Remove role" })).toBeInTheDocument();
});

test("reset sends a link to that person's email", async () => {
  await open();
  fireEvent.click(row("Maya Okafor").getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(mockService.sendReset).toHaveBeenCalledWith("maya@virginia.edu"));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: true }, "Reset link sent to maya@virginia.edu"));
});

test("reset is unavailable for someone with no email", async () => {
  await open();
  expect(row("(no profile) x-1").getByRole("button", { name: "Reset" })).toBeDisabled();
});

test("delete asks first, keeps scores by default, and can be told to take them too", async () => {
  await open();
  fireEvent.click(row("Priya Raman").getByRole("button", { name: "Delete" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Delete Priya Raman?")).toBeInTheDocument();
  expect(within(dialog).getByText(/Their login will still work/)).toBeInTheDocument();
  const alsoScores = within(dialog).getByRole("checkbox", { name: "Also delete every score they filed" });
  expect(alsoScores).not.toBeChecked();

  fireEvent.click(alsoScores);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete records" }));
  await waitFor(() =>
    expect(mockService.deletePerson).toHaveBeenCalledWith({ uid: "j-1", name: "Priya Raman", includeScores: true })
  );
});

test("history lists archived records and restores the one picked", async () => {
  mockService.listArchived.mockResolvedValue([
    { key: "k1", role: "competitor", record: { firstName: "Priya", lastName: "Raman", email: "priya@old.edu" } },
  ]);
  await open();
  fireEvent.click(row("Priya Raman").getByRole("button", { name: "History" }));

  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("Competitor record")).toBeInTheDocument();
  expect(within(dialog).getByText(/priya@old.edu/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(mockService.restoreArchived).toHaveBeenCalledWith({ uid: "j-1", key: "k1" }));
});

test("history with nothing archived says so", async () => {
  await open();
  fireEvent.click(row("Maya Okafor").getByRole("button", { name: "History" }));
  expect(await screen.findByText(/Nothing archived/)).toBeInTheDocument();
});

test("selecting people offers the bulk actions that fit their roles", async () => {
  await open();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Maya Okafor" }));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check in 1 competitor(s)" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /judge\(s\)/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("checkbox", { name: "Select Priya Raman" }));
  fireEvent.click(screen.getByRole("button", { name: "Check in 1 judge(s)" }));
  await waitFor(() =>
    expect(mockService.bulkSet).toHaveBeenCalledWith({ uids: ["j-1"], role: "judge", field: "checkedIn", value: true })
  );
});

test("a list that fails to load shows nobody rather than crashing", async () => {
  mockService.listPeople.mockRejectedValue(new Error("offline"));
  renderPage(<PeopleSection onResult={onResult} />);
  expect(await screen.findByText("Nobody matches that.")).toBeInTheDocument();
});

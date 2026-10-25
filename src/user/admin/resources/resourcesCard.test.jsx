/**
 * The organizer's Resources card: what it lists, and what it hands the service
 * when an organizer adds, edits, deletes, reorders or switches them on early.
 * The service has its own tests; here it is replaced so each click can be
 * checked for exactly what it asks for.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderPage } from "../../../testing/renderPage";
import ResourcesCard from "./ResourcesCard";
import { addResource, deleteResource, moveResource, setResourcesShowNow, updateResource } from "./resourcesService";

vi.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
vi.mock("firebase/database", async () => (await import("../../../testing/fakeDatabase")).module);
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
vi.mock("./resourcesService", () => ({
  addResource: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: vi.fn(),
  moveResource: vi.fn(),
  setResourcesShowNow: vi.fn(),
}));
const db = await import("../../../testing/fakeDatabase");

const resources = {
  r2: { title: "Pitch video", url: "https://youtu.be/abc", description: "Seven minutes on pitching.", forJudges: false, order: 2, createdAt: 2 },
  r1: { title: "Judging rubric", url: "https://example.com/rubric.pdf", forJudges: true, order: 1, createdAt: 1 },
};

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [addResource, updateResource, deleteResource, moveResource, setResourcesShowNow]) {
    fn.mockResolvedValue({ ok: true });
  }
  db.reset({ admins: { "admin-1": true }, resources });
});

describe("the list", () => {
  test("shows each resource in the order organizers set, with who it is for", () => {
    renderPage(<ResourcesCard />);
    const titles = screen.getAllByText(/^(Judging rubric|Pitch video)$/).map((el) => el.textContent);
    expect(titles).toEqual(["Judging rubric", "Pitch video"]);
    expect(screen.getByText("https://example.com/rubric.pdf")).toBeInTheDocument();
    expect(screen.getByText("Seven minutes on pitching.")).toBeInTheDocument();
    expect(screen.getAllByText("Judges too")).toHaveLength(1);
  });

  test("says so when there are none", () => {
    db.reset({ admins: { "admin-1": true } });
    renderPage(<ResourcesCard />);
    expect(screen.getByText(/No resources yet/)).toBeInTheDocument();
  });
});

describe("when they are visible", () => {
  test("outside event hours it says when they start", () => {
    db.setData("config/eventStart", "2099-10-25T10:00:00-04:00");
    renderPage(<ResourcesCard />);
    expect(screen.getByText(/Shown to competitors from .* until the end of the day/)).toBeInTheDocument();
  });

  test("switching them on early says visible now", () => {
    db.setData("config/eventStart", "2099-10-25T10:00:00-04:00");
    db.setData("config/resourcesShowNow", true);
    renderPage(<ResourcesCard />);
    expect(screen.getByText("Visible now")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show now" })).toBeChecked();
  });

  test("the switch asks the service to turn them on", async () => {
    renderPage(<ResourcesCard />);
    fireEvent.click(screen.getByRole("switch", { name: "Show now" }));
    await waitFor(() => expect(setResourcesShowNow).toHaveBeenCalledWith(null, true));
  });
});

describe("adding", () => {
  test("sends trimmed fields, including who it is for, and clears the form", async () => {
    renderPage(<ResourcesCard />);
    fill("Title", "  Mentor map  ");
    fill("Link", "  https://example.com/map  ");
    fill("Description (optional)", "  Where to find a mentor.  ");
    fireEvent.click(screen.getByRole("switch", { name: "Also show to judges" }));
    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));

    await waitFor(() => expect(addResource).toHaveBeenCalledTimes(1));
    expect(addResource).toHaveBeenCalledWith(
      { title: "Mentor map", url: "https://example.com/map", description: "Where to find a mentor.", forJudges: true },
      [expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "r2" })]
    );
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue(""));
    expect(screen.getByLabelText("Link")).toHaveValue("");
  });

  test("a competitors-only resource is sent with forJudges false", async () => {
    renderPage(<ResourcesCard />);
    fill("Title", "Wi-Fi");
    fill("Link", "https://example.com/wifi");
    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));
    await waitFor(() => expect(addResource).toHaveBeenCalled());
    expect(addResource.mock.calls[0][0]).toMatchObject({ forJudges: false, description: "" });
  });

  test("a link that is not https cannot be added, and says why", () => {
    renderPage(<ResourcesCard />);
    const add = screen.getByRole("button", { name: "Add resource" });
    expect(add).toBeDisabled();
    fill("Title", "Notes");
    fill("Link", "http://example.com/notes");
    expect(add).toBeDisabled();
    expect(screen.getByText("Use a full link that starts with https://")).toBeInTheDocument();
    fill("Link", "https://example.com/notes");
    expect(add).toBeEnabled();
    expect(screen.queryByText("Use a full link that starts with https://")).not.toBeInTheDocument();
  });

  test("an overlong title or description cannot be added", () => {
    renderPage(<ResourcesCard />);
    fill("Link", "https://example.com/notes");
    fill("Title", "x".repeat(81));
    expect(screen.getByRole("button", { name: "Add resource" })).toBeDisabled();
    expect(screen.getByText("81 / 80")).toBeInTheDocument();
    fill("Title", "Notes");
    fill("Description (optional)", "y".repeat(141));
    expect(screen.getByRole("button", { name: "Add resource" })).toBeDisabled();
  });

  test("the service's refusal is shown and the form is kept", async () => {
    addResource.mockResolvedValue({ ok: false, error: "That link is already posted." });
    renderPage(<ResourcesCard />);
    fill("Title", "Notes");
    fill("Link", "https://example.com/notes");
    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));
    expect(await screen.findByText("That link is already posted.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Notes");
  });
});

describe("editing", () => {
  test("saves the changed fields against what was stored", async () => {
    renderPage(<ResourcesCard />);
    const row = screen.getByText("Pitch video").closest("div").parentElement.parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "  Pitch tips  " } });
    fireEvent.click(dialog.getByRole("switch", { name: "Also show to judges" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateResource).toHaveBeenCalledTimes(1));
    const [id, before, fields] = updateResource.mock.calls[0];
    expect(id).toBe("r2");
    expect(before).toMatchObject({ title: "Pitch video", url: "https://youtu.be/abc", order: 2 });
    expect(before).not.toHaveProperty("id");
    expect(fields).toEqual({
      title: "Pitch tips",
      url: "https://youtu.be/abc",
      description: "Seven minutes on pitching.",
      forJudges: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("a refusal stays in the dialog", async () => {
    updateResource.mockResolvedValue({ ok: false, error: "Could not save." });
    renderPage(<ResourcesCard />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("deleting", () => {
  test("asks first, then deletes with what was stored", async () => {
    renderPage(<ResourcesCard />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(deleteResource).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteResource).toHaveBeenCalledTimes(1));
    const [id, before] = deleteResource.mock.calls[0];
    expect(id).toBe("r1");
    expect(before).toMatchObject({ title: "Judging rubric", forJudges: true });
    expect(before).not.toHaveProperty("id");
  });

  test("cancelling deletes nothing", () => {
    renderPage(<ResourcesCard />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(deleteResource).not.toHaveBeenCalled();
  });
});

describe("reordering", () => {
  test("the top one cannot move up and the bottom one cannot move down", () => {
    renderPage(<ResourcesCard />);
    expect(screen.getByRole("button", { name: "Move Judging rubric up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Judging rubric down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Pitch video up" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Pitch video down" })).toBeDisabled();
  });

  test("moving hands the service the list, the place and the direction", async () => {
    renderPage(<ResourcesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Move Pitch video up" }));
    await waitFor(() => expect(moveResource).toHaveBeenCalledTimes(1));
    const [list, index, direction] = moveResource.mock.calls[0];
    expect(list.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect([index, direction]).toEqual([1, -1]);

    fireEvent.click(screen.getByRole("button", { name: "Move Judging rubric down" }));
    await waitFor(() => expect(moveResource).toHaveBeenCalledTimes(2));
    expect(moveResource.mock.calls[1].slice(1)).toEqual([0, 1]);
  });
});

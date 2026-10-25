import { act, screen } from "@testing-library/react";
import { renderPage } from "../testing/renderPage";

vi.mock("../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "c1" } } }));
vi.mock("firebase/database", async () => (await import("../testing/fakeDatabase")).module);
const db = await import("../testing/fakeDatabase");
const { default: ResourcesSection } = await import("./ResourcesSection");

const START = new Date("2026-10-25T10:00:00-04:00");

const resources = {
  rubric: { title: "Judging rubric", url: "https://example.com/rubric.pdf", description: "How you are scored", forJudges: true, order: 2, createdAt: 2 },
  pitching: { title: "How to pitch", url: "https://youtu.be/abc", forJudges: false, order: 1, createdAt: 1 },
};

function at(time) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
}

function show(userTypes = ["competitor"]) {
  return renderPage(<ResourcesSection userTypes={userTypes} eventStart={START} />);
}

describe("the resources section", () => {
  beforeEach(() => db.reset({ resources }));
  afterEach(() => vi.useRealTimers());

  test("is hidden before the event", () => {
    at("2026-10-25T09:00:00-04:00");
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  test("is shown during the event", async () => {
    at("2026-10-25T12:00:00-04:00");
    show();
    expect(await screen.findByRole("heading", { name: "Resources" })).toBeInTheDocument();
  });

  test("is still shown later the same day", async () => {
    at("2026-10-25T21:30:00-04:00");
    show();
    expect(await screen.findByRole("heading", { name: "Resources" })).toBeInTheDocument();
  });

  test("is hidden the next day", () => {
    at("2026-10-26T09:00:00-04:00");
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  test("is shown early when organizers switch it on, live", async () => {
    db.reset({ resources, config: { resourcesShowNow: true } });
    at("2026-10-20T09:00:00-04:00");
    show();
    expect(await screen.findByRole("heading", { name: "Resources" })).toBeInTheDocument();

    await act(async () => db.setData("config/resourcesShowNow", false));
    expect(screen.queryByRole("heading", { name: "Resources" })).not.toBeInTheDocument();
  });

  test("a competitor sees every resource, in order", async () => {
    at("2026-10-25T12:00:00-04:00");
    show(["competitor"]);
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://youtu.be/abc",
      "https://example.com/rubric.pdf",
    ]);
    expect(screen.getByText("How you are scored")).toBeInTheDocument();
  });

  test("a judge sees only the ones marked for judges", async () => {
    at("2026-10-25T12:00:00-04:00");
    show(["judge"]);
    expect(await screen.findByText(/Judging rubric/)).toBeInTheDocument();
    expect(screen.queryByText(/How to pitch/)).not.toBeInTheDocument();
  });

  test("no resources is nothing on screen", () => {
    db.reset({});
    at("2026-10-25T12:00:00-04:00");
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  test("each card opens in a new tab without handing over the opener", async () => {
    at("2026-10-25T12:00:00-04:00");
    show();
    const link = await screen.findByRole("link", { name: /Judging rubric/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/opens in a new tab/);
  });
});

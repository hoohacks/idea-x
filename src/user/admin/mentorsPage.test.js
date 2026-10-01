/**
 * The Mentors page against a populated database.
 *
 * The sign-up form's answers went into /judges and stopped there: an organizer
 * could see that somebody was a mentor, and nothing about which hour had cover.
 * These check the page says who is on each shift, and shows the rest of what
 * each person answered, without writing anything back.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import Mentors from "./Mentors";
import { renderPage } from "../../testing/renderPage";

jest.mock("../../firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "admin-1", email: "admin@example.com" } },
}));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const db = require("../../testing/fakeDatabase");

const judges = {
  j1: {
    firstName: "Priya", lastName: "Raman", email: "priya@capone.com", company: "Capital One", withCompany: true,
    wantsToMentor: true, wantsToJudge: true,
    timeslots: ["11:00 AM", "1:00 PM"], skills: ["Pitching", "React"],
    questionsAndConcerns: "Is parking validated?",
    // midday UTC, so it is the 12th in whichever timezone runs this
    registeredAt: Date.UTC(2026, 8, 12, 16, 0),
  },
  j2: {
    firstName: "Sam", lastName: "Whitaker", email: "sam@deloitte.com",
    wantsToMentor: true, wantsToJudge: false, timeslots: ["1:00 PM", "2:00 PM"],
  },
  j3: { firstName: "Noor", lastName: "Haddad", email: "noor@example.com", wantsToMentor: false, wantsToJudge: true },
  // said yes to mentoring from the edit drawer, which has no shifts to pick
  j4: { firstName: "Tess", lastName: "Okafor", email: "tess@example.com", wantsToMentor: true, wantsToJudge: false },
};

beforeEach(() => db.reset({ judges }));

const shift = (time) => within(screen.getByRole("group", { name: `${time} shift` }));
const responses = () => within(screen.getByRole("region", { name: "Responses" }));
const filter = (option) =>
  within(screen.getByRole("group", { name: "Signed up to" })).getByRole("button", { name: option });

test("the header counts the responses, both answers and the shifts with cover", () => {
  renderPage(<Mentors />);
  const count = (label) => screen.getByText(label).previousSibling.textContent;
  expect(count("responses")).toBe("4");
  expect(count("want to mentor")).toBe("3");
  expect(count("want to judge")).toBe("2");
  expect(count("shifts covered")).toBe("3/6");
});

test("each shift names the mentors who picked it, and how many", () => {
  renderPage(<Mentors />);

  expect(shift("11:00 AM").getByText("Priya Raman")).toBeInTheDocument();
  expect(shift("11:00 AM").queryByText("Sam Whitaker")).not.toBeInTheDocument();
  expect(shift("11:00 AM").getByText("1 mentor")).toBeInTheDocument();

  expect(shift("1:00 PM").getByText("Priya Raman")).toBeInTheDocument();
  expect(shift("1:00 PM").getByText("Sam Whitaker")).toBeInTheDocument();
  expect(shift("1:00 PM").getByText("2 mentors")).toBeInTheDocument();
});

test("a mentor on a shift is shown with their company and what they can help with", () => {
  renderPage(<Mentors />);
  expect(shift("11:00 AM").getByText("Capital One · Pitching, React")).toBeInTheDocument();
});

test("a shift nobody picked says so", () => {
  renderPage(<Mentors />);
  expect(shift("12:00 PM").getByText("Nobody yet")).toBeInTheDocument();
});

test("a mentor who picked no shifts is listed apart, not left out", () => {
  renderPage(<Mentors />);
  expect(within(screen.getByRole("group", { name: "No shifts picked" })).getByText("Tess Okafor")).toBeInTheDocument();
});

test("everyone who answered is listed by name", () => {
  renderPage(<Mentors />);
  const names = responses()
    .getAllByText(/^(Noor Haddad|Priya Raman|Sam Whitaker|Tess Okafor)$/)
    .map((el) => el.textContent);
  expect(names).toEqual(["Noor Haddad", "Priya Raman", "Sam Whitaker", "Tess Okafor"]);
});

test("opening a response shows everything that person answered", () => {
  renderPage(<Mentors />);

  expect(screen.queryByText("Is parking validated?")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Answers from Priya Raman" }));

  const answer = (question) => responses().getByText(question).nextSibling.textContent;
  expect(answer("Mentoring")).toBe("Yes");
  expect(answer("Shifts")).toBe("11:00 AM, 1:00 PM");
  expect(answer("Skills")).toBe("Pitching, React");
  expect(answer("Judging")).toBe("Yes");
  expect(answer("Question for organizers")).toBe("Is parking validated?");
  expect(answer("Signed up")).toMatch(/Sep 12/);
});

test("an answer that was never given reads as missing, not as a no", () => {
  db.reset({ judges: { j5: { firstName: "Old", lastName: "Record", email: "old@example.com" } } });
  renderPage(<Mentors />);

  fireEvent.click(screen.getByRole("button", { name: "Answers from Old Record" }));

  const answer = (question) => responses().getByText(question).nextSibling.textContent;
  expect(answer("Mentoring")).toBe("Not answered");
  expect(answer("Judging")).toBe("Not answered");
  expect(answer("Signed up")).toBe("Not recorded");
});

test("the filter separates mentors, judges and the people doing both", () => {
  renderPage(<Mentors />);

  fireEvent.click(filter("Judge"));
  expect(responses().getByText("Noor Haddad")).toBeInTheDocument();
  expect(responses().getByText("Priya Raman")).toBeInTheDocument();
  expect(responses().queryByText("Sam Whitaker")).not.toBeInTheDocument();

  fireEvent.click(filter("Both"));
  expect(responses().getByText("Priya Raman")).toBeInTheDocument();
  expect(responses().queryByText("Noor Haddad")).not.toBeInTheDocument();

  fireEvent.click(filter("Mentor"));
  expect(responses().getByText("Tess Okafor")).toBeInTheDocument();
  expect(responses().queryByText("Noor Haddad")).not.toBeInTheDocument();
});

test("search narrows the responses and leaves the shifts alone", () => {
  renderPage(<Mentors />);

  fireEvent.change(screen.getByPlaceholderText("Search name, email or skill"), { target: { value: "react" } });

  expect(responses().getByText("Priya Raman")).toBeInTheDocument();
  expect(responses().queryByText("Sam Whitaker")).not.toBeInTheDocument();
  expect(shift("1:00 PM").getByText("Sam Whitaker")).toBeInTheDocument();
});

test("the page only reads", () => {
  renderPage(<Mentors />);
  fireEvent.click(screen.getByRole("button", { name: "Answers from Priya Raman" }));
  fireEvent.click(filter("Both"));
  expect(db.writes).toHaveLength(0);
});

test("the page has its own place in the organizer's nav", () => {
  renderPage(<Mentors />, { route: "/user/admin/mentors" });

  const link = screen.getByRole("link", { name: "Mentors" });
  expect(link).toHaveAttribute("href", "/user/admin/mentors");
  expect(link).toHaveAttribute("aria-current", "page");
});

describe("the heat strip down the outside of the shifts", () => {
  const GREEN = /rgba\(16, 60, 37, ([\d.]+)\)/;
  const row = (time) => screen.getByRole("group", { name: `${time} shift` }).parentElement;
  // decoration, so it is hidden from a screen reader: the count beside it is the fact
  const segment = (time) => getComputedStyle(row(time).querySelector(":scope > [aria-hidden='true']"));
  const strength = (time) => Number(segment(time).backgroundColor.match(GREEN)?.[1] ?? 0);

  test("the busier a shift, the stronger its segment", () => {
    renderPage(<Mentors />);

    expect(strength("1:00 PM")).toBeGreaterThan(strength("11:00 AM"));
    expect(strength("11:00 AM")).toBeGreaterThan(0);
  });

  test("an empty shift keeps its place in the strip, with no green in it", () => {
    renderPage(<Mentors />);

    expect(segment("12:00 PM").backgroundColor).not.toBe("");
    expect(strength("12:00 PM")).toBe(0);
  });

  test("each segment hangs outside the card and runs the full height of its row", () => {
    renderPage(<Mentors />);

    expect(parseFloat(segment("1:00 PM").left)).toBeLessThan(0);
    expect(segment("1:00 PM").top).toBe("0px");
    // down over the hairline under the row, so the segments meet
    expect(parseFloat(segment("1:00 PM").bottom)).toBeLessThanOrEqual(0);
    expect(parseFloat(segment("1:00 PM").width)).toBeGreaterThan(3);
  });

  test("the rows themselves stay plain", () => {
    renderPage(<Mentors />);
    expect(getComputedStyle(row("1:00 PM")).backgroundColor).not.toMatch(/rgb/);
  });
});

/**
 * The Competitors page against a populated database.
 *
 * The smoke test renders it empty, which proves it does not crash and nothing
 * else. These give it people, teams and a mix of states, and check what an
 * organizer at the check-in desk relies on: that a card says who someone is and
 * which team they are on, that the filters narrow the list, and that the
 * check-in button writes the flag and nothing else.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import Search from "./Search";
import { renderPage } from "../../testing/renderPage";

jest.mock("../../firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: { uid: "admin-1", email: "admin@example.com" } },
}));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
const db = require("../../testing/fakeDatabase");

const people = {
  c1: {
    firstName: "Maya", lastName: "Okafor", email: "maya@virginia.edu",
    teamId: "t1", major: "Economics", schoolYear: 2027, uvaSchool: "commerce",
    dietaryRestriction: "vegetarian", checkedIn: true, foodCheckIn: true,
    resume: "https://example.com/maya.pdf",
  },
  c2: {
    firstName: "Theo", lastName: "Brandt", email: "theo@virginia.edu",
    major: "Computer Science", schoolYear: "Third Year", uvaSchool: "engineering",
    dietaryRestriction: "None", checkedIn: false,
  },
};

beforeEach(() => db.reset({ competitors: people, teams: { t1: { name: "Lantern" } } }));

const card = (name) => screen.getByText(name).closest(".MuiCard-root");

test("a card says who someone is, their team, and what they study", () => {
  renderPage(<Search />);

  const maya = within(card("Maya Okafor"));
  expect(maya.getByText("maya@virginia.edu")).toBeInTheDocument();
  expect(maya.getByText("Lantern")).toBeInTheDocument();
  expect(maya.getByText(/Economics, Class of 2027/)).toBeInTheDocument();
  expect(maya.getByText(/McIntire School of Commerce/)).toBeInTheDocument();
  expect(maya.getByText("vegetarian")).toBeInTheDocument();
  expect(maya.getByText("Got food")).toBeInTheDocument();
  expect(maya.getByRole("link", { name: /Resume/ })).toHaveAttribute("href", "https://example.com/maya.pdf");
});

test("someone without a team says so, and an old year label is not called a class", () => {
  renderPage(<Search />);

  const theo = within(card("Theo Brandt"));
  expect(theo.getByText("No team yet")).toBeInTheDocument();
  expect(theo.getByText(/Computer Science, Third Year/)).toBeInTheDocument();
  expect(theo.queryByText(/Class of Third Year/)).not.toBeInTheDocument();
  // "None" in any case is no restriction, not a dietary flag for catering
  expect(theo.queryByText(/^none$/i)).not.toBeInTheDocument();
  expect(theo.queryByRole("link", { name: /Resume/ })).not.toBeInTheDocument();
});

test("the header counts who has arrived", () => {
  renderPage(<Search />);
  expect(screen.getByText("registered").previousSibling).toHaveTextContent("2");
  expect(screen.getByText("checked in").previousSibling).toHaveTextContent("1");
  expect(screen.getByText("50%")).toBeInTheDocument();
});

test("checking someone in writes the flag, and only the flag", async () => {
  renderPage(<Search />);

  fireEvent.click(within(card("Theo Brandt")).getByRole("button", { name: "Check in" }));

  await waitFor(() =>
    expect(db.writes).toContainEqual({ op: "update", path: "competitors/c2", value: { checkedIn: true } })
  );
  // the page follows the database rather than its own guess
  expect(await within(card("Theo Brandt")).findByRole("button", { name: "Checked in" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("the check-in filter narrows the cards", () => {
  renderPage(<Search />);

  fireEvent.click(screen.getByRole("button", { name: "Not checked in" }));
  expect(screen.getByText("Theo Brandt")).toBeInTheDocument();
  expect(screen.queryByText("Maya Okafor")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
  expect(screen.getByText("Maya Okafor")).toBeInTheDocument();
});

test("the dietary filter offers what people actually asked for", () => {
  renderPage(<Search />);

  fireEvent.click(screen.getByRole("button", { name: "Vegetarian" }));
  expect(screen.getByText("Maya Okafor")).toBeInTheDocument();
  expect(screen.queryByText("Theo Brandt")).not.toBeInTheDocument();
});

test("search matches on email as well as name", () => {
  renderPage(<Search />);

  fireEvent.change(screen.getByPlaceholderText("Search name or email"), { target: { value: "theo@" } });
  expect(screen.getByText("Theo Brandt")).toBeInTheDocument();
  expect(screen.queryByText("Maya Okafor")).not.toBeInTheDocument();
});

test("a search that matches nobody says so", () => {
  renderPage(<Search />);

  fireEvent.change(screen.getByPlaceholderText("Search name or email"), { target: { value: "zzz" } });
  expect(screen.getByText("No competitors match those filters.")).toBeInTheDocument();
});

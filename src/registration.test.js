/**
 * The two public forms, exercised the way people actually fill them in.
 *
 * The case that matters most here is the one no click can reproduce: Chrome
 * putting a saved profile straight into the DOM without dispatching anything.
 * `autofill` below does exactly that -- assigns to input.value and stays
 * silent -- which is what left the old form refusing to submit while every
 * field on screen was visibly full.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";

jest.mock("./firebase", () => ({ database: {}, storage: {}, auth: {} }));

const mockCreateUser = jest.fn(async () => ({ user: { uid: "new-uid" } }));
const mockDbUpdate = jest.fn(async () => {});

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args) => mockCreateUser(...args),
}));

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  update: (...args) => mockDbUpdate(...args),
  serverTimestamp: () => 1234,
}));

jest.mock("firebase/storage", () => ({
  ref: jest.fn(),
  uploadBytesResumable: jest.fn(),
  getDownloadURL: jest.fn(async () => "https://example.com/cv.pdf"),
}));

const Registration = require("./Registration").default;
const JudgeRegistration = require("./JudgeRegistration").default;

function renderPage(Component) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </ThemeProvider>
  );
}

// The rail and the bar that replaces it below md are both in the DOM; only CSS
// decides which one shows, and jsdom has no media queries. Either will do.
const submit = (name) => screen.getAllByRole("button", { name })[0];
const shows = (text) => screen.getAllByText(text)[0];

/** What a browser does: put the value in the field and tell nobody. */
function autofill(fields) {
  for (const [name, value] of Object.entries(fields)) {
    document.querySelector(`[name="${name}"]`).value = value;
  }
}

/** The animationstart from index.css, the only signal that a fill happened. */
function announceAutofill(name) {
  const event = new Event("animationstart", { bubbles: true });
  event.animationName = "onAutofill";
  document.querySelector(`[name="${name}"]`).dispatchEvent(event);
}

// MUI 5.10 gives a Select role="button", and names it from its label plus
// whatever it is currently showing -- hence the loose match.
async function pickOption(selectName, optionName) {
  userEvent.click(screen.getByRole("button", { name: new RegExp(selectName) }));
  const listbox = await screen.findByRole("listbox");
  userEvent.click(within(listbox).getByRole("option", { name: optionName }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

/**
 * The one answer nothing fills for you: no browser autofills a checkbox and no
 * select offers it, so every successful submission has to tick it by hand.
 */
function confirmEligibility() {
  userEvent.click(screen.getByRole("checkbox", { name: /18 years or older/ }));
}

function answer(legend, choice) {
  const group = screen.getByRole("radiogroup", { name: legend });
  userEvent.click(within(group).getByRole("radio", { name: choice }));
}

const COMPETITOR = {
  firstName: "Mary-Jane",
  lastName: "O'Brien",
  email: "mj@virginia.edu",
  password: "hunter2!",
  major: "Systems Engineering",
};

const JUDGE = {
  firstName: "Dana",
  lastName: "Reyes",
  email: "dana@acme.com",
  password: "correcthorse",
};

// create-react-app turns on jest's `resetMocks`, which strips the
// implementation off every mock between tests -- not just the call log. The
// implementations have to be put back each time or the second test onwards
// gets `undefined` back from firebase.
beforeEach(() => {
  mockCreateUser.mockReset().mockImplementation(async () => ({ user: { uid: "new-uid" } }));
  mockDbUpdate.mockReset().mockImplementation(async () => {});
});

describe("competitor registration", () => {
  test("renders the form and its progress rail", async () => {
    renderPage(Registration);
    expect(
      await screen.findByRole("heading", { name: /Ideathon/ })
    ).toBeInTheDocument();
    expect(shows("7 answers left")).toBeInTheDocument();
    expect(submit("Register")).toBeInTheDocument();
  });

  test("an empty form counts what is outstanding instead of failing silently", async () => {
    renderPage(Registration);

    userEvent.click(submit("Register"));

    expect(mockCreateUser).not.toHaveBeenCalled();
    // seven nouns would be a paragraph, so past three it reports the count
    expect(
      (await screen.findAllByText(/7 answers still needed, starting with your first name/))[0]
    ).toBeInTheDocument();
    expect(screen.getByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Choose a password")).toBeInTheDocument();
  });

  test("a nearly finished form names the last few by hand", async () => {
    renderPage(Registration);

    // everything but the major and the gender select
    autofill({ ...COMPETITOR, major: "" });
    announceAutofill("firstName");
    confirmEligibility();
    userEvent.click(submit("Register"));

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(
      (await screen.findAllByText("Still needed: your major and your gender."))[0]
    ).toBeInTheDocument();
  });

  // the regression this whole change exists for
  test("submits when the browser filled the fields and React never saw it", async () => {
    renderPage(Registration);

    autofill(COMPETITOR);
    // gender is a select, which no browser autofills, so it is answered by hand
    await pickOption("Gender", "Prefer not to say");
    confirmEligibility();

    userEvent.click(submit("Register"));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled());
    expect(mockCreateUser).toHaveBeenCalledWith({}, "mj@virginia.edu", "hunter2!");
    expect(screen.queryAllByText(/still needed/i)).toHaveLength(0);
  });

  test("the rail counts autofilled answers as soon as the browser announces them", async () => {
    renderPage(Registration);
    expect(shows("7 answers left")).toBeInTheDocument();

    autofill(COMPETITOR);
    announceAutofill("firstName");

    // five of the seven: no browser fills a select or ticks a checkbox, so the
    // gender and the eligibility confirmation are still outstanding
    expect((await screen.findAllByText("2 answers left"))[0]).toBeInTheDocument();
  });

  test("keeps hyphens, apostrophes and spaces in a name", async () => {
    renderPage(Registration);

    autofill(COMPETITOR);
    await pickOption("Gender", "Female");
    confirmEligibility();
    userEvent.click(submit("Register"));

    await waitFor(() => expect(mockDbUpdate).toHaveBeenCalled());
    const record = mockDbUpdate.mock.calls[0][1]["/competitors/new-uid"];
    expect(record.firstName).toBe("Mary-Jane");
    expect(record.lastName).toBe("O'Brien");
    expect(record.major).toBe("Systems Engineering");
    expect(record.schoolYear).toBe(2026);
    expect(record.dietaryRestriction).toBe("none");
    expect(record.checkedIn).toBe(false);
    expect(record.foodCheckIn).toBe(false);
  });

  test("rejects an address the old pattern would have taken", async () => {
    renderPage(Registration);

    autofill({ ...COMPETITOR, email: "mj@virginia" });
    await pickOption("Gender", "Male");
    confirmEligibility();
    userEvent.click(submit("Register"));

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(await screen.findByText(/Enter a complete address/)).toBeInTheDocument();
  });

  test("accepts a TLD longer than three letters", async () => {
    renderPage(Registration);

    autofill({ ...COMPETITOR, email: "mj@startup.technology" });
    await pickOption("Gender", "Other");
    confirmEligibility();
    userEvent.click(submit("Register"));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled());
  });

  test("refuses a form that is complete apart from the eligibility box", async () => {
    renderPage(Registration);

    autofill(COMPETITOR);
    await pickOption("Gender", "Female");
    userEvent.click(submit("Register"));

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(
      (await screen.findAllByText("Still needed: confirmation that you are eligible."))[0]
    ).toBeInTheDocument();
    expect(
      screen.getByText("Confirm that you are 18 or over and study at UVA")
    ).toBeInTheDocument();
  });

  test("stores the confirmation, so there is a record of what was attested to", async () => {
    renderPage(Registration);

    autofill(COMPETITOR);
    await pickOption("Gender", "Female");
    confirmEligibility();
    userEvent.click(submit("Register"));

    await waitFor(() => expect(mockDbUpdate).toHaveBeenCalled());
    const record = mockDbUpdate.mock.calls[0][1]["/competitors/new-uid"];
    expect(record.eligibilityConfirmed).toBe(true);
  });

  test("the school list no longer offers a way to say you do not go to UVA", async () => {
    renderPage(Registration);

    userEvent.click(screen.getByRole("button", { name: /School/ }));
    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).queryByRole("option", { name: /don.t go to UVA/i })).toBeNull();
    expect(
      within(listbox).getByRole("option", { name: "McIntire School of Commerce" })
    ).toBeInTheDocument();
  });
});

describe("judge and mentor registration", () => {
  test("renders", async () => {
    renderPage(JudgeRegistration);
    expect(await screen.findByText("Judge and mentor sign-up")).toBeInTheDocument();
  });

  test("asks for a company only when there is one", async () => {
    renderPage(JudgeRegistration);

    answer(/on behalf of a company/, "Yes");
    expect(await screen.findByRole("textbox", { name: /Company/ })).toBeInTheDocument();

    answer(/on behalf of a company/, "No");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Company/ })).not.toBeInTheDocument()
    );
  });

  test("a mentor must pick two shifts before it will submit", async () => {
    renderPage(JudgeRegistration);

    autofill(JUDGE);
    answer(/on behalf of a company/, "No");
    answer(/Would you like to mentor/, "Yes");
    answer(/Would you like to judge/, "Yes");

    userEvent.click(submit("Create account"));
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(await screen.findByText(/Pick at least 2 shifts/)).toBeInTheDocument();

    userEvent.click(screen.getByRole("checkbox", { name: "11:00 AM" }));
    userEvent.click(screen.getByRole("checkbox", { name: "1:00 PM" }));
    userEvent.click(submit("Create account"));

    await waitFor(() => expect(mockDbUpdate).toHaveBeenCalled());
    const record = mockDbUpdate.mock.calls[0][1]["/judges/new-uid"];
    expect(record.timeslots).toEqual(["11:00 AM", "1:00 PM"]);
    expect(record.wantsToJudge).toBe(true);
    expect(record.withCompany).toBe(false);
    expect(record.checkedIn).toBe(false);
    expect(record.foodCheckIn).toBe(false);
  });

  test("someone who only judges is never asked for shifts", async () => {
    renderPage(JudgeRegistration);

    autofill({ ...JUDGE, email: "sam@acme.com" });
    answer(/on behalf of a company/, "No");
    answer(/Would you like to mentor/, "No");
    answer(/Would you like to judge/, "Yes");

    expect(screen.queryByText(/Which shifts/)).not.toBeInTheDocument();

    userEvent.click(submit("Create account"));
    await waitFor(() => expect(mockDbUpdate).toHaveBeenCalled());
    expect(mockDbUpdate.mock.calls[0][1]["/judges/new-uid"].timeslots).toEqual([]);
  });
});

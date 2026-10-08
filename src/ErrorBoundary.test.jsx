/**
 * A thrown render used to be a white page.
 *
 * That matters more here than it looks: a blank page is also what a wrong URL
 * looks like, and what a page pushed below the fold looks like. Three problems,
 * one symptom, no way to tell them apart without opening the console.
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";
import ErrorBoundary from "./ErrorBoundary";

function Boom() {
  throw new Error("room 011 is on fire");
}

describe("when a page throws", () => {
  let consoleError;
  beforeEach(() => {
    // React logs the caught error itself; the test asserts behaviour, not noise
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  test("it says so instead of rendering nothing", () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </ThemeProvider>
    );
    expect(screen.getByRole("heading", { name: /Something went wrong/ })).toBeInTheDocument();
  });

  test("it shows the message, so it can be reported without a console", () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </ThemeProvider>
    );
    expect(screen.getByText("room 011 is on fire")).toBeInTheDocument();
  });

  test("it offers the two things that actually help", () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </ThemeProvider>
    );
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to the dashboard" })).toBeInTheDocument();
  });

  test("it says nothing was lost, because a person cannot tell", () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary><Boom /></ErrorBoundary>
      </ThemeProvider>
    );
    expect(screen.getByText(/was saved or lost/)).toBeInTheDocument();
  });
});

test("a page that does not throw is passed straight through", () => {
  render(
    <ThemeProvider theme={theme}>
      <ErrorBoundary><p>the schedule</p></ErrorBoundary>
    </ThemeProvider>
  );
  expect(screen.getByText("the schedule")).toBeInTheDocument();
});

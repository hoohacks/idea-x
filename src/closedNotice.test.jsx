/**
 * What the public pages do when the doors are shut.
 *
 * The e2e suite runs against a build with the flag on, because that is what a
 * judge and a competitor are doing in every one of those journeys. That leaves
 * the closed state untested by the layer that drives the real app, so it is
 * tested here: the flag off must mean the form is *not rendered*, not merely
 * hidden behind something.
 *
 * The flag is mocked as a getter rather than re-imported per test.
 * `vi.resetModules()` would give each page its own copy of React while this
 * file keeps the original, and two Reacts means every hook throws.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";

let mockOpen = false;
vi.mock("./registrationWindow", async () => {
  const actual = await vi.importActual("./registrationWindow");
  return {
    ...actual,
    // read at render time, so a test can move it between renders
    get REGISTRATION_OPEN() {
      return mockOpen;
    },
  };
});

vi.mock("./firebase", () => ({
  database: {},
  storage: {},
  auth: { currentUser: null },
  USING_EMULATOR: false,
}));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  get: vi.fn(async () => ({ exists: () => false, val: () => null })),
  set: vi.fn(),
  update: vi.fn(),
  push: vi.fn(() => ({ key: "x" })),
  onValue: (_r, cb) => {
    cb({ exists: () => false, val: () => null });
    return () => {};
  },
  serverTimestamp: () => 0,
}));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: null }),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  onAuthStateChanged: () => () => {},
  browserLocalPersistence: {},
}));
vi.mock("firebase/storage", () => ({
  getStorage: () => ({}),
  ref: vi.fn(),
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn(),
}));

const { AuthContext } = await import("./App");
const Registration = (await import("./Registration")).default;
const JudgeRegistration = (await import("./JudgeRegistration")).default;
const Login = (await import("./Login")).default;

const auth = {
  userCredential: null,
  userData: null,
  userTypes: [],
  loadingAuth: false,
  loadingUserData: false,
  handleLogin: vi.fn(),
  refreshUserData: vi.fn(),
  token: null,
};

function show(Page, route = "/") {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>
          <Page />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  mockOpen = false;
});
afterEach(cleanup);

describe("competitor registration", () => {
  test("closed shows the notice instead of the form", () => {
    show(Registration);

    expect(screen.getByText(/Registration is not open yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument();
  });

  test("open shows the form", () => {
    mockOpen = true;
    show(Registration);

    expect(screen.queryByText(/is not open yet/)).not.toBeInTheDocument();
    expect(screen.getByText("Student registration")).toBeInTheDocument();
  });

  /**
   * The staff entrance is deliberately not wired to this form. An organizer
   * needs a judge record, not a competitor one, and every door left open while
   * the doors are shut is another record a guessed URL can create.
   */
  test("the staff entrance does not open this one", () => {
    show(Registration, "/?staff");

    expect(screen.getByText(/Registration is not open yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument();
  });
});

describe("judge and mentor sign-up", () => {
  test("closed names itself, so the page is not mistaken for the other form", () => {
    show(JudgeRegistration);

    expect(screen.getByText(/Judge and mentor sign-up is not open yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument();
  });

  /**
   * Organizers need accounts of their own before the doors open, and nobody
   * can make one for them: creating a person from the control panel needs an
   * organizer already signed in, which is the thing being bootstrapped. The
   * staff entrance is the same one the sign-in page uses, for the same reason.
   */
  test("closed, the staff entrance still reaches the form", () => {
    show(JudgeRegistration, "/judge-registration?staff");

    expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
    expect(screen.queryByText(/is not open yet/)).not.toBeInTheDocument();
  });

  test("a near miss on the parameter does not open it", () => {
    show(JudgeRegistration, "/judge-registration?staffing=1");
    expect(screen.getByText(/Judge and mentor sign-up is not open yet/)).toBeInTheDocument();
  });
});

describe("signing in", () => {
  test("closed, an ordinary visitor gets the notice", () => {
    show(Login);

    expect(screen.getByText(/Sign-in is not open yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email address/)).not.toBeInTheDocument();
  });

  /**
   * Organizers have to reach the control panel to set the event up, and signing
   * in is the only way. Without this the gate locks out the people who would
   * lift it.
   */
  test("closed, the staff entrance still reaches the form", () => {
    show(Login, "/login?staff");

    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument();
    expect(screen.queryByText(/is not open yet/)).not.toBeInTheDocument();
  });

  test("a near miss on the parameter does not open it", () => {
    show(Login, "/login?staffing=1");
    expect(screen.getByText(/Sign-in is not open yet/)).toBeInTheDocument();
  });

  test("open, everybody gets the form", () => {
    mockOpen = true;
    show(Login);
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument();
  });
});

test("the notice points somewhere useful rather than being a dead end", () => {
  const { container } = show(Registration);

  // the shell's own nav also has a "Sign in", so this is addressed by where it
  // goes rather than by what it says: the staff entrance, not the gated one
  expect(container.querySelector('a[href="#/login?staff"]')).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /About the event/ })).toBeInTheDocument();
});

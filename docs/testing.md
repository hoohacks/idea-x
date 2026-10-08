# Testing

## The layers

| Layer | Command | Runs | Blind to |
| --- | --- | --- | --- |
| Pure logic | `npm run test:ci` | the arithmetic: scheduling, ranking, time zones | the database and the screen |
| Service tests | `npm run test:ci` | the shape of each write, with the database mocked | **permission denials: every read succeeds** |
| Page tests | `npm run test:ci` | each admin page against an in-memory database (`src/testing/fakeDatabase.js`) | **layout: jsdom has no viewport** |
| Rules | `npm run test:rules` | the real rules engine, as different users | the app |
| Browser | `npm run test:e2e` | a real browser, real rules, real routing, desktop and phone | nothing above it, but slow |

The first three run on [Vitest](https://vitest.dev) in jsdom, configured in
`vite.config.mjs`; the rules suite has its own config, `vitest.rules.config.mjs`,
because it runs in Node against the emulator. `describe`, `test`, `expect` and
`vi` are globals, as they were under Jest.

CI runs all of them on every pull request, and the deploy runs the first four
again before building.

Three bugs shipped because of the two "blind to" rows: joining a team failed on a
read the rules always refuse; the planner stacked two full-height page frames so
its content sat below the fold; and the room sheets had no link to them.

## Page tests

Page tests render a real admin page with `renderPage` (`src/testing/renderPage.jsx`),
which supplies the theme, router and a signed-in account, over
`fakeDatabase`, which stands in for `firebase/database`:

```js
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
const db = await import("../../testing/fakeDatabase");
beforeEach(() => db.reset({ judges: { j1: { firstName: "Priya" } } }));
```

It answers live subscriptions, records every write, and can be told to refuse
writes, so a page's error path is testable.

`mockReset: true` wipes every mock's calls, and anything a test set on it, before
the next test. Set per-test implementations in `beforeEach`.

A few things that differ from Jest and catch people out:

- **Import the code under test with `await import()`, not `require()`.** `require`
  bypasses `vi.mock` and cannot load JSX, so it either fails or quietly hands you
  the real module.
- **A mock factory must return every export the code reads.** A missing one
  throws rather than reading as `undefined`. Spread the real module in when you
  only mean to replace part of it:
  `vi.mock("./x", async (importOriginal) => ({ ...(await importOriginal()), only: vi.fn() }))`.
- **Build-time variables are stubbed with `vi.stubEnv`**, for example
  `vi.stubEnv("VITE_REGISTRATION_OPEN", "true")`, then `vi.resetModules()` and a
  fresh `await import()` for a module that reads one at load.
- **Fake timers fake `setImmediate` too**, which jsdom's `FileReader` uses. Fake
  only what the test needs: `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`.

## The browser suite

It covers the whole of a student's path (registering through the real form,
creating and joining a team, submitting a pitch), accounts (wrong password,
password reset, profile), the scanner (with a fake camera), a judge scoring,
publishing a schedule, the final round end to end, restore points, the control
panel's controls, the submissions switch and deadline, and announcements reaching
the right people live across several signed-in browsers.

It runs as two projects: **desktop**, and **mobile** (Pixel 5), where a sweep of
every page for every role asserts nothing scrolls sideways.

Two more specs check what assertions cannot:

- **Accessibility** (`e2e/accessibility.spec.mjs`) runs axe against every page for
  every role, and the score dialog, for WCAG 2.1 A and AA.
- **Screenshots** (`e2e/visual.spec.mjs`) compare the registration, sign-in and
  home pages to baselines. Fonts render differently per platform, so baselines are
  per platform, and a platform with none skips with a note. Only Windows baselines
  are committed, so these skip on CI until someone records Linux ones.
  `npx playwright test e2e/visual.spec.mjs --update-snapshots` records them, and
  accepts an intended change.

### Habits it taught

Each was learned by getting it wrong:

- **Scope every locator to its section.** A page-wide "Admin" matched the nav.
- **Wait for the page to settle; do not probe it.** `isVisible()` on a control
  that has not rendered yet returns false, and the step is silently skipped.
- **An input's value is not text on the page.** Use `toHaveValue`, not `getByText`.
- **Give each scoring spec its own judge.** A card cannot be scored twice, and
  sharing one lets an assertion pass on another spec's work.
- **Put shared settings back.** A spec that closes submissions or posts an
  announcement restores the seed's state however it ends, because other specs
  and the screenshots depend on it.
- **A string sent as request `data` goes out raw.** Encode it with
  `JSON.stringify` when writing fixtures over REST.

### Safety

`test:e2e` runs the app on port **3010** and never reuses an existing server.
Playwright's default would adopt whatever dev server is running, and if that one
was not in emulator mode the specs would sign in against the **live project**.

The emulator namespace must be the project's *default instance*
(`demo-ideathon-default-rtdb`): `emulators:exec` applies the rules to that
namespace and no other, and any other is created wide open. This was wrong for a
long time, so local development enforced no authorization at all, which is how
the join bug survived. Fixtures written over REST therefore need
`Authorization: Bearer owner`.

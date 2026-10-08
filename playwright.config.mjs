import { defineConfig, devices } from "@playwright/test";

/**
 * The layer every other test in this repo cannot reach.
 *
 * The unit tests mock the database, so no test above this one can see a permission
 * denial. It renders into jsdom, which has no viewport, so no test above this
 * one can see a page pushed below the fold. And it imports components
 * directly, so no test above this one can see a route that nothing links to.
 * Every one of those shipped a real bug this project has since fixed.
 *
 * These specs drive a real browser against the real app talking to the Firebase
 * emulators, signed in as the seeded accounts. They are deliberately few and
 * deliberately shallow: five journeys, no page objects, no fixtures beyond the
 * seed. End-to-end tests earn their keep by catching what nothing else can, and
 * lose it by becoming a second codebase to maintain.
 *
 * Run them with `npm run test:e2e`, which starts the emulators, seeds an event,
 * and starts the app. Nothing here touches the live project: the emulator hosts
 * are pinned by the same `demo-ideathon` namespace the rules tests use.
 */
export default defineConfig({
  testDir: "./e2e",
  // the app is a HashRouter served from the Vite dev server
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // visual.spec.mjs. Animations are frozen and the caret hidden, so a
    // screenshot is of the page at rest; a sliver of tolerance absorbs
    // anti-aliasing without letting a moved element through.
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 },
  },


  // A judging schedule is one shared document. Two specs publishing at once
  // would fight over it, and the failure would look like a bug in the app.
  workers: 1,
  fullyParallel: false,

  // Locally a flake is a signal worth seeing; in CI it is usually the dev
  // server still waking up.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    // A dedicated port, never 3000. See the webServer note below. The trailing
    // slash matters: specs navigate relative to it, under the /idea-x/ base the
    // site is served from, so a path-shaped URL is exercised the way it is live.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010/idea-x/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      // the phone journey has its own assertions and its own viewport
      testIgnore: /mobile\.spec\.mjs/,
    },
    {
      /**
       * Judges score on their phones, standing in a room.
       *
       * Every layout bug this project has had was invisible to jsdom, which has
       * no viewport at all -- including a planner page whose content sat a full
       * screen below the fold and read as blank. A real device profile is the
       * only place that class of failure shows up.
       */
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.mjs/,
    },
  ],

  /**
   * Always our own server, on a port the ordinary dev server does not use.
   *
   * `reuseExistingServer` on port 3000 is a trap here, and it caught this suite
   * on its first run: a dev server left over from two days earlier was picked
   * up and driven instead. That server was not in emulator mode, so every spec
   * signed in against the **live project** and failed as "wrong password" --
   * a misleading error hiding a genuinely dangerous default, since a spec that
   * publishes a schedule would have published it for real.
   *
   * So: a dedicated port, no reuse, and the emulator flag set here rather than
   * inherited from whatever script happened to start something.
   */
  webServer: {
    // --strictPort fails rather than drifting to another port if 3010 is taken.
    command:
      "cross-env VITE_USE_EMULATOR=true VITE_REGISTRATION_OPEN=true " +
      "vite --port 3010 --strictPort",
    url: "http://localhost:3010/idea-x/",
    // the first request after a cold start waits on dependency pre-bundling
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});

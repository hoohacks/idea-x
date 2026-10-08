import { defineConfig } from "vitest/config";

/**
 * The rules suite, kept apart from the unit tests in vite.config.mjs.
 *
 * It needs a different world: a node environment rather than jsdom, because
 * under jsdom `firebase/database` resolves to the browser build while
 * @firebase/rules-unit-testing drives the emulator's admin endpoints from Node;
 * and the emulator has to wrap the test command, which rules out the default
 * interactive watch mode.
 *
 * The two configs never see each other's files: the unit tests only look under
 * src/, and this only looks under test/rules/.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/rules/**/*.test.mjs"],
    // every file talks to the same emulator namespace and calls clearDatabase
    // between tests, so they must not run concurrently
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

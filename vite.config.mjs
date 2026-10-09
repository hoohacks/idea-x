import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The site is served from https://hoohacks.github.io/idea-x/ (ADR 0009, 0011),
 * so every asset URL is prefixed with /idea-x/. The dev server uses the same
 * base, which keeps local URLs shaped like the live ones:
 * localhost:3000/idea-x/#/login.
 *
 * Only VITE_* variables reach the bundle, as import.meta.env.VITE_*. They are
 * read at build time, so changing one means rebuilding.
 */
export default defineConfig({
  base: "/idea-x/",
  plugins: [react()],
  server: {
    port: 3000,
    // a taken port is an error rather than a quiet move to 3001, which would
    // leave the documented URL pointing at nothing (or at a stale server)
    strictPort: true,
  },
  build: {
    // gh-pages and the deploy workflow both publish ./build
    outDir: "build",
  },
  // Unit and page tests. The rules suite has its own config
  // (vitest.rules.config.mjs) because it runs in node against the emulator.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
    setupFiles: ["src/setupTests.js"],
    // describe/test/expect/vi without importing them, as under Jest
    globals: true,
    // Carried over from Create React App's Jest config: before each test, every
    // mock's calls and anything a test set on it are wiped. Unlike Jest, a
    // vi.fn(impl) goes back to impl rather than to returning undefined.
    mockReset: true,
    // the longest page tests fill in a whole MUI form, and with every file
    // running in parallel they can pass 5s on a busy machine without being wrong
    testTimeout: 15_000,
  },
});

import fs from "node:fs";
import { test, expect, devices } from "@playwright/test";
import { goto, signIn } from "./helpers.mjs";

/**
 * Screenshot comparisons of the pages whose look is the product.
 *
 * Every layout bug fixed in the redesign -- an orphaned stat tile, a Save button
 * floating free of its field, a wordmark adrift a column's width from the
 * corner -- passed every assertion in this suite, because nothing asserted what
 * the page looked like. These do: a change that moves the public pages or the
 * judge's phone view fails here, and the diff is in the report.
 *
 * Only pages whose content the rest of the suite does not change are compared,
 * so a failure means the design moved, not that another spec published a
 * schedule. The countdown ticks, so it is masked.
 *
 * The baselines live next to this file, one set per platform, because fonts
 * rasterize differently on Windows and Linux. A platform with no baseline yet
 * skips these with a note rather than failing, so CI stays green until someone
 * records Linux's; `npx playwright test e2e/visual.spec.mjs --update-snapshots`
 * writes them, and the same command accepts an intended change.
 */

/** Compare against the baseline, or skip if this platform has none yet. */
async function matchesBaseline(page, name, options) {
  const info = test.info();
  const recording = ["all", "changed"].includes(info.config.updateSnapshots);
  if (!recording && !fs.existsSync(info.snapshotPath(name))) {
    test.skip(true, `No ${process.platform} baseline for ${name} yet. Record one with --update-snapshots.`);
  }
  await expect(page).toHaveScreenshot(name, options);
}

const countdown = (page) => page.getByText(/starts in/).locator("..");

// the device profile minus its browser type, which a describe block cannot
// switch -- every project here is Chromium already
const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 5"];

test.describe("desktop", () => {
  test.use({ viewport: { width: 1366, height: 860 } });

  test("registration", async ({ page }) => {
    await goto(page, "/");
    await expect(page.getByRole("img", { name: /Behind the Plate/ })).toBeVisible();
    await matchesBaseline(page, "registration-desktop.png");
  });

  test("sign in", async ({ page }) => {
    await goto(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await matchesBaseline(page, "sign-in-desktop.png");
  });

  test("a competitor's home", async ({ page }) => {
    await signIn(page, "competitor");
    await goto(page, "/user/home");
    await expect(page.getByText("What to do next")).toBeVisible();
    await matchesBaseline(page, "competitor-home-desktop.png", { mask: [countdown(page)] });
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("registration", async ({ page }) => {
    await goto(page, "/");
    await expect(page.getByRole("heading", { level: 1, name: "Ideathon 2026" })).toBeVisible();
    await matchesBaseline(page, "registration-phone.png");
  });

  test("sign in", async ({ page }) => {
    await goto(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await matchesBaseline(page, "sign-in-phone.png");
  });

  test("a judge's home", async ({ page }) => {
    await signIn(page, "judge");
    await goto(page, "/user/home");
    await expect(page.getByText("What to do next")).toBeVisible();
    await matchesBaseline(page, "judge-home-phone.png", { mask: [countdown(page)] });
  });
});

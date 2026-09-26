import { test, expect } from "@playwright/test";
import { goto, signIn, expectPagePainted } from "./helpers.mjs";

/**
 * The check-in scanner.
 *
 * What a scan decides -- who a code belongs to, whether they are already in,
 * a person on two records -- is tested without a camera in
 * src/user/admin/scanCheckIn.test.js. This is the page itself: that it opens
 * with a camera to point, that the event/food switch changes what is recorded,
 * and that it is reachable from where an organizer is standing.
 *
 * Chromium gets a fake camera, so the page runs as it would on a phone rather
 * than failing at the permission prompt.
 */
test.use({
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("the scanner opens on a camera, recording event check-in", async ({ page }) => {
  await signIn(page, "admin");
  await goto(page, "/user/admin/scan");
  await expectPagePainted(page);

  await expect(page.getByRole("heading", { level: 1, name: "Scan check-in" })).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByRole("button", { name: "Event" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Recording event check-in/)).toBeVisible();
});

test("switching to food changes what a scan records", async ({ page }) => {
  await signIn(page, "admin");
  await goto(page, "/user/admin/scan");

  await page.getByRole("button", { name: "Food" }).click();
  await expect(page.getByRole("button", { name: "Food" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Recording food/)).toBeVisible();

  // clicking the chosen mode again does not leave it with nothing chosen
  await page.getByRole("button", { name: "Food" }).click();
  await expect(page.getByRole("button", { name: "Food" })).toHaveAttribute("aria-pressed", "true");
});

test("the scanner is one tap from the rail", async ({ page }) => {
  await signIn(page, "admin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" }).click();
  await expect(page).toHaveURL(/#\/user\/admin\/scan/);
  await expect(page.getByRole("heading", { level: 1, name: "Scan check-in" })).toBeVisible();
});

test("a judge cannot open the scanner", async ({ page }) => {
  await signIn(page, "judge");
  await goto(page, "/user/admin/scan");
  await expect(page.getByRole("heading", { name: "Scan check-in" })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/user\/home/, { timeout: 20_000 });
});

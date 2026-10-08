import { test, expect } from "@playwright/test";
import { goto, expectPagePainted } from "./helpers.mjs";

/**
 * The two pages a person reaches before they have an account.
 *
 * Both bugs pinned here shipped, and neither was visible to any other layer:
 * the app is a HashRouter, so the tidy-looking URL somebody actually writes
 * down had an empty hash and matched `/` -- which is the *competitor* form. A
 * judge sent that link signed up as a competitor with nothing on screen to say
 * so. Only a real address bar can see that.
 */

test("the competitor form is the front door", async ({ page }) => {
  await page.goto("./");
  await expectPagePainted(page);
  await expect(page.getByText("Student registration")).toBeVisible();
});

test("the judge form is a different form, not the same one in other words", async ({ page }) => {
  await goto(page, "/judge-registration");
  await expectPagePainted(page);

  await expect(page.getByText("Judge and mentor sign-up")).toBeVisible();
  await expect(page.getByText("Mentoring")).toHaveCount(2); // rail and section
  await expect(page.getByText("Student registration")).toHaveCount(0);
});

test("the tidy URL without the hash still reaches the judge form", async ({ page }) => {
  // this is the link people paste into a message
  await page.goto("judge-registration");

  await expect(page).toHaveURL(/#\/judge-registration/);
  await expect(page.getByText("Judge and mentor sign-up")).toBeVisible();
});

test("a deep path without the hash is rewritten rather than dropped", async ({ page }) => {
  // signed out, so the route is then bounced to login by ProtectedRoute -- the
  // point is that the path survived the rewrite instead of matching "/" and
  // silently serving the registration form
  await page.goto("user/admin/schedule");
  await expect(page).toHaveURL(/#\/(user\/admin\/schedule|login)/);
  await expect(page.getByText("Student registration")).toHaveCount(0);
});

test("an address nobody has lands on the front door instead of nothing", async ({ page }) => {
  await goto(page, "/not-a-page");
  await expectPagePainted(page);
  await expect(page).toHaveURL(/#\/$|#\/?$/);
});

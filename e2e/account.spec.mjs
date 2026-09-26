import { test, expect } from "@playwright/test";
import { goto, signIn, expectPagePainted, ACCOUNTS } from "./helpers.mjs";

/**
 * Getting in, getting back in, and getting out.
 *
 * Every spec signs in, but only ever with the right password -- so the one
 * thing a real person does most often on the sign-in page, getting it wrong,
 * had never been exercised. Nor had the reset link, the profile, or signing out.
 */

test("a wrong password says what to do, and stays on the sign-in page", async ({ page }) => {
  await goto(page, "/login");
  await page.getByLabel("Email address").fill(ACCOUNTS.competitor.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/We could not sign you in/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/#\/login/);
});

test("the eye button shows the password that was typed, and hides it again", async ({ page }) => {
  await goto(page, "/login");
  const password = page.getByLabel("Password");
  await password.fill("abc123");
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show what you typed" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide what you typed" }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("forgot password sends a link and says where it went", async ({ page }) => {
  await goto(page, "/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/#\/forgot-password/);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

  await page.getByLabel("Email address").fill(ACCOUNTS.competitor.email);
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(ACCOUNTS.competitor.email)).toBeVisible();
});

test("a malformed address is refused before anything is sent", async ({ page }) => {
  await goto(page, "/forgot-password");
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  // the browser's own check or the app's message, but never the success screen
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
});

test("the profile shows who is signed in and their role", async ({ page }) => {
  await signIn(page, "competitor");
  await goto(page, "/user/profile");
  await expectPagePainted(page);

  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(page.getByText(ACCOUNTS.competitor.email)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/competitor/i).first()).toBeVisible();
});

test("logging out from the account menu returns to sign in, and stays out", async ({ page }) => {
  await signIn(page, "judge");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();

  await expect(page).toHaveURL(/#\/login/, { timeout: 20_000 });
  // a signed-in page now bounces back rather than showing anything
  await goto(page, "/user/judging");
  await expect(page).toHaveURL(/#\/login/, { timeout: 20_000 });
});

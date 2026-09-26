import { test, expect } from "@playwright/test";
import { goto, expectPagePainted } from "./helpers.mjs";

/**
 * The front door, walked all the way through.
 *
 * Every other spec starts from an account the seed made. None of them had ever
 * filled in the registration form and pressed Register, which is the one thing
 * every student outside the organizing team does -- so the form could have been
 * refusing everybody and the suite would have been green.
 *
 * This registers a brand-new student through the real form against the real
 * auth emulator and rules, lands them on their dashboard, and has them start a
 * team: the whole of what a student does before the day.
 */

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function fillRegistration(page, { email }) {
  await page.getByLabel("First name").fill("Rosa");
  await page.getByLabel("Last name").fill("Delgado");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("testtest");
  await page.getByLabel("Major or intended major").fill("Systems Engineering");

  await page.getByLabel("Gender").click();
  await page.getByRole("option", { name: "Prefer not to say" }).click();

  await page.getByLabel(/I confirm I am 18 years or older/).check();
}

test("a new student registers, lands on their dashboard, and starts a team", async ({ page }) => {
  const email = `e2e-reg-${unique()}@virginia.edu`;

  await goto(page, "/");
  await expectPagePainted(page);
  await fillRegistration(page, { email });

  // everything answered, and the rail says so before anyone presses the button
  // the phone's pinned bar carries the same count, hidden at this width
  await expect(page.getByText("Everything is answered").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Register" }).first().click();

  const done = page.getByRole("dialog", { name: "Registration complete" });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.getByRole("button", { name: "Go to dashboard" }).click();

  // signed in as the person who just registered, not as anybody seeded
  await expect(page).toHaveURL(/#\/user\/home/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Hi, Rosa" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Find a team")).toBeVisible();

  await page.getByRole("link", { name: "Create a team" }).click();
  await page.getByLabel("Team name").fill(`Rosa's Team ${unique()}`);
  await page.getByRole("button", { name: "Create team" }).click();

  await expect(page).toHaveURL(/#\/user\/team$/, { timeout: 20_000 });
  await expect(page.getByText("Team ID")).toBeVisible();
  await expect(page.getByText("Rosa Delgado (you)")).toBeVisible({ timeout: 20_000 });
  // an unsubmitted team is offered the form the judges will read
  await expect(page.getByLabel("Idea name")).toBeVisible();
});

test("a form with answers missing says which, instead of submitting", async ({ page }) => {
  await goto(page, "/");
  await page.getByLabel("First name").fill("Half");
  await page.getByRole("button", { name: "Register" }).first().click();

  // nothing was created: no success dialog, and the rail still counts what is left
  await expect(page.getByRole("dialog", { name: "Registration complete" })).toHaveCount(0);
  await expect(page.getByText(/answers? left/).filter({ visible: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test("an email that is already registered is refused, and says so", async ({ page }) => {
  await goto(page, "/");
  // the seed's own competitor
  await fillRegistration(page, { email: "competitor1@example.com" });
  await page.getByRole("button", { name: "Register" }).first().click();

  // said beside the button, and the email field is handed back to fix
  await expect(
    page.getByText("An account already uses that email address. Sign in instead, or reset the password.").filter({ visible: true })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Email address")).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Registration complete" })).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import {
  signIn, goto, expectPagePainted, createTeamlessCompetitor, createTeam,
} from "./helpers.mjs";

/**
 * The competitor journey, and the reason this whole layer exists.
 *
 * `joinTeam` read `submitted` and `members` before letting anyone in. Neither is
 * readable by a non-member -- which is precisely who is joining -- so the read
 * rejected, the catch fired, and every join in the app returned "Could not join
 * that team. Please try again." Retrying could never work.
 *
 * Every unit test mocks the database, so no test above this one could see it.
 * This spec joins a team as a real signed-in user against the real rules.
 */

test("a competitor lands on a dashboard, not an empty page", async ({ page }) => {
  await signIn(page, "competitor");
  await goto(page, "/user/home");

  await expectPagePainted(page);
  // the greeting is by name once the record has loaded
  await expect(page.getByRole("heading", { level: 1, name: /^(Hi, .+|Welcome)$/ })).toBeVisible();
});

test("joining a team by id actually works", async ({ page, request }) => {
  const person = await createTeamlessCompetitor(request);
  const teamId = await createTeam(request, { name: "E2E Open Team" });

  await signIn(page, person);
  await goto(page, "/user/team/join");
  await expectPagePainted(page);

  await page.getByLabel("Team ID").fill(teamId);
  await page.getByRole("button", { name: /join/i }).click();

  // the bug: this used to show "Could not join that team. Please try again."
  await expect(page.getByText(/could not join/i)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/user\/team/, { timeout: 20_000 });
  await expect(page.getByText("E2E Open Team")).toBeVisible();
});

test("a team that has already submitted says so, rather than failing vaguely", async ({
  page,
  request,
}) => {
  const person = await createTeamlessCompetitor(request);
  const teamId = await createTeam(request, { name: "E2E Closed Team", submitted: true });

  await signIn(page, person);
  await goto(page, "/user/team/join");

  await page.getByLabel("Team ID").fill(teamId);
  await page.getByRole("button", { name: /join/i }).click();

  await expect(page.getByText(/already submitted/i)).toBeVisible();
  await expect(page.getByText(/please try again/i)).toHaveCount(0);
});

test("an id nobody has is named as such", async ({ page, request }) => {
  const person = await createTeamlessCompetitor(request);

  await signIn(page, person);
  await goto(page, "/user/team/join");

  await page.getByLabel("Team ID").fill("definitely-not-a-team");
  await page.getByRole("button", { name: /join/i }).click();

  await expect(page.getByText(/no team found/i)).toBeVisible();
});

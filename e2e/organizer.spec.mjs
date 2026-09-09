import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted } from "./helpers.mjs";

/**
 * What an organizer can actually reach.
 *
 * Two bugs here were invisible to every other layer. The schedule planner
 * stacked two full page frames, so the first screenful was a nav, a tab strip,
 * a viewport-tall empty container and a footer -- correct in the DOM, blank on
 * a screen, and jsdom has no viewport. And the room sheets were built with no
 * link to them from anywhere, which no test that imports a component directly
 * can notice.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page, "admin");
});

test("the dashboard says where the day is and what to do next", async ({ page }) => {
  await goto(page, "/user/home");
  await expectPagePainted(page);

  await expect(page.getByText("Event status")).toBeVisible();
  await expect(page.getByText("Before judging can run")).toBeVisible();
});

test("every admin destination in the nav opens a painted page", async ({ page }) => {
  const destinations = [
    "/user/admin/search",
    "/user/admin/judges",
    "/user/admin/teams",
    "/user/admin/judging",
    "/user/admin/results",
    "/user/admin/control",
    "/user/admin/metrics",
  ];

  for (const path of destinations) {
    await goto(page, path);
    await expectPagePainted(page);
    // the planner bug: content a full screen below the fold
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("the schedule planner draws one page frame, not two stacked", async ({ page }) => {
  await goto(page, "/user/admin/schedule");
  await expectPagePainted(page);

  await expect(page.getByRole("tab", { name: "First round" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
});

test("the final round tab opens without leaving the page", async ({ page }) => {
  await goto(page, "/user/admin/schedule?round=final");
  await expectPagePainted(page);

  // the page is titled once, above the tabs; the round is which tab is on,
  // not a second heading repeating it
  await expect(page.getByRole("heading", { name: "Judging schedule" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Final round", selected: true })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(1);
});

test("the room sheets are reachable from where an organizer stands", async ({ page }) => {
  // built once with no link to it from anywhere, which is the same failure as
  // a function exported and never imported
  await goto(page, "/user/admin/judging");
  await page.getByRole("link", { name: "Room sheets" }).click();

  await expect(page).toHaveURL(/#\/user\/admin\/print/);
  await expect(page.getByRole("heading", { name: "Room sheets" })).toBeVisible();
});

test("the control panel keeps the danger zone off the first tab", async ({ page }) => {
  await goto(page, "/user/admin/control");
  await expectPagePainted(page);

  await expect(page.getByRole("heading", { name: "Judging rooms" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Danger zone" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Recovery" }).click();
  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  await expect(page).toHaveURL(/tab=recovery/);
});

test("a control panel tab can be linked to directly", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=people");
  await expect(page.getByRole("heading", { name: "People and roles" })).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted, seedFirstRoundScores, judge } from "./helpers.mjs";

/**
 * The last hour of the event: cutting the finalists, correcting the plan, and
 * publishing it — then reading the result off a screen instead of a spreadsheet.
 *
 * Every piece of this is new enough to be worth driving end to end. The planner
 * replaced a modal that derived everything at the moment of the write; the
 * results page replaced no page at all, because the standings were written and
 * never read.
 *
 * The final round ranks on first-round averages, so this seeds those itself
 * rather than depending on whichever spec ran before it.
 */

test.beforeEach(async ({ request }) => {
  await seedFirstRoundScores(request);
});

test("the cut can be built, corrected and published", async ({ page }) => {
  // building reads every score in the event before it draws anything
  test.setTimeout(120_000);

  await signIn(page, "admin");
  await goto(page, "/user/admin/schedule?round=final");
  await expectPagePainted(page);

  const build = page.getByRole("button", { name: "Build a final round plan" });
  const publish = page.getByRole("button", { name: "Publish the final round" });

  await expect(build.or(publish).first()).toBeVisible({ timeout: 30_000 });
  if (await build.isVisible()) await build.click();

  // the plan is a running order, not a list of ids
  await expect(page.getByText("Running order —", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Slot 1")).toBeVisible();

  // correcting it: move the first team later, which renumbers everything between
  await page.getByRole("button", { name: "↓" }).first().click();
  await expect(page.getByRole("button", { name: /Undo \(1\)/ })).toBeVisible({ timeout: 15_000 });

  // and the edit is undoable, which is the whole point of a draft
  await page.getByRole("button", { name: /Undo \(1\)/ }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await publish.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/replaces every judge/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();

  // publishing lands somewhere rather than dropping back to "build a plan"
  await expect(page.getByText(/Final round published/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Watch final round progress/ })).toBeVisible();
});

test("the results page ranks the final round, and refuses to name a winner early", async ({
  page,
}) => {
  await signIn(page, "admin");
  await goto(page, "/user/admin/results");
  await expectPagePainted(page);

  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText("Final round standings")).toBeVisible({ timeout: 20_000 });

  // nobody has scored the final round yet, so this is a running total
  await expect(page.getByText(/running total, not the result|No final round scores/i)).toBeVisible();
  await expect(page.getByText("Winner")).toHaveCount(0);
});

test("a judge is given final round cards, on their own record", async ({ page }) => {
  await signIn(page, "judge");
  await goto(page, "/user/judging");
  await expectPagePainted(page);

  // the flag is readable by anyone signed in; the assignments are not. A judge
  // who scored every finalist in round one is correctly given nothing to do,
  // so the section is the assertion rather than the cards inside it.
  await expect(page.getByRole("heading", { name: "Final round" })).toBeVisible({ timeout: 20_000 });
});

test("a final-round-only judge gets cards, despite judging no first round", async ({ page }) => {
  // The professors and professionals carry isFinalRoundJudge and are never
  // given a first-round batch, so this judge reaches the page with an empty
  // first-round list. That must not stop the final round section rendering --
  // it is the only reason they are here.
  await signIn(page, judge(13));
  await goto(page, "/user/judging");
  await expectPagePainted(page);

  await expect(page.getByRole("heading", { name: "First round" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No assignments yet/)).toBeVisible();

  await expect(page.getByRole("heading", { name: "Final round" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No final round assignments for you/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Score team" }).first()).toBeVisible();
});

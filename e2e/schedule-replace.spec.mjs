import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted, seedFirstRoundScores } from "./helpers.mjs";

/**
 * Replacing a schedule after judging has started.
 *
 * Scores are keyed by team and judge, so republishing moves assignments and no
 * cards. A card whose pairing the new plan drops keeps counting toward that
 * team's average -- the average the final-round cut is made from -- while
 * belonging to a judge who will not be in the room, and nothing downstream can
 * tell that has happened.
 *
 * So the publish is refused, and the only way through destroys those cards.
 * This drives both halves through the UI, because the refusal is worth nothing
 * if an organizer cannot see what it is asking them to decide.
 */

test.beforeEach(async ({ request }) => {
  await seedFirstRoundScores(request);
});

test("publishing over cards already filed is refused, and says why", async ({ page }) => {
  test.setTimeout(120_000);

  await signIn(page, "admin");
  await goto(page, "/user/admin/schedule");
  await expectPagePainted(page);

  const build = page.getByRole("button", { name: "Build a plan" });
  const publish = page.getByRole("button", { name: "Publish schedule" });
  await expect(build.or(publish).first()).toBeVisible({ timeout: 30_000 });
  if (await build.isVisible()) await build.click();

  await expect(publish).toBeVisible({ timeout: 30_000 });
  await publish.click();

  // get past the ordinary "replace the schedule" confirmation first
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Publish this schedule/ })).toBeVisible();
  const prompt = (await dialog.getByText(/Type\s+".+?"\s+to confirm/).first().textContent()) ?? "";
  const phrase = prompt.match(/Type\s+"(.+?)"\s+to confirm/)?.[1];
  await dialog.getByRole("textbox").fill(phrase);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();

  // and land on the refusal, which names the consequence rather than just failing
  await expect(
    page.getByRole("heading", { name: /Judging has already started/ })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/already been filed/)).toBeVisible();
  await expect(page.getByText(/counting toward the standings/)).toBeVisible();

  // nothing was written: still on the planner, not navigated to judging progress
  await expect(page).toHaveURL(/#\/user\/admin\/schedule/);
});

test("discarding the scores is what lets it through", async ({ page, request }) => {
  test.setTimeout(120_000);

  await signIn(page, "admin");
  await goto(page, "/user/admin/schedule");
  await expectPagePainted(page);

  const build = page.getByRole("button", { name: "Build a plan" });
  const publish = page.getByRole("button", { name: "Publish schedule" });
  await expect(build.or(publish).first()).toBeVisible({ timeout: 30_000 });
  if (await build.isVisible()) await build.click();
  await expect(publish).toBeVisible({ timeout: 30_000 });
  await publish.click();

  const dialog = page.getByRole("dialog");
  const prompt = (await dialog.getByText(/Type\s+".+?"\s+to confirm/).first().textContent()) ?? "";
  await dialog.getByRole("textbox").fill(prompt.match(/Type\s+"(.+?)"\s+to confirm/)?.[1]);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: /Judging has already started/ })
  ).toBeVisible({ timeout: 30_000 });

  // the override is gated behind its own phrase, because it destroys real work
  const override = page.getByRole("dialog");
  const confirm = override.getByRole("button", { name: /Discard scores and publish/ });
  await expect(confirm).toBeDisabled();
  await override.getByRole("textbox").fill("discard scores");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page).toHaveURL(/#\/user\/admin\/judging/, { timeout: 30_000 });
  await expectPagePainted(page);
});

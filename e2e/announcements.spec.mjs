import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted, judge } from "./helpers.mjs";

/**
 * An organizer tells the room something, and the room hears it -- live, with
 * three people signed in at once in separate browsers: the organizer posting,
 * a competitor it is for, and a judge it is not for.
 *
 * Other specs compare screenshots of signed-in pages, so this takes down
 * whatever it posted however it ends.
 */

const DB = "http://127.0.0.1:9000";
const NS = "demo-ideathon-default-rtdb";
const ADMIN = { Authorization: "Bearer owner" };

test.afterEach(async ({ request }) => {
  await request.delete(`${DB}/announcements.json?ns=${NS}`, { headers: ADMIN });
});

test("an announcement reaches the people it is for, live, and goes when it is taken down", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const [admin, competitor, judgePage] = await Promise.all(contexts.map((context) => context.newPage()));

    await signIn(competitor, "competitor");
    await goto(competitor, "/user/team");
    await expectPagePainted(competitor);

    await signIn(judgePage, judge(10));
    await goto(judgePage, "/user/judging");
    await expectPagePainted(judgePage);

    await signIn(admin, "admin");
    await goto(admin, "/user/home");
    const message = `Decks due at 3:00 PM (${Date.now()}).`;
    await admin.getByLabel("Announcement").fill(message);
    await admin.getByRole("group", { name: "Send to" }).getByRole("button", { name: "Competitors" }).click();
    await admin.getByRole("button", { name: "Post announcement" }).click();
    await expect(admin.getByText("Posted to competitors.")).toBeVisible();

    // no reload on either page
    const banner = competitor.getByRole("region", { name: "Announcements" });
    await expect(banner.getByText(message)).toBeVisible({ timeout: 15_000 });
    await expect(judgePage.getByText(message)).toHaveCount(0);

    await admin.getByRole("button", { name: "Take down" }).click();
    await expect(competitor.getByText(message)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("a reader can dismiss one, and it stays dismissed", async ({ page, request }) => {
  await request.put(`${DB}/announcements/e2e-dismiss.json?ns=${NS}`, {
    headers: ADMIN,
    data: { text: "Lunch is in the atrium.", audience: "everyone", postedAt: Date.now(), active: true },
  });

  await signIn(page, "competitor");
  await goto(page, "/user/home");
  const lunch = page.getByRole("alert").filter({ hasText: "Lunch is in the atrium." });
  await expect(lunch).toBeVisible({ timeout: 15_000 });
  await lunch.getByRole("button", { name: "Dismiss" }).click();
  await expect(lunch).toHaveCount(0);

  await page.reload();
  await expectPagePainted(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Lunch is in the atrium.")).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted } from "./helpers.mjs";

/**
 * An organizer posts a link and a competitor sees it on their home page.
 *
 * "Show now" is switched on so the card is visible whatever the clock says.
 * Other specs compare screenshots of signed-in pages, so this takes down
 * whatever it posted however it ends.
 */

const DB = "http://127.0.0.1:9000";
const NS = "demo-ideathon-default-rtdb";
const ADMIN = { Authorization: "Bearer owner" };

test.afterEach(async ({ request }) => {
  await request.delete(`${DB}/resources.json?ns=${NS}`, { headers: ADMIN });
  await request.delete(`${DB}/config/resourcesShowNow.json?ns=${NS}`, { headers: ADMIN });
});

test("a resource an organizer posts reaches competitors on their home page", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [admin, competitor] = await Promise.all(contexts.map((context) => context.newPage()));

    await signIn(admin, "admin");
    await goto(admin, "/user/home");
    const title = `Judging rubric ${Date.now()}`;
    const url = "https://example.com/rubric";
    await admin.getByLabel("Title", { exact: true }).fill(title);
    await admin.getByLabel("Link", { exact: true }).fill(url);
    await admin.getByLabel("Description").fill("How you are scored.");
    await admin.getByRole("button", { name: "Add resource" }).click();
    await expect(admin.getByRole("button", { name: `Move ${title} up` })).toBeVisible();

    await admin.getByRole("switch", { name: "Show now" }).check();

    await signIn(competitor, "competitor");
    await goto(competitor, "/user/home");
    await expectPagePainted(competitor);
    const card = competitor.getByRole("link", { name: new RegExp(title) });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("href", url);
    await expect(card).toHaveAttribute("target", "_blank");
    await expect(competitor.getByRole("heading", { name: "Resources" })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

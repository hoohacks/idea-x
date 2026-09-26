import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted } from "./helpers.mjs";

/**
 * The controls that change data, driven rather than rendered.
 *
 * Everything else in this suite checks that a page paints. These press the
 * buttons: add a room, rename it, remove it, grant admin access, change a role,
 * pull an export. Each writes through a service that fans a change out across
 * several nodes, and each is a place where "it rendered" and "it worked" are
 * different claims.
 *
 * They run against enforced rules, so a write the rules would refuse fails here
 * rather than in front of a room full of people.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page, "admin");
});

/**
 * Scope to the section, always.
 *
 * A page-wide `getByRole("button", { name: "Admin" })` matched the nav's own
 * Admin dropdown and opened the menu instead of toggling anybody. Every control
 * panel section is a <section> with an h2, so that is the unit to work inside.
 */
const section = (page, heading) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, level: 2 }) });

/** The row inside a section that mentions this text and carries its own buttons. */
const rowWith = (scope, page, text) =>
  scope.locator("div").filter({ hasText: text }).filter({ has: page.getByRole("button") }).last();

test("a room can be added, renamed and removed", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=setup");
  await expectPagePainted(page);

  const rooms = section(page, "Judging rooms");
  await expect(rooms).toBeVisible();

  const name = `E2E Room ${Date.now()}`;
  const renamed = `${name} B`;

  await rooms.getByRole("textbox").first().fill(name);
  await rooms.getByRole("button", { name: "Add", exact: true }).click();
  await expect(rooms.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  // renaming happens in place: the row turns into a field, not a dialog
  await rowWith(rooms, page, name).getByRole("button", { name: "Rename" }).click();
  const field = rooms.getByRole("textbox").filter({ hasNot: page.locator("[placeholder]") }).last();
  await field.fill(renamed);
  await rooms.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rooms.getByText(renamed, { exact: true })).toBeVisible({ timeout: 15_000 });

  // And take it away again, so repeated runs do not accumulate rooms. A room no
  // schedule is using goes straight away; the confirmation only appears when
  // teams would have to be moved out of it.
  await rowWith(rooms, page, renamed).getByRole("button", { name: "Remove" }).click();

  const confirm = page.getByRole("dialog");
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.getByRole("button", { name: /^Remove/ }).click();
  }

  await expect(rooms.getByText(renamed, { exact: true })).toHaveCount(0, { timeout: 15_000 });
});

test("admin access is a switch that sits on top of the role", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=people");
  await expectPagePainted(page);

  const people = section(page, "People and roles");
  await expect(people).toBeVisible();

  // narrow to one person so the controls below are unambiguous
  await people.getByRole("textbox").first().fill("judge2@example.com");
  await expect(people.getByText("judge2@example.com")).toBeVisible({ timeout: 15_000 });

  // a MUI Switch, so a checkbox -- the page also has an "Admin" nav button
  const admin = people.getByRole("checkbox", { name: "Admin" });
  await expect(admin).toBeVisible();

  await admin.click();
  await expect(page.getByText(/is now an admin/)).toBeVisible({ timeout: 15_000 });

  // the role is untouched: admin is a flag, not a replacement for it
  await expect(people.getByRole("button", { name: /^Role for / })).toHaveText("Judge");

  // put it back, so the fixture is unchanged for the next run
  await admin.click();
  await expect(page.getByText(/is no longer an admin/)).toBeVisible({ timeout: 15_000 });
});

test("changing somebody's role asks first, and names what it costs", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=people");
  await expectPagePainted(page);

  const people = section(page, "People and roles");
  await people.getByRole("textbox").first().fill("judge3@example.com");
  await expect(people.getByText("judge3@example.com")).toBeVisible({ timeout: 15_000 });

  await people.getByRole("button", { name: /^Role for / }).click();
  await page.getByRole("option", { name: "Competitor" }).click();

  // the confirmation is the point: a role change deletes a record
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Deletes their judge record/)).toBeVisible();
  await expect(dialog.getByText(/archived/)).toBeVisible();

  // walk away: this spec is about the guard, not the change
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(people.getByRole("button", { name: /^Role for / })).toHaveText("Judge");
});

test("the danger zone is behind its own tab and will not act unprompted", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=recovery");
  await expectPagePainted(page);
  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();

  const clear = page.getByRole("button", { name: /clear the schedule/i }).first();
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button").last()).toBeDisabled();
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
  }
});

test("an export produces a file rather than an error", async ({ page }) => {
  await goto(page, "/user/admin/control?tab=data");
  await expectPagePainted(page);

  // every export button is called Download; the row says which one it is
  const exports = section(page, "Export");
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await rowWith(exports, page, /Standings.*first round/)
    .getByRole("button", { name: "Download" })
    .click();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/standings-first.*\.csv/);
});

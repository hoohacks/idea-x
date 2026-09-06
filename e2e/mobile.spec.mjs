import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted, judge } from "./helpers.mjs";

/**
 * The app on a phone, which is where judging actually happens.
 *
 * A judge is standing in a room with a device in one hand. Every layout bug
 * this project has had was invisible to every other layer, because jsdom has no
 * viewport: a page can be perfectly correct in the DOM and still be a blank
 * screen, or a column of controls running off the side of a 393px display.
 *
 * These run under a real device profile rather than a resized desktop, so touch
 * targets, the drawer and the media queries are the ones a judge gets.
 */

/**
 * Nothing may scroll sideways.
 *
 * Horizontal overflow is the classic phone failure: one wide table or one
 * unwrapped row, and the whole page slides under the thumb while the person is
 * trying to read it.
 */
async function expectNoSidewaysScroll(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(1);
}

/**
 * No field may be smaller than 16px on a phone.
 *
 * This is the bug that made the whole site feel broken. iOS Safari zooms the
 * page in whenever a focused field's text is under 16px and never zooms back
 * out, so tapping "First name" on the registration form left the site magnified
 * and sliding left and right under the thumb -- reported as "wonky and glitchy,
 * I can drag the screen". Every field in the app was 15px.
 *
 * Chromium does not zoom, so this cannot be caught by driving the page; it has
 * to be asserted on the computed style, which is what iOS actually reads.
 */
async function expectNoZoomOnFocus(page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // MUI hides a native input behind every Select; iOS never focuses it
        return box.width > 0 && style.opacity !== "0" && !["checkbox", "radio", "file"].includes(el.type);
      })
      .map((el) => ({ name: el.name || el.type, px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((f) => f.px < 16)
  );
  expect(small, "fields this small make iOS zoom the page and never zoom back").toEqual([]);
}

test("a judge can reach their cards through the drawer", async ({ page }) => {
  await signIn(page, judge(6));
  await goto(page, "/user/home");
  await expectPagePainted(page);
  await expectNoSidewaysScroll(page);

  // The desktop nav collapses to a drawer at this width. Its entries are
  // ListItemButtons, so they are buttons rather than links.
  await page.getByRole("button", { name: "Open menu" }).click();

  const judging = page.getByRole("button", { name: "Judging", exact: true });
  await expect(judging).toBeVisible({ timeout: 15_000 });
  await judging.click();

  await expect(page.getByText("First round")).toBeVisible({ timeout: 20_000 });
  await expectNoSidewaysScroll(page);
});

test("the score dialog is usable at phone width", async ({ page }) => {
  // opens a card without submitting, so it needs one nobody has scored
  await signIn(page, judge(7));
  await goto(page, "/user/judging");
  await expectPagePainted(page);

  const card = page.getByRole("button", { name: "Score team" }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // all five criteria reachable, and the submit button on screen rather than
  // somewhere below a scroll the person has to guess at
  await expect(dialog.locator(".MuiSelect-select")).toHaveCount(5);
  await expect(dialog.getByRole("button", { name: "Submit score" })).toBeVisible();
  await expectNoSidewaysScroll(page);

  /*
   * The footer has to be inside the card, not hanging off the bottom of it.
   *
   * `toBeVisible` does not catch this: the buttons were rendered and on screen,
   * they were just painted outside the dialog, over the page behind. The rubric
   * is taller than a phone, so the form between the paper and its sections has
   * to be the flex column that scrolls -- otherwise the sections stack at full
   * height and push the actions out.
   */
  const inside = await page.evaluate(() => {
    const paper = document.querySelector(".MuiDialog-paper").getBoundingClientRect();
    const actions = document.querySelector(".MuiDialogActions-root").getBoundingClientRect();
    const content = document.querySelector(".MuiDialogContent-root");
    return {
      overhang: Math.round(actions.bottom - paper.bottom),
      contentScrolls: content.scrollHeight > content.clientHeight,
    };
  });
  expect(inside.overhang, "the dialog footer hangs outside the card").toBeLessThanOrEqual(1);
  expect(inside.contentScrolls, "the rubric should scroll inside the card").toBe(true);

  await dialog.getByRole("button", { name: /cancel|close/i }).first().click();
});

test("the organizer pages do not run off the side of a phone", async ({ page }) => {
  await signIn(page, "admin");

  // the dense ones: a stats bar, a row list, and a tabbed settings page
  for (const path of ["/user/home", "/user/admin/judging", "/user/admin/control", "/user/admin/results"]) {
    await goto(page, path);
    await expectPagePainted(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page);
  }
});

test("the public forms fit a phone, since that is how most people register", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Student registration")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectNoZoomOnFocus(page);

  await goto(page, "/judge-registration");
  await expect(page.getByText("Judge and mentor sign-up")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectNoZoomOnFocus(page);

  await goto(page, "/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expectNoZoomOnFocus(page);
});

/**
 * Focusing a field must not hide it under the submit bar.
 *
 * The bar is pinned to the bottom 86 pixels of the screen on a phone, and the
 * browser scrolls a focused field only just far enough to be "in view" -- which
 * put the password field squarely underneath it, at the moment the keyboard
 * came up. The person was then typing into something they could not see, on the
 * form the whole event depends on.
 */
test("a focused field is never hidden behind the pinned submit bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Student registration")).toBeVisible();

  for (const label of [/Password/, /Email address/, /Major or intended major/]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByLabel(label).focus();

    const covered = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("*")].find(
        (el) =>
          getComputedStyle(el).position === "sticky" && el.querySelector('button[type="submit"]')
      );
      if (!bar) return null;
      const field = document.activeElement.getBoundingClientRect();
      const pinned = bar.getBoundingClientRect();
      return field.bottom > pinned.top && field.top < pinned.bottom;
    });

    expect(covered, `${label} sits under the submit bar once focused`).toBe(false);
  }
});

/**
 * The room sheets are built for paper, but an organizer checking a room reads
 * them off a phone. Five columns cannot shrink below their content, so the
 * table used to carry the whole page sideways with it.
 */
test("the room sheets scroll the table, not the page", async ({ page }) => {
  // 320px is an iPhone SE, and the narrowest thing anyone still turns up with.
  // The sheet fits a 393px Pixel, so a test at the default width would pass
  // whether or not the table is wrapped.
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page, "admin");
  await goto(page, "/user/admin/print");
  await expect(page.getByRole("heading", { name: "Room sheets" })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

/**
 * A tap on the menu during the loading window used to be swallowed: the guard's
 * frame is replaced by the page's own when the role arrives, and the drawer
 * went with it. The deterministic version of this is in protectedRoute.test.js;
 * this is the same thing through a real browser, where the window is real.
 */
test("the menu still opens if it is tapped before the page has resolved", async ({ page }) => {
  await signIn(page, judge(8));
  await goto(page, "/user/home");

  // deliberately no wait for content: the bar paints before the role does
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 20_000 });
});

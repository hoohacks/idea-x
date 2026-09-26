import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { goto, signIn, expectPagePainted, judge } from "./helpers.mjs";

/**
 * Automated accessibility checks, page by page, for every role.
 *
 * axe catches the mechanical failures -- a control with no name, text that is
 * too faint to read, a landmark missing, an ARIA attribute on the wrong thing.
 * It cannot tell whether a page makes sense to someone using a screen reader,
 * so passing here is a floor, not a verdict.
 *
 * Checked against WCAG 2.1 A and AA, which is what the university is held to.
 * A failure prints each rule with the elements that broke it, so the fix is in
 * the report rather than behind a rerun.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page, label) {
  // let data arrive, and entrance animations settle, before judging colours
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const report = violations
    .map((violation) =>
      [
        `${violation.id} (${violation.impact}): ${violation.help}`,
        ...violation.nodes.slice(0, 5).map((node) => `    ${node.target.join(" ")}  ${node.failureSummary?.split("\n")[1]?.trim() ?? ""}`),
      ].join("\n")
    )
    .join("\n");
  // soft, so one sweep reports every page rather than stopping at the first
  expect.soft(violations, `${label}\n${report}`).toEqual([]);
}

const PUBLIC = ["/", "/judge-registration", "/login", "/forgot-password"];

for (const path of PUBLIC) {
  test(`public page ${path} has no WCAG A or AA violations`, async ({ page }) => {
    await goto(page, path);
    await expectPagePainted(page);
    await expectAccessible(page, path);
  });
}

const SIGNED_IN = {
  competitor: ["/user/home", "/user/team", "/user/checkin", "/user/profile"],
  judge: ["/user/home", "/user/judging"],
  admin: [
    "/user/home",
    "/user/admin/judging",
    "/user/admin/schedule",
    "/user/admin/teams",
    "/user/admin/judges",
    "/user/admin/search",
    "/user/admin/results",
    "/user/admin/control",
    "/user/admin/control?tab=people",
    "/user/admin/metrics",
  ],
};

for (const [who, paths] of Object.entries(SIGNED_IN)) {
  test(`${who} pages have no WCAG A or AA violations`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, who);
    for (const path of paths) {
      await goto(page, path);
      await expectPagePainted(page);
      await expectAccessible(page, `${who} ${path}`);
    }
  });
}

test("the judge's score dialog has no WCAG A or AA violations", async ({ page }) => {
  // a judge who is never asked to submit, so this leaves their cards alone
  await signIn(page, judge(9));
  await goto(page, "/user/judging");
  const score = page.getByRole("button", { name: "Score team" }).first();
  await expect(score).toBeVisible({ timeout: 20_000 });
  await score.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAccessible(page, "score dialog");
});

import { test, expect } from "@playwright/test";
import { signIn, goto, expectPagePainted, createTeamlessCompetitor, createTeam } from "./helpers.mjs";

/**
 * The switch organizers flip on the day.
 *
 * Until config/submissionsOpen is true a team can form but not hand anything
 * in, so a team made weeks ahead cannot lock itself (submitting closes a team
 * to new members) or arrive with a finished pitch. This drives the real switch
 * in the control panel and watches a competitor's team page follow it live,
 * with both people signed in at once in separate browsers.
 *
 * The seed opens submissions, and every other spec relies on that, so this
 * puts the flag back however it ends.
 */

const DB = "http://127.0.0.1:9000";
const NS = "demo-ideathon-default-rtdb";
const ADMIN = { Authorization: "Bearer owner" };

test("closing submissions takes the form away from a team, and opening brings it back", async ({ browser, request }) => {
  const person = await createTeamlessCompetitor(request);
  const teamId = await createTeam(request, { name: "E2E Switch Team" });
  // on the team already: this spec is about the switch, not about joining
  // a string `data` goes out raw rather than as JSON, so the id is encoded here
  for (const [path, value] of [
    [`teams/${teamId}/members/${person.uid}`, true],
    [`competitors/${person.uid}/teamId`, JSON.stringify(teamId)],
  ]) {
    const res = await request.put(`${DB}/${path}.json?ns=${NS}`, { headers: ADMIN, data: value });
    if (!res.ok()) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  }

  const competitorContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    const competitor = await competitorContext.newPage();
    await signIn(competitor, person);
    await goto(competitor, "/user/team");
    await expectPagePainted(competitor);
    await expect(competitor.getByLabel("Idea name")).toBeVisible({ timeout: 20_000 });

    const admin = await adminContext.newPage();
    await signIn(admin, "admin");
    await goto(admin, "/user/admin/control?tab=setup");
    const event = admin
      .locator("section")
      .filter({ has: admin.getByRole("heading", { name: "Event", level: 2 }) });

    await event.getByRole("button", { name: "Open", exact: true }).click();
    await expect(event.getByRole("button", { name: "Closed", exact: true })).toHaveAttribute("aria-pressed", "false");

    // no reload: the team page is subscribed to the flag
    await expect(competitor.getByText(/Submissions open on the day of the event/)).toBeVisible({ timeout: 15_000 });
    await expect(competitor.getByLabel("Idea name")).toHaveCount(0);
    await expect(competitor.getByRole("heading", { name: "Team ID" })).toBeVisible();

    await event.getByRole("button", { name: "Closed", exact: true }).click();
    await expect(event.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(competitor.getByLabel("Idea name")).toBeVisible({ timeout: 15_000 });
  } finally {
    await request.put(`${DB}/config/submissionsOpen.json?ns=${NS}`, { headers: ADMIN, data: true });
    await competitorContext.close();
    await adminContext.close();
  }
});

import { expect } from "@playwright/test";

/**
 * The seeded accounts. `npm run seed` creates all of them with one password;
 * `test:e2e` runs the seed before Playwright starts.
 */
export const ACCOUNTS = {
  admin: { email: "admin@example.com", password: "testtest" },
  judge: { email: "judge1@example.com", password: "testtest" },
  competitor: { email: "competitor1@example.com", password: "testtest" },
};

/**
 * The app is a HashRouter, so every route lives after a `#`.
 *
 * Writing that out in each spec is how the wrong URL gets normalised into the
 * tests as well as the app -- `/judge-registration` without the hash silently
 * served the competitor form for weeks.
 */
/**
 * A specific seeded judge.
 *
 * Cards can only be scored once, so specs that submit a score must not share a
 * judge with each other -- the second one finds nothing left to score and fails
 * looking like a bug. The seed makes judge1..judgeN with one password.
 */
export const judge = (n) => ({ email: `judge${n}@example.com`, password: "testtest" });

export const route = (path) => `/#${path.startsWith("/") ? path : `/${path}`}`;

export async function goto(page, path) {
  await page.goto(route(path));
}

/** Sign in and wait until the app has resolved a role, not just the form. */
export async function signIn(page, who) {
  const { email, password } = ACCOUNTS[who] ?? who;

  await goto(page, "/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/#\/user\//, { timeout: 20_000 });
}

/**
 * Nothing in the app should ever render an empty page.
 *
 * A blank screen has meant three different things in this project -- a thrown
 * render, a wrong URL, and a page pushed below the fold -- so every spec checks
 * for it rather than only for the thing it came to test.
 */
export async function expectPagePainted(page) {
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByText(/Something went wrong on this page/)).toHaveCount(0);
}

/** The emulator endpoints. Same hosts the seed script and the rules tests use. */
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts";
const DB = "http://127.0.0.1:9000";
// the namespace the emulator applies the rules to, and the one the app
// connects to -- see the note in src/firebase.js
const NS = "demo-ideathon-default-rtdb";

// The emulator's admin bypass, the same one scripts/seed-event.mjs uses. Rules
// ARE enforced on this namespace, so a plain unauthenticated write is `auth ==
// null` and gets a 401 -- fixtures have to say who they are.
const ADMIN = { Authorization: "Bearer owner" };

/**
 * A competitor who is not on a team yet.
 *
 * Every seeded competitor is already on one, and the join page redirects anyone
 * who has a `teamId` straight to their team -- so a join can only be exercised
 * by somebody new. Created straight through the emulator REST APIs rather than
 * the registration form, so this spec fails for join reasons and not for
 * whatever the registration form happens to require this month.
 */
export async function createTeamlessCompetitor(request) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = "testtest";

  const signUp = await request.post(`${AUTH}:signUp?key=fake-api-key`, {
    data: { email, password, returnSecureToken: true },
  });
  if (!signUp.ok()) throw new Error(`could not create an account: ${await signUp.text()}`);
  const { localId } = await signUp.json();

  const record = await request.put(`${DB}/competitors/${localId}.json?ns=${NS}`, {
    headers: ADMIN,
    data: {
      firstName: "E2E",
      lastName: "Competitor",
      email,
      major: "CS",
      checkedIn: false,
      foodCheckIn: false,
    },
  });
  if (!record.ok())
    throw new Error(`competitor record: ${record.status()} ${await record.text()}`);

  return { email, password, uid: localId };
}

/** A team somebody can join, or one that is closed. */
export async function createTeam(request, { name, submitted = false }) {
  const teamId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.put(`${DB}/teams/${teamId}.json?ns=${NS}`, {
    headers: ADMIN,
    data: { name, submitted, createdBy: "e2e" },
  });
  if (!res.ok()) throw new Error(`team: ${res.status()} ${await res.text()}`);
  return teamId;
}

/**
 * First-round score cards, written past the rules.
 *
 * The final round ranks teams on their first-round averages, so it cannot be
 * planned at all until somebody has scored. Seeding them here keeps the final
 * round spec independent of whatever the judge spec happened to do first.
 */
export async function seedFirstRoundScores(request, { teams = 6, perTeam = 2 } = {}) {
  const read = async (path) => {
    const res = await request.get(`${DB}/${path}.json?ns=${NS}`, { headers: ADMIN });
    return res.ok() ? (await res.json()) ?? {} : {};
  };

  const teamIds = Object.entries(await read("teams"))
    .filter(([, team]) => team?.submitted)
    .map(([id]) => id)
    .slice(0, teams);

  const judgeIds = Object.entries(await read("judges"))
    .filter(([, judge]) => judge?.isRound1Judge)
    .map(([id]) => id);

  if (!teamIds.length || !judgeIds.length) {
    throw new Error(`nothing to score: ${teamIds.length} teams, ${judgeIds.length} judges`);
  }

  const cards = {};
  teamIds.forEach((teamId, index) => {
    judgeIds.slice(0, perTeam).forEach((judgeId) => {
      // a descending spread, so the ranking has an unambiguous order
      const value = Math.max(1, 10 - index);
      cards[`${teamId}/${judgeId}`] = {
        problem: value,
        innovation: value,
        impact: value,
        viability: Math.max(1, Math.round(value / 2)),
        pitch_quality: Math.max(1, Math.round(value / 2)),
        fundable: index < 3,
        judgeUid: judgeId,
        teamId,
        enteredBy: judgeId,
        submittedAt: Date.now(),
      };
    });
  });

  const res = await request.patch(`${DB}/scores/first.json?ns=${NS}`, {
    headers: ADMIN,
    data: cards,
  });
  if (!res.ok()) throw new Error(`could not seed scores: ${res.status()} ${await res.text()}`);

  return teamIds;
}

/**
 * Remove every first-round card.
 *
 * Publishing a schedule is refused once cards exist for pairings the new plan
 * drops, so a spec that means to exercise the ordinary publish has to say which
 * state it starts from rather than inherit whatever the spec before it left
 * behind. The refusal itself is covered in schedule-replace.spec.mjs.
 */
export async function clearFirstRoundScores(request) {
  const res = await request.delete(`${DB}/scores/first.json?ns=${NS}`, { headers: ADMIN });
  if (!res.ok()) throw new Error(`could not clear scores: ${res.status()} ${await res.text()}`);
}

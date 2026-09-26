/**
 * /announcements.
 *
 * Everyone signed in reads them -- they are said to the whole room -- and only
 * organizers post. The shape is held here too, because the banner renders
 * whatever is stored on every signed-in page.
 */
import { describe, test, beforeAll, afterAll, beforeEach } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
import { makeTestEnv, seed, baseWorld } from "./helpers.mjs";

let testEnv;

beforeAll(async () => {
  testEnv = await makeTestEnv();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const announcement = (extra = {}) => ({
  text: "Lunch is in the atrium.",
  audience: "everyone",
  postedAt: Date.now(),
  active: true,
  ...extra,
});

beforeEach(async () => {
  await testEnv.clearDatabase();
  await seed(testEnv, { ...baseWorld(), announcements: { a1: announcement() } });
});

const db = (uid) => (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).database();

describe("reading", () => {
  test("a competitor and a judge can", async () => {
    await assertSucceeds(get(ref(db("alice"), "announcements")));
    await assertSucceeds(get(ref(db("judge1"), "announcements")));
  });

  test("nobody signed out can", async () => {
    await assertFails(get(ref(db(null), "announcements")));
  });
});

describe("posting", () => {
  test("an organizer can post one", async () => {
    await assertSucceeds(set(ref(db("admin"), "announcements/a2"), announcement({ audience: "judges" })));
  });

  test("and take it down", async () => {
    await assertSucceeds(set(ref(db("admin"), "announcements/a1/active"), false));
  });

  test("a competitor cannot post, or take one down", async () => {
    await assertFails(set(ref(db("alice"), "announcements/a2"), announcement()));
    await assertFails(set(ref(db("alice"), "announcements/a1/active"), false));
  });

  test("a judge cannot either", async () => {
    await assertFails(set(ref(db("judge1"), "announcements/a2"), announcement()));
  });
});

describe("the shape is held even for organizers", () => {
  test("an empty message is refused", async () => {
    await assertFails(set(ref(db("admin"), "announcements/a2"), announcement({ text: "" })));
  });

  test("so is one too long for a phone", async () => {
    await assertFails(set(ref(db("admin"), "announcements/a2"), announcement({ text: "x".repeat(281) })));
  });

  test("an audience that is not one of the three is refused", async () => {
    await assertFails(set(ref(db("admin"), "announcements/a2"), announcement({ audience: "sponsors" })));
  });

  test("so are missing or extra fields", async () => {
    const { active: _active, ...noActive } = announcement();
    await assertFails(set(ref(db("admin"), "announcements/a2"), noActive));
    await assertFails(set(ref(db("admin"), "announcements/a2"), announcement({ html: "<b>hi</b>" })));
  });
});

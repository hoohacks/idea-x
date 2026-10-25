/**
 * /resources and config/resourcesShowNow.
 *
 * Everyone signed in reads the resources -- the home page decides when to show
 * them, which is presentation, not secrecy -- and only organizers post. The
 * shape is held here too, because the home page renders whatever is stored and
 * turns the url into a link people tap.
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

const resource = (extra = {}) => ({
  title: "Judging rubric",
  url: "https://example.com/rubric.pdf",
  description: "How projects are scored.",
  forJudges: false,
  order: 0,
  createdAt: Date.now(),
  ...extra,
});

beforeEach(async () => {
  await testEnv.clearDatabase();
  await seed(testEnv, { ...baseWorld(), resources: { r1: resource() } });
});

const db = (uid) => (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).database();

describe("reading", () => {
  test("a competitor and a judge can", async () => {
    await assertSucceeds(get(ref(db("alice"), "resources")));
    await assertSucceeds(get(ref(db("judge1"), "resources")));
  });

  test("nobody signed out can", async () => {
    await assertFails(get(ref(db(null), "resources")));
  });
});

describe("posting", () => {
  test("an organizer can add one, with or without a description", async () => {
    await assertSucceeds(set(ref(db("admin"), "resources/r2"), resource({ forJudges: true })));
    const { description: _description, ...noDescription } = resource();
    await assertSucceeds(set(ref(db("admin"), "resources/r3"), noDescription));
  });

  test("and edit or remove one", async () => {
    await assertSucceeds(set(ref(db("admin"), "resources/r1/title"), "New title"));
    await assertSucceeds(set(ref(db("admin"), "resources/r1"), null));
  });

  test("a competitor cannot add, edit or remove one", async () => {
    await assertFails(set(ref(db("alice"), "resources/r2"), resource()));
    await assertFails(set(ref(db("alice"), "resources/r1/title"), "Mine"));
    await assertFails(set(ref(db("alice"), "resources/r1"), null));
  });

  test("a judge cannot either", async () => {
    await assertFails(set(ref(db("judge1"), "resources/r2"), resource()));
  });
});

describe("the shape is held even for organizers", () => {
  test("missing fields are refused", async () => {
    for (const field of ["title", "url", "forJudges", "order", "createdAt"]) {
      const { [field]: _gone, ...rest } = resource();
      await assertFails(set(ref(db("admin"), "resources/r2"), rest));
    }
  });

  test("an empty or too-long title is refused", async () => {
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ title: "" })));
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ title: "x".repeat(81) })));
    await assertSucceeds(set(ref(db("admin"), "resources/r2"), resource({ title: "x".repeat(80) })));
  });

  test("a link that is not https is refused", async () => {
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ url: "http://example.com" })));
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ url: "javascript:alert(1)" })));
  });

  test("a description too long for a phone is refused", async () => {
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ description: "x".repeat(141) })));
    await assertSucceeds(set(ref(db("admin"), "resources/r2"), resource({ description: "x".repeat(140) })));
  });

  test("extra fields are refused", async () => {
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ html: "<b>hi</b>" })));
  });

  test("forJudges has to be a boolean", async () => {
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ forJudges: "yes" })));
    await assertFails(set(ref(db("admin"), "resources/r2"), resource({ forJudges: 1 })));
  });
});

describe("config/resourcesShowNow", () => {
  test("an organizer can switch it on and off", async () => {
    await assertSucceeds(set(ref(db("admin"), "config/resourcesShowNow"), true));
    await assertSucceeds(set(ref(db("admin"), "config/resourcesShowNow"), false));
  });

  test("anything but a boolean is refused", async () => {
    await assertFails(set(ref(db("admin"), "config/resourcesShowNow"), "yes"));
    await assertFails(set(ref(db("admin"), "config/resourcesShowNow"), 1));
  });

  test("a competitor or judge cannot set it", async () => {
    await assertFails(set(ref(db("alice"), "config/resourcesShowNow"), true));
    await assertFails(set(ref(db("judge1"), "config/resourcesShowNow"), true));
  });
});

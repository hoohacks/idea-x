/**
 * /admins, /judges, /competitors, /config.
 *
 * Two of these have caught real bugs before and are here so they cannot come
 * back: the teamless competitor comparison (two records with no teamId compared
 * `null === null` and every unteamed competitor became readable by every other
 * one), and the set of fields a judge is allowed to write about themselves.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set, update } from "firebase/database";
import { makeTestEnv, seed, baseWorld, assignment, finalAssignment } from "./helpers.mjs";

let testEnv;

beforeAll(async () => {
  testEnv = await makeTestEnv();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
  await seed(testEnv, baseWorld());
});

const db = (uid) => (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).database();

describe("admin membership", () => {
  test("you may check whether you yourself are an admin", async () => {
    // the app probes this on every login; without it every non-admin sign-in
    // logs a permission error
    await assertSucceeds(get(ref(db("alice"), "admins/alice")));
  });

  test("but not whether anyone else is", async () => {
    await assertFails(get(ref(db("alice"), "admins/admin")));
  });

  test("nor list them", async () => {
    await assertFails(get(ref(db("alice"), "admins")));
  });

  test("and you cannot make yourself one", async () => {
    await assertFails(set(ref(db("alice"), "admins/alice"), true));
  });

  test("signed out sees nothing", async () => {
    await assertFails(get(ref(db(null), "admins/alice")));
  });
});

describe("config", () => {
  test("any signed-in user may read it", async () => {
    await assertSucceeds(get(ref(db("alice"), "config")));
  });

  test("signed out may not", async () => {
    await assertFails(get(ref(db(null), "config")));
  });

  test("only an admin may change the room list", async () => {
    await assertFails(set(ref(db("alice"), "config/judgingRooms"), ["Anywhere"]));
    await assertSucceeds(set(ref(db("admin"), "config/judgingRooms"), ["Rice 110"]));
  });
});

describe("competitors", () => {
  test("you can read yourself", async () => {
    await assertSucceeds(get(ref(db("alice"), "competitors/alice")));
  });

  test("and a teammate", async () => {
    await assertSucceeds(get(ref(db("alice"), "competitors/bob")));
  });

  test("but not someone on another team", async () => {
    await assertFails(get(ref(db("alice"), "competitors/carol")));
  });

  test("two teamless competitors cannot read each other", async () => {
    // the null === null regression. Without the guard on the reader having a
    // team at all, every unteamed competitor is readable by every other one.
    const world = baseWorld();
    world.competitors.erin = { firstName: "Erin", checkedIn: false, foodCheckIn: false };
    await testEnv.clearDatabase();
    await seed(testEnv, world);

    await assertFails(get(ref(db("dave"), "competitors/erin")));
    await assertFails(get(ref(db("erin"), "competitors/dave")));
  });

  test("claiming a team does not open its records to you", async () => {
    // teamId is a field you write about yourself -- the write rule pins only
    // checkedIn and foodCheckIn -- so if the read gate compares nothing but
    // teamId, membership is a claim rather than a fact. dave is on no team;
    // he types one team's id into his own record and every competitor on it
    // becomes readable, resume and email and all. Membership is settled by
    // teams/{id}/members, which only the person themselves or an admin can
    // add to, so that is what the gate has to ask.
    await assertSucceeds(update(ref(db("dave"), "competitors/dave"), { teamId: "team1" }));

    await assertFails(get(ref(db("dave"), "competitors/alice")));
    await assertFails(get(ref(db("dave"), "competitors/bob")));
  });

  test("and being claimed by a stranger does not put them in your team's view", async () => {
    // the same gap in the other direction: dave asserts team1 about himself,
    // so a real member comparing teamIds would find a match and read a record
    // belonging to someone who never joined.
    await assertSucceeds(update(ref(db("dave"), "competitors/dave"), { teamId: "team1" }));

    await assertFails(get(ref(db("alice"), "competitors/dave")));
  });

  test("nobody may enumerate the list", async () => {
    await assertFails(get(ref(db("alice"), "competitors")));
    await assertFails(get(ref(db("judge1"), "competitors")));
  });

  test("an admin may", async () => {
    await assertSucceeds(get(ref(db("admin"), "competitors")));
  });

  test("you cannot write someone else's record", async () => {
    await assertFails(set(ref(db("alice"), "competitors/bob/firstName"), "Robert"));
  });

  test("you can edit your own", async () => {
    await assertSucceeds(update(ref(db("alice"), "competitors/alice"), { firstName: "Alicia" }));
  });

  test("you cannot check yourself in", async () => {
    await assertFails(update(ref(db("alice"), "competitors/alice"), { checkedIn: true }));
  });

  test("nor check yourself in for food", async () => {
    await assertFails(update(ref(db("alice"), "competitors/alice"), { foodCheckIn: true }));
  });

  test("nor register already checked in", async () => {
    await assertFails(
      set(ref(db("erin"), "competitors/erin"), {
        firstName: "Erin",
        checkedIn: true,
        foodCheckIn: false,
      })
    );
  });

  test("registering with check-in false is fine", async () => {
    await assertSucceeds(
      set(ref(db("erin"), "competitors/erin"), {
        firstName: "Erin",
        checkedIn: false,
        foodCheckIn: false,
      })
    );
  });

  test("an admin can check someone in", async () => {
    await assertSucceeds(update(ref(db("admin"), "competitors/alice"), { checkedIn: true }));
  });
});

describe("judges", () => {
  test("you read your own record and nobody else's", async () => {
    await assertSucceeds(get(ref(db("judge1"), "judges/judge1")));
    await assertFails(get(ref(db("judge1"), "judges/judge2")));
    await assertFails(get(ref(db("judge1"), "judges")));
  });

  test("a competitor cannot read a judge", async () => {
    await assertFails(get(ref(db("alice"), "judges/judge1")));
  });

  test.each([
    ["isRound1Judge", { isRound1Judge: true }],
    ["teamAssignments", { teamAssignments: { team1: assignment("team1") } }],
    ["finalAssignments", { finalAssignments: { team1: finalAssignment("team1") } }],
  ])("a judge cannot seed %s at registration", async (_label, extra) => {
    // finalAssignments is the load-bearing one: the /scores rule treats an
    // entry there as proof of assignment, so seeding it would let a judge file
    // a final-round score for any team in the event
    await assertFails(
      set(ref(db("judge3"), "judges/judge3"), {
        firstName: "New",
        email: "new@example.com",
        checkedIn: false,
        foodCheckIn: false,
        ...extra,
      })
    );
  });

  test("a plain registration succeeds", async () => {
    await assertSucceeds(
      set(ref(db("judge3"), "judges/judge3"), {
        firstName: "New",
        email: "new@example.com",
        checkedIn: false,
        foodCheckIn: false,
      })
    );
  });

  test("a judge cannot check themselves in at registration", async () => {
    await assertFails(
      set(ref(db("judge3"), "judges/judge3"), {
        firstName: "New",
        checkedIn: true,
        foodCheckIn: false,
      })
    );
  });

  test("a judge cannot rewrite their record after creating it", async () => {
    // the write is gated on !data.exists(); this documents the consequence
    await assertFails(update(ref(db("judge1"), "judges/judge1"), { firstName: "Adalovelace" }));
  });

  test("a judge cannot promote themselves into round one afterwards", async () => {
    await assertFails(set(ref(db("judge2"), "judges/judge2/isRound1Judge"), true));
  });

  test("an admin can flag a round one judge", async () => {
    await assertSucceeds(set(ref(db("admin"), "judges/judge2/isRound1Judge"), true));
  });

  test("an admin can check a judge in", async () => {
    await assertSucceeds(set(ref(db("admin"), "judges/judge2/checkedIn"), true));
  });
});

describe("signed out", () => {
  test.each([
    "admins",
    "config",
    "judges/judge1",
    "competitors/alice",
    "teams/team1",
    "teams/team1/name",
    "scores/first/team1/judge1",
    "finalRound/active",
  ])("is denied %s", async (path) => {
    await assertFails(get(ref(db(null), path)));
  });

  test("and cannot write anywhere", async () => {
    await assertFails(set(ref(db(null), "competitors/anon"), { firstName: "Anon" }));
    await assertFails(set(ref(db(null), "config/judgingRooms"), ["Anywhere"]));
  });
});

describe("an admin", () => {
  test("reads and writes the root", async () => {
    await assertSucceeds(get(ref(db("admin"), "/")));
    await assertSucceeds(set(ref(db("admin"), "config/eventStart"), "2026-03-01T09:00:00Z"));
  });
});

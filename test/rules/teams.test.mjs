/**
 * /teams.
 *
 * The block that matters most here is the last one: a judge is granted read on
 * `teams/$teamId/submission` and on nothing else. A read granted at a child
 * never confers the parent, and this proves it rather than asserting it —
 * because if it did cascade upward, the grant would hand judges the team's
 * members and schedule too.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
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

describe("reading a team", () => {
  test("a member can", async () => {
    await assertSucceeds(get(ref(db("alice"), "teams/team1")));
  });

  test("the creator can", async () => {
    await assertSucceeds(get(ref(db("alice"), "teams/team1")));
  });

  test("someone on another team cannot", async () => {
    await assertFails(get(ref(db("carol"), "teams/team1")));
  });

  test("nobody may list every team", async () => {
    await assertFails(get(ref(db("alice"), "teams")));
    await assertFails(get(ref(db("judge1"), "teams")));
  });

  test("an admin may", async () => {
    await assertSucceeds(get(ref(db("admin"), "teams")));
  });

  test("any signed-in user may read a team's name, to confirm an id before joining", async () => {
    await assertSucceeds(get(ref(db("carol"), "teams/team1/name")));
  });
});

describe("creating a team", () => {
  const newTeam = (extra = {}) => ({
    name: "Gamma",
    createdBy: "dave",
    members: { dave: true },
    ...extra,
  });

  test("a competitor can create one with themselves as creator and member", async () => {
    await assertSucceeds(set(ref(db("dave"), "teams/team3"), newTeam()));
  });

  test("but not one created by somebody else", async () => {
    await assertFails(set(ref(db("dave"), "teams/team3"), newTeam({ createdBy: "alice" })));
  });

  test("nor one they are not a member of", async () => {
    await assertFails(set(ref(db("dave"), "teams/team3"), newTeam({ members: { alice: true } })));
  });

  /**
   * The create rule only ever checked that the creator was AMONG the members,
   * never that they were the ONLY thing being seeded there. A team's .write
   * grant covers its whole subtree, so a create that also plants someone else
   * under members/ never touches the per-member rule at
   * teams/$teamId/members/$memberUid at all -- that rule is only consulted for
   * a write that targets that path directly. Without a members-level
   * .validate, this silently enrolled carol on a team she never asked to join,
   * handing her team's-eye read access to whoever created it.
   */
  test("but not seeding a member who never agreed to join", async () => {
    await assertFails(
      set(ref(db("dave"), "teams/team3"), newTeam({ members: { dave: true, carol: true } }))
    );
  });

  test("a judge who is not a competitor cannot create a team", async () => {
    await assertFails(
      set(ref(db("judge1"), "teams/team3"), {
        name: "Gamma",
        createdBy: "judge1",
        members: { judge1: true },
      })
    );
  });

  test("cannot seed a schedule", async () => {
    await assertFails(
      set(ref(db("dave"), "teams/team3"), newTeam({ schedule: assignment("team3") }))
    );
  });

  test("cannot seed a finalist slot", async () => {
    await assertFails(
      set(ref(db("dave"), "teams/team3"), newTeam({ finalSlot: { room: "R", timeslot: "S" } }))
    );
  });

  test("cannot overwrite an existing team", async () => {
    await assertFails(set(ref(db("dave"), "teams/team1"), newTeam()));
  });
});

describe("membership", () => {
  // both teams in baseWorld have submitted, so a team that is still open has
  // to be seeded for the joining tests
  beforeEach(async () => {
    const world = baseWorld();
    world.teams.team3 = { name: "Gamma", createdBy: "carol", submitted: false, members: { carol: true } };
    await testEnv.clearDatabase();
    await seed(testEnv, world);
  });

  test("you can add yourself to a team that is still open", async () => {
    await assertSucceeds(set(ref(db("dave"), "teams/team3/members/dave"), true));
  });

  test("and remove yourself", async () => {
    await assertSucceeds(set(ref(db("bob"), "teams/team1/members/bob"), null));
  });

  test("but not add anyone else", async () => {
    await assertFails(set(ref(db("alice"), "teams/team3/members/dave"), true));
  });

  test("and not remove anyone else", async () => {
    await assertFails(set(ref(db("alice"), "teams/team1/members/bob"), null));
  });

  /**
   * A team that has submitted is closed. Someone joining after the deck is in
   * did not work on it, and the first-round schedule is built from submitted
   * teams -- so a late joiner lands on a team that is already scheduled and
   * already being judged.
   */
  test("you cannot join a team that has already submitted", async () => {
    await assertFails(set(ref(db("dave"), "teams/team1/members/dave"), true));
  });

  test("but you can still leave one, so nobody is trapped", async () => {
    await assertSucceeds(set(ref(db("alice"), "teams/team1/members/alice"), null));
  });

  test("an organizer can still add someone to a submitted team", async () => {
    // the root admin rule reaches here, which is what makes the closed rule
    // safe to enforce: there is always a way to fix a real case by hand
    await assertSucceeds(set(ref(db("admin"), "teams/team1/members/dave"), true));
  });
});

/**
 * What somebody joining a team can actually read.
 *
 * The answer is: the name, and nothing else. `joinTeam` used to read
 * `submitted` and `members` up front as well, and both are denied to exactly
 * the person doing the joining -- so the whole read rejected, the catch fired,
 * and every join in the app returned "Could not join that team. Please try
 * again." forever.
 *
 * These tests pin the denial rather than wish it away. The client must not
 * depend on either read; the write rule is where the policy lives, and it is
 * asserted above.
 */
describe("what somebody joining a team can read", () => {
  test("the name, to confirm the id they were given", async () => {
    await assertSucceeds(get(ref(db("dave"), "teams/team1/name")));
  });

  test("not whether it has submitted -- the write rule decides that", async () => {
    await assertFails(get(ref(db("dave"), "teams/team1/submitted")));
  });

  test("not the member list, so the size cap cannot be checked in advance", async () => {
    await assertFails(get(ref(db("dave"), "teams/team1/members")));
  });

  test("and not the submission or the schedule", async () => {
    await assertFails(get(ref(db("dave"), "teams/team1/submission")));
    await assertFails(get(ref(db("dave"), "teams/team1/schedule")));
  });

  test("a member can read all of it, which is why the reads looked fine", async () => {
    await assertSucceeds(get(ref(db("alice"), "teams/team1/submitted")));
    await assertSucceeds(get(ref(db("alice"), "teams/team1/members")));
  });
});

describe("the submission", () => {
  test("a member can write it", async () => {
    await assertSucceeds(
      set(ref(db("alice"), "teams/team1/submission"), { ideaName: "Revised" })
    );
  });

  test("a non-member cannot", async () => {
    await assertFails(
      set(ref(db("carol"), "teams/team1/submission"), { ideaName: "Sabotage" })
    );
  });

  test("a member can mark the team submitted", async () => {
    await assertSucceeds(set(ref(db("alice"), "teams/team1/submitted"), true));
  });

  test("a member cannot touch the schedule", async () => {
    await assertFails(set(ref(db("alice"), "teams/team1/schedule"), assignment("team1")));
  });
});

describe("a judge reads the submissions they are assigned", () => {
  test("an assigned judge can read the submission", async () => {
    await assertSucceeds(get(ref(db("judge1"), "teams/team1/submission")));
  });

  test("and its pitch deck link", async () => {
    await assertSucceeds(get(ref(db("judge1"), "teams/team1/submission/pitchDeckURL")));
  });

  test("an unassigned judge cannot", async () => {
    await assertFails(get(ref(db("judge2"), "teams/team1/submission")));
  });

  test("nor a judge assigned to a different team", async () => {
    await assertFails(get(ref(db("judge1"), "teams/team2/submission")));
  });

  test("a final-round assignment grants it too", async () => {
    const world = baseWorld();
    world.judges.judge2.finalAssignments = { team1: finalAssignment("team1") };
    await testEnv.clearDatabase();
    await seed(testEnv, world);

    await assertSucceeds(get(ref(db("judge2"), "teams/team1/submission")));
  });

  test("a competitor is not accidentally granted anything by that rule", async () => {
    await assertFails(get(ref(db("carol"), "teams/team1/submission")));
  });

  test("an assigned judge still cannot write the submission", async () => {
    await assertFails(set(ref(db("judge1"), "teams/team1/submission/ideaName"), "Mine now"));
  });
});

/**
 * Whether .validate runs on a delete, checked empirically rather than assumed,
 * because the members/$memberUid fix below relies on it: leaveTeam() nulls a
 * member entry it does not otherwise have standing to "revalidate", and if
 * .validate ran on deletes the same way it does on writes, a delete that
 * cannot satisfy it would be rejected.
 *
 * finalSlot already carries a `.validate` requiring hasChildren(['room',
 * 'timeslot']) -- newData is empty on a delete, so if validate ran on
 * deletes this delete would fail that check. It does not fail, which is the
 * proof: RTDB skips .validate entirely when the write removes data.
 */
describe(".validate does not run on deletions (empirical)", () => {
  test("deleting an existing finalSlot succeeds despite its own hasChildren validate", async () => {
    const world = baseWorld();
    world.teams.team1.finalSlot = { room: "Rice 110", timeslot: "Slot 1" };
    await testEnv.clearDatabase();
    await seed(testEnv, world);

    await assertSucceeds(set(ref(db("admin"), "teams/team1/finalSlot"), null));
  });
});

describe("the submission grant does not cascade upward", () => {
  // The proof that granting read on one child is safe. If it conferred the
  // parent, judge1 would hold the team's members, its schedule and its slot.
  test.each([
    ["the team node", "teams/team1"],
    ["its members", "teams/team1/members"],
    ["its schedule", "teams/team1/schedule"],
    ["its finalist slot", "teams/team1/finalSlot"],
    ["whether it submitted", "teams/team1/submitted"],
  ])("an assigned judge is still denied %s", async (_label, path) => {
    await assertFails(get(ref(db("judge1"), path)));
  });
});

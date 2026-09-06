/**
 * /scores — the node this whole restructure exists for.
 *
 * Scores used to live under teams/{id}/scores. Realtime Database rules cascade
 * and cannot be revoked deeper, so the read a team member holds on their own
 * team granted everything beneath it: every judge's numbers and their free-text
 * notes. The first block below is the regression test for that, checked at all
 * four levels of the path because a cascade bug shows up at exactly one of them.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
import { makeTestEnv, seed, baseWorld, scoreCard, finalAssignment } from "./helpers.mjs";

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

describe("a competitor cannot reach a score", () => {
  test.each([
    ["the whole node", "scores"],
    ["a round", "scores/first"],
    ["their own team's cards", "scores/first/team1"],
    ["one judge's card for their own team", "scores/first/team1/judge1"],
  ])("alice is denied %s", async (_label, path) => {
    await assertFails(get(ref(db("alice"), path)));
  });

  test("nor can a competitor from another team", async () => {
    await assertFails(get(ref(db("carol"), "scores/first/team1/judge1")));
  });

  test("nor can someone signed out", async () => {
    await assertFails(get(ref(db(null), "scores/first/team1/judge1")));
  });
});

describe("a judge and their own card", () => {
  test("reads it back", async () => {
    await assertSucceeds(get(ref(db("judge1"), "scores/first/team1/judge1")));
  });

  test("writes it for a team they are assigned to", async () => {
    await assertSucceeds(
      set(
        ref(db("judge1"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1" })
      )
    );
  });

  test("cannot write for a team they are not assigned to", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team2/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team2" })
      )
    );
  });

  test("an unassigned judge cannot write at all", async () => {
    await assertFails(
      set(
        ref(db("judge2"), "scores/first/team1/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team1" })
      )
    );
  });

  test("cannot write under another judge's uid", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team1/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team1", enteredBy: "judge1" })
      )
    );
  });

  test("cannot read another judge's card for the same team", async () => {
    await assertFails(get(ref(db("judge2"), "scores/first/team1/judge1")));
  });

  test("cannot delete a card they have filed", async () => {
    // revising is fine; making one disappear is not
    await assertFails(set(ref(db("judge1"), "scores/first/team1/judge1"), null));
  });

  test("can revise one", async () => {
    await assertSucceeds(
      set(
        ref(db("judge1"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1", problem: 3 })
      )
    );
  });
});

describe("an assignment stored as an array locks the judge out", () => {
  // hasChild() matches a key, and an array is stored under numeric keys, so a
  // legacy array-shaped teamAssignments makes the check silently false. This
  // pins the hazard so CI finds it rather than the event.
  test("a judge holding a legacy array cannot score", async () => {
    const world = baseWorld();
    world.judges.judge1.teamAssignments = [{ teamName: "Team", id: "team1", batch: 1 }];
    await testEnv.clearDatabase();
    await seed(testEnv, world);

    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1" })
      )
    );
  });
});

describe("the admin paper fallback", () => {
  // This is the write the old rules made impossible. The root rule permitted an
  // admin to write here, and then `judgeUid: newData.val() === auth.uid`
  // rejected it — with a bare PERMISSION_DENIED and nothing to indicate why.
  test("an admin can file a card on a judge's behalf", async () => {
    await assertSucceeds(
      set(
        ref(db("admin"), "scores/first/team1/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team1", enteredBy: "admin" })
      )
    );
  });

  test("even for a team that judge was never assigned to", async () => {
    await assertSucceeds(
      set(
        ref(db("admin"), "scores/first/team2/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team2", enteredBy: "admin" })
      )
    );
  });

  test("and may name the original author, which is what makes a restore possible", async () => {
    // enteredBy is pinned to auth.uid for everyone except an admin. It used to
    // be pinned absolutely, which meant a restore point holding judges' cards
    // could never be written back -- and since the restore is one atomic
    // update, that failure silently took the schedule restore with it.
    await assertSucceeds(
      set(
        ref(db("admin"), "scores/first/team1/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team1", enteredBy: "judge1" })
      )
    );
  });

  test("a judge cannot forge enteredBy either", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1", enteredBy: "admin" })
      )
    );
  });

  test("an admin can clear a card", async () => {
    await assertSucceeds(set(ref(db("admin"), "scores/first/team1/judge1"), null));
  });

  test("an admin can read everything", async () => {
    await assertSucceeds(get(ref(db("admin"), "scores")));
  });
});

describe("validation", () => {
  const write = (overrides) =>
    set(
      ref(db("judge1"), "scores/first/team1/judge1"),
      scoreCard({ judgeUid: "judge1", teamId: "team1", ...overrides })
    );

  test.each([
    ["problem above its maximum", { problem: 11 }],
    ["problem below one", { problem: 0 }],
    ["viability above its maximum", { viability: 6 }],
    ["pitch_quality below one", { pitch_quality: 0 }],
    ["a criterion that is not a number", { impact: "eight" }],
    ["fundable that is not a boolean", { fundable: "yes" }],
    ["a submittedAt in the future", { submittedAt: Date.now() + 600000 }],
    ["an unknown field", { favourite: true }],
    ["a source that is not one of the three", { source: "guessed" }],
  ])("rejects %s", async (_label, overrides) => {
    await assertFails(write(overrides));
  });

  test("rejects notes over the 2000 character cap", async () => {
    await assertFails(write({ notes: "x".repeat(2001) }));
  });

  test("accepts notes exactly at the cap", async () => {
    await assertSucceeds(write({ notes: "x".repeat(2000) }));
  });

  test.each(["fundable", "problem", "judgeUid", "teamId", "enteredBy", "submittedAt"])(
    "rejects a card missing %s",
    async (field) => {
      const card = scoreCard({ judgeUid: "judge1", teamId: "team1" });
      delete card[field];
      await assertFails(set(ref(db("judge1"), "scores/first/team1/judge1"), card));
    }
  );

  test("rejects a teamId that disagrees with the path", async () => {
    await assertFails(write({ teamId: "team2" }));
  });

  test("rejects a judgeUid that disagrees with the key", async () => {
    await assertFails(write({ judgeUid: "judge2" }));
  });
});

describe("the final round", () => {
  test("a first-round assignment does not grant a final-round write", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/final/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1" })
      )
    );
  });

  test("a finalAssignments entry does", async () => {
    const world = baseWorld();
    world.judges.judge1.finalAssignments = { team1: finalAssignment("team1") };
    await testEnv.clearDatabase();
    await seed(testEnv, world);

    await assertSucceeds(
      set(
        ref(db("judge1"), "scores/final/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1" })
      )
    );
  });

  test("a round that is neither first nor final is rejected", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/bonus/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1" })
      )
    );
  });
});

describe("an admin can wipe scores to start over", () => {
  /**
   * The danger zone offers a full reset, so this has to be true. It relies on
   * two things that are easy to assume rather than check: the root admin grant
   * reaches /scores even though nothing below it grants a read or a write, and
   * a delete skips .validate -- so the score card shape, which would reject a
   * null, never gets a say.
   */
  test("an admin deletes a single card", async () => {
    await assertSucceeds(set(ref(db("admin"), "scores/first/team1/judge1"), null));
  });

  test("an admin deletes a whole team's cards", async () => {
    await assertSucceeds(set(ref(db("admin"), "scores/first/team1"), null));
  });

  test("an admin deletes every score in the event", async () => {
    await assertSucceeds(set(ref(db("admin"), "scores"), null));
  });

  test("an admin clears the pre-migration copy on the team node too", async () => {
    // a database old enough to predate the migration still holds cards here,
    // and a reset that could not reach them would not be a reset
    await assertSucceeds(set(ref(db("admin"), "teams/team1/scores"), null));
    await assertSucceeds(set(ref(db("admin"), "teams/team1/finalScores"), null));
  });

  test("a judge still cannot delete their own card", async () => {
    // newData.exists() in the write rule: a judge may revise a score, never
    // withdraw one. Only an admin can remove it.
    await assertFails(set(ref(db("judge1"), "scores/first/team1/judge1"), null));
  });

  test("a competitor cannot delete anything", async () => {
    await assertFails(set(ref(db("alice"), "scores/first/team1/judge1"), null));
    await assertFails(set(ref(db("alice"), "scores"), null));
  });
});

describe("an organizer can put back a card they did not write", () => {
  /**
   * enteredBy is pinned to auth.uid for everyone except an admin. Without the
   * exemption a restore point containing judges' cards could not be written
   * back at all -- and because a multi-path update is atomic, the failure took
   * the schedule restore down with it, silently.
   *
   * The guarantee that exemption must not weaken: a judge still cannot file
   * under another judge.
   */
  test("an admin restores a judge's card with its original author intact", async () => {
    await assertSucceeds(
      set(
        ref(db("admin"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1", enteredBy: "judge1", source: "judge" })
      )
    );
  });

  test("a judge still cannot file under another judge", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team1/judge2"),
        scoreCard({ judgeUid: "judge2", teamId: "team1", enteredBy: "judge2" })
      )
    );
  });

  test("a judge cannot forge enteredBy on their own card either", async () => {
    await assertFails(
      set(
        ref(db("judge1"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1", enteredBy: "judge2" })
      )
    );
  });

  test("a competitor cannot write a card at all", async () => {
    await assertFails(
      set(
        ref(db("alice"), "scores/first/team1/judge1"),
        scoreCard({ judgeUid: "judge1", teamId: "team1", enteredBy: "judge1" })
      )
    );
  });

  test("the whole scores tree can be written back in one update", async () => {
    // this is the shape restoreSnapshot actually writes
    await assertSucceeds(
      set(ref(db("admin"), "scores"), {
        first: {
          team1: {
            judge1: scoreCard({ judgeUid: "judge1", teamId: "team1", enteredBy: "judge1" }),
            judge2: scoreCard({ judgeUid: "judge2", teamId: "team1", enteredBy: "judge2" }),
          },
        },
      })
    );
  });
});

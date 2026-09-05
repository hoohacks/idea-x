/**
 * Guards the database shapes that live in more than one place.
 *
 * The scoring ranges exist three times over — the selects in ScoreSubmission,
 * SCORE_FIELDS in finalRoundService, and the .validate rules in
 * database.rules.json. If they drift, a judge submits a score the rules reject,
 * or the aggregate quietly weights a criterion wrong. These tests fail on drift
 * rather than waiting for the event to find it.
 *
 * These are string assertions over the rules file. They catch a deleted clause,
 * not a wrong one — for that see test/rules/, which executes the rules against
 * the emulator. This file is the half that runs in CI without a JVM.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assignmentList } from "./user/judge/assignmentList";
import { memberIds, isMember } from "./user/team/teamMembers";
import { MAX_TEAM_SIZE } from "./user/team/teamMembership";

const RULES_PATH = path.join(process.cwd(), "database.rules.json");
const RAW_RULES = fs.readFileSync(RULES_PATH, "utf8");

const RULES = (() => {
  // the console strips // comments; JSON.parse will not.
  //
  // No `$` on that pattern, deliberately. On a Windows checkout with
  // core.autocrlf the lines still end in \r, and `.` never matches \r while an
  // unanchored `$` only matches at end of input -- so with a `$` here every
  // comment line survived stripping and JSON.parse died on line 2. Leaving the
  // \r behind is harmless; JSON treats it as whitespace.
  const stripped = RAW_RULES.split("\n")
    .map((line) => line.replace(/^\s*\/\/.*/, ""))
    .join("\n");
  return JSON.parse(stripped);
})();

const scoreRules = RULES.rules.scores.$round.$teamId.$judgeUid;

// what ScoreSubmission actually sends, and what finalRoundService scores
const EXPECTED_RANGES = {
  problem: 10,
  innovation: 10,
  impact: 10,
  viability: 5,
  pitch_quality: 5,
};

describe("score rules match the code", () => {
  test.each(Object.entries(EXPECTED_RANGES))(
    "%s is validated against its real maximum of %i",
    (field, max) => {
      const rule = scoreRules[field][".validate"];
      expect(rule).toContain("newData.isNumber()");
      expect(rule).toContain("newData.val() >= 1");
      expect(rule).toContain(`newData.val() <= ${max}`);
    }
  );

  test("SCORE_FIELDS agrees with the validated ranges", () => {
    // required lazily so the firebase import chain is not pulled in at module load
    const { SCORE_FIELDS, SCORE_MAX_TOTAL } = jest.requireActual(
      "./user/judge/scoreRubric"
    );
    expect(SCORE_FIELDS).toEqual(EXPECTED_RANGES);
    expect(SCORE_MAX_TOTAL).toBe(40);
  });

  test("the rubric the judge sees is the rubric that is scored", () => {
    // one definition, so the dialog cannot offer a criterion the aggregate
    // ignores, or a range the rules reject
    const { RUBRIC, SCORE_FIELDS } = jest.requireActual("./user/judge/scoreRubric");
    const fromRubric = Object.fromEntries(
      Object.entries(RUBRIC).map(([field, spec]) => [field, spec.range])
    );
    expect(fromRubric).toEqual(SCORE_FIELDS);
  });

  test("every field the app writes is allowed by the rules", () => {
    // ScoreSubmission's score object plus what writeScoreToPath adds
    const written = [
      "problem", "innovation", "impact", "viability", "pitch_quality",
      "fundable", "notes", "teamName", "room", "time",
      "judgeUid", "teamId", "enteredBy", "source", "submittedAt",
    ];
    for (const field of written) {
      expect(scoreRules[field]).toBeDefined();
    }
    // anything not enumerated is rejected
    expect(scoreRules.$other[".validate"]).toBe(false);
  });

  test("a judge cannot file a score under another judge", () => {
    expect(scoreRules[".write"]).toContain("auth.uid === $judgeUid");
    // the card is keyed to the judge it belongs to; who pressed the button is
    // recorded separately and is the field pinned to auth.uid. Pinning judgeUid
    // to auth.uid is what used to make admin paper entry impossible.
    expect(scoreRules.judgeUid[".validate"]).toContain("$judgeUid");
    expect(scoreRules.enteredBy[".validate"]).toContain("auth.uid");
  });

  test("a score can only be filed for a team you are assigned to", () => {
    expect(scoreRules[".write"]).toContain("teamAssignments').hasChild($teamId)");
    expect(scoreRules[".write"]).toContain("finalAssignments').hasChild($teamId)");
  });

  test("a judge cannot delete a score they have filed", () => {
    expect(scoreRules[".write"]).toContain("newData.exists()");
  });
});

describe("scores are not reachable through the team node", () => {
  // The reason /scores exists at all. Rules cascade and cannot be revoked, so a
  // team member's read on teams/$teamId would grant everything beneath it —
  // including the judges' free-text notes.
  test("no score node has come back under /teams", () => {
    expect(RULES.rules.teams.$teamId.scores).toBeUndefined();
    expect(RULES.rules.teams.$teamId.finalScores).toBeUndefined();
  });

  test("nothing grants a blanket read above a score", () => {
    expect(RULES.rules.scores[".read"]).toBeUndefined();
    expect(RULES.rules.scores.$round[".read"]).toBeUndefined();
    expect(RULES.rules.scores.$round.$teamId[".read"]).toBeUndefined();
  });
});

describe("the final round standings stay private", () => {
  test("/finalRound has no blanket read", () => {
    // a .read here cascades into finalRound/teams and hands every signed-in
    // user the top four with their average scores, before they are announced
    expect(RULES.rules.finalRound[".read"]).toBeUndefined();
    expect(RULES.rules.finalRound.teams).toBeUndefined();
  });

  test("only the two scalars the app needs are readable", () => {
    expect(RULES.rules.finalRound.active[".read"]).toBe("auth != null");
    expect(RULES.rules.finalRound.activatedAt[".read"]).toBe("auth != null");
  });

  test("a finalist slot cannot carry a score", () => {
    // finalSlot is readable by team members, so $other: false is what makes it
    // structurally impossible for averageScore to be copied into it later
    expect(RULES.rules.teams.$teamId.finalSlot.$other[".validate"]).toBe(false);
  });
});

describe("a judge cannot grant themselves an assignment", () => {
  // The /scores write rule treats an entry in either assignment node as proof
  // of assignment, so seeding one at registration is a privilege escalation.
  const judgeWrite = RULES.rules.judges.$uid[".write"];

  test.each(["isRound1Judge", "teamAssignments", "finalAssignments"])(
    "%s is excluded from the judge's own write",
    (field) => {
      expect(judgeWrite).toContain(`!newData.hasChild('${field}')`);
    }
  );

  test("a competitor cannot seed a schedule or a finalist slot", () => {
    const teamWrite = RULES.rules.teams.$teamId[".write"];
    expect(teamWrite).toContain("!newData.hasChild('schedule')");
    expect(teamWrite).toContain("!newData.hasChild('finalSlot')");
  });
});

describe("a judge can read the submissions they are assigned", () => {
  test("read is granted on submission, not on the team", () => {
    const submissionRead = RULES.rules.teams.$teamId.submission[".read"];
    expect(submissionRead).toContain("teamAssignments').hasChild($teamId)");
    expect(submissionRead).toContain("finalAssignments').hasChild($teamId)");

    // a read granted at a child never confers the parent, so the team node,
    // its members and its schedule stay closed to a judge
    expect(RULES.rules.teams.$teamId[".read"]).not.toContain("judges");
  });
});

describe("the deployed rules cannot drift from these ones unnoticed", () => {
  /**
   * Nothing in this project deploys the rules — they are pasted into the
   * Firebase console by hand. So the one failure this cannot catch is the rules
   * file changing in git and never being republished. This test makes that
   * change loud: edit the rules and it fails until you bump the version and
   * paste the new digest, which is the moment you are reminded to republish.
   *
   * When it fails: republish database.rules.json in the console, bump
   * `// rulesVersion:` at the top of that file, and put the printed digest here.
   */
  const EXPECTED_VERSION = 7;
  const EXPECTED_DIGEST = "4220aa274ad62df857088d83029400c09e782dc892a8a28d47da1968d7db5666";

  // sorted so a pure reordering of the file is not treated as a rules change
  function sortDeep(value) {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])
    );
  }

  test("the version marker matches the rules", () => {
    const declared = RAW_RULES.match(/\/\/\s*rulesVersion:\s*(\d+)/);
    expect(declared).not.toBeNull();
    expect(Number(declared[1])).toBe(EXPECTED_VERSION);

    const digest = crypto
      .createHash("sha256")
      .update(JSON.stringify(sortDeep(RULES.rules)))
      .digest("hex");

    if (digest !== EXPECTED_DIGEST) {
      throw new Error(
        `database.rules.json changed.\n\n` +
          `  1. Republish it in the Firebase console (Realtime Database -> Rules).\n` +
          `  2. Bump "// rulesVersion:" to ${EXPECTED_VERSION + 1} in that file.\n` +
          `  3. Set EXPECTED_VERSION = ${EXPECTED_VERSION + 1} and\n` +
          `     EXPECTED_DIGEST = "${digest}" in src/schema.test.js\n`
      );
    }
  });
});

describe("membership is a keyed set, not an array", () => {
  test("the rules test membership by child key", () => {
    expect(RULES.rules.teams.$teamId[".read"]).toContain("data.child('members').hasChild(auth.uid)");
  });

  test("reads the keyed shape", () => {
    expect(memberIds({ a: true, b: true })).toEqual(["a", "b"]);
    expect(isMember({ a: true }, "a")).toBe(true);
    expect(isMember({ a: true }, "b")).toBe(false);
  });

  test("still reads teams stored before the change", () => {
    expect(memberIds(["a", "b"])).toEqual(["a", "b"]);
  });

  test("ignores removed members and empty values", () => {
    expect(memberIds({ a: true, b: null, c: false })).toEqual(["a"]);
    expect(memberIds(null)).toEqual([]);
    expect(memberIds(undefined)).toEqual([]);
  });
});

describe("judge assignments survive the keyed shape", () => {
  const batch3 = { teamName: "C", batch: 3, room: "R3", time: "5:30 PM" };
  const batch1 = { teamName: "A", batch: 1, room: "R1", time: "5:00 PM" };
  const batch2 = { teamName: "B", batch: 2, room: "R2", time: "5:15 PM" };

  test("object key order does not decide the running order", () => {
    // keys come back lexicographically, which is not batch order
    const stored = { tC: batch3, tA: batch1, tB: batch2 };
    expect(assignmentList(stored).map((a) => a.teamName)).toEqual(["A", "B", "C"]);
  });

  test("still reads schedules stored as an array", () => {
    expect(assignmentList([batch1, batch2, batch3]).map((a) => a.batch)).toEqual([1, 2, 3]);
  });

  test("drops the empty-string placeholder older schedules wrote", () => {
    expect(assignmentList([""])).toEqual([]);
    expect(assignmentList(null)).toEqual([]);
  });
});

describe("the audit log pins its author", () => {
  /**
   * The log is a forensics aid, not a ledger — an admin holds root write and
   * deletes skip .validate, so entries can be erased. These pin the two things
   * rules genuinely can enforce: who an entry is attributed to, and its shape.
   */
  test("by is compared to auth.uid, so entries cannot be forged", () => {
    expect(RULES.rules.adminLog.$entryId.by[".validate"]).toContain("auth.uid");
  });

  test("unknown keys are refused at both levels", () => {
    expect(RULES.rules.adminLog.$entryId.$other[".validate"]).toBe(false);
    expect(RULES.rules.adminLog.$entryId.changes.$i.$other[".validate"]).toBe(false);
  });

  test("before and after are strings, because RTDB drops a literal null", () => {
    const change = RULES.rules.adminLog.$entryId.changes.$i;
    expect(change.before[".validate"]).toContain("isString");
    expect(change.after[".validate"]).toContain("isString");
  });
});

describe("the schedule draft is admin-only", () => {
  test("/scheduleDraft has no rule of its own", () => {
    expect(RULES.rules.scheduleDraft).toBeUndefined();
  });

  test("/finalRoundDraft has no rule of its own either", () => {
    // an unpublished final round is who made the cut before it is announced;
    // any rule written here could only be equal or looser than the root one
    expect(RULES.rules.finalRoundDraft).toBeUndefined();
  });

  test("/archive has no rule of its own", () => {
    // it holds role records deleted by a role change, names and emails included
    expect(RULES.rules.archive).toBeUndefined();
  });

  test("the root rule is what covers it", () => {
    expect(RULES.rules[".read"]).toContain("admins");
    expect(RULES.rules[".write"]).toContain("admins");
  });
});

describe("a team cannot grow without bound, or reopen after submitting", () => {
  /**
   * Both limits are enforced in the rules, because a check that lives only in
   * teamMembership.js is a suggestion -- anyone can call set() from the console.
   * These assert the rule still says what the client believes.
   */
  const membersRule = RULES.rules.teams.$teamId.members.$memberUid[".write"];

  test("the size cap is client-side only, and says so", () => {
    // Realtime Database rules cannot count children -- numChildren() is a
    // client SDK method and a rule using it fails to LOAD, taking every other
    // rule with it. So MAX_TEAM_SIZE is advisory. This test exists to stop
    // anyone reintroducing it into the rules and shipping a file that will not
    // deploy.
    expect(membersRule).not.toMatch(/numChildren/);
    expect(MAX_TEAM_SIZE).toBeGreaterThan(0);
  });

  test("a submitted team is closed to new members", () => {
    expect(membersRule).toMatch(/child\('submitted'\)\.val\(\)\s*!==\s*true/);
  });

  test("leaving is always allowed, so nobody is trapped on a full team", () => {
    expect(membersRule).toMatch(/!newData\.exists\(\)/);
  });

  test("you still cannot add anyone but yourself", () => {
    expect(membersRule).toMatch(/\$memberUid === auth\.uid/);
  });
});

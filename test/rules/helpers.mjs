/**
 * Harness for the security rules suite.
 *
 * These tests EXECUTE database.rules.json against the Realtime Database
 * emulator. src/schema.test.js asserts the same file as strings, which catches
 * a deleted clause but not a wrong one — it cannot tell you that a competitor
 * really is denied, only that the rule mentioning them still exists. This is
 * the half that actually tries it.
 *
 * Needs a JVM: the RTDB emulator is a Java jar. `npm run test:rules` starts it
 * via `firebase emulators:exec`.
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

// `demo-` prefixed project ids are treated by the emulator as fully offline, so
// a misconfigured test can never touch the real project.
export const PROJECT_ID = "demo-ideathon";

function rulesSource() {
  const raw = readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8");
  // the console strips // comments and JSON.parse cannot; the emulator's parser
  // accepts them, but stripping keeps this identical to what src/schema.test.js
  // reads and removes one way for the two to disagree
  // no `$` on that pattern: see the matching note in src/schema.test.js -- on a
  // CRLF checkout an anchored `$` never matches, and every comment survives
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*/, ""))
    .join("\n");
}

export async function makeTestEnv() {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000").split(":");

  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules: rulesSource(), host, port: Number(port) },
  });
}

/** Write a fixture straight past the rules. */
export async function seed(testEnv, data) {
  const { ref, set } = await import("firebase/database");
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "/"), data);
  });
}

/** A complete, valid score card for the new /scores shape. */
export function scoreCard({ judgeUid, teamId, enteredBy = judgeUid, ...rest } = {}) {
  return {
    problem: 8,
    innovation: 7,
    impact: 9,
    viability: 4,
    pitch_quality: 4,
    fundable: true,
    notes: "solid",
    judgeUid,
    teamId,
    teamName: "Team",
    enteredBy,
    source: enteredBy === judgeUid ? "judge" : "paper",
    submittedAt: Date.now() - 1000,
    ...rest,
  };
}

/** One first-round assignment, in the keyed shape the rules require. */
export function assignment(teamId, batch = 1) {
  return {
    teamName: "Team",
    id: teamId,
    room: "Rice 110",
    time: "5:00 PM",
    batch,
    judges: [],
  };
}

export function finalAssignment(teamId) {
  return { teamId, teamName: "Team", room: "Rice 011", timeslot: "Slot 1" };
}

/**
 * The standard cast.
 *
 *   admin              an organizer
 *   judge1 / judge2    round-one judges; judge1 is assigned to team1
 *   alice / bob        competitors on team1
 *   carol              a competitor on team2
 *   dave               a competitor with no team at all
 */
export function baseWorld() {
  return {
    admins: { admin: true },
    config: { judgingRooms: ["Rice 110", "Rice 109"], submissionsOpen: true },

    judges: {
      judge1: {
        firstName: "Ada",
        lastName: "Judge",
        email: "ada@example.com",
        checkedIn: true,
        foodCheckIn: false,
        isRound1Judge: true,
        teamAssignments: { team1: assignment("team1") },
      },
      judge2: {
        firstName: "Bo",
        lastName: "Judge",
        email: "bo@example.com",
        checkedIn: false,
        foodCheckIn: false,
        isRound1Judge: true,
      },
    },

    competitors: {
      alice: { firstName: "Alice", teamId: "team1", checkedIn: false, foodCheckIn: false },
      bob: { firstName: "Bob", teamId: "team1", checkedIn: false, foodCheckIn: false },
      carol: { firstName: "Carol", teamId: "team2", checkedIn: false, foodCheckIn: false },
      dave: { firstName: "Dave", checkedIn: false, foodCheckIn: false },
    },

    teams: {
      team1: {
        name: "Alpha",
        createdBy: "alice",
        submitted: true,
        members: { alice: true, bob: true },
        submission: {
          ideaName: "Alpha idea",
          problemStatement: "A problem",
          targetIndustry: "Health",
          pitchDeckName: "deck.pdf",
          pitchDeckURL: "https://example.com/deck.pdf",
        },
        schedule: assignment("team1"),
      },
      team2: {
        name: "Beta",
        createdBy: "carol",
        submitted: true,
        members: { carol: true },
        submission: { ideaName: "Beta idea", problemStatement: "Another problem" },
      },
    },

    finalRound: { active: false },

    scores: {
      first: {
        team1: { judge1: scoreCard({ judgeUid: "judge1", teamId: "team1" }) },
      },
    },
  };
}

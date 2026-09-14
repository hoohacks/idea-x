/**
 * Fill the local emulator with a plausible event, so the whole day can be
 * rehearsed without touching the real project.
 *
 * This talks ONLY to the emulator, and refuses to run any other way. Two
 * deliberate choices enforce that:
 *
 *   - the project id is pinned to `demo-ideathon`, which the emulator treats as
 *     fully offline, and
 *   - every database write carries `Authorization: Bearer owner`, a credential
 *     that exists only in the emulator.
 *
 * There is no --apply flag and no production code path. Seeding a live event
 * with fake teams is not a thing anyone should be one typo away from.
 *
 * Usage:
 *   npm run emulators                  # in one terminal
 *   npm run seed                       # in another
 *   npm run start:emulator             # the app, pointed at the emulator
 *
 * Options:
 *   --teams=10 --judges=12 --rooms=10 --batches=3
 *   --final-judges=4  judges marked for the final round only -- the professors
 *                   and professionals, who are never given a first-round batch
 *   --scores        also file first-round score cards, so the final round and
 *                   the standings can be exercised straight away
 *   --schedule      also generate the first-round schedule
 *   --password=...  the password every seeded account shares (default: testtest)
 */

const PROJECT_ID = "demo-ideathon";

// The namespace the emulator applies database.rules.json to is the project's
// default instance, not the bare project id. src/firebase.js connects to this
// one; seeding anywhere else fills a database the app cannot see.
const NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);

const TEAMS = Number(args.teams ?? 10);
const JUDGES = Number(args.judges ?? 12);
const FINAL_JUDGES = Number(args["final-judges"] ?? 4);
const ROOMS = Number(args.rooms ?? 10);
const BATCHES = Number(args.batches ?? 3);
const PASSWORD = String(args.password ?? "testtest");
const WITH_SCORES = Boolean(args.scores);
const WITH_SCHEDULE = Boolean(args.schedule) || WITH_SCORES;

const MEMBERS_PER_TEAM = 3;

// ---------------------------------------------------------------- emulator io

async function ensureEmulator() {
  try {
    const response = await fetch(`http://${DB_HOST}/.json?ns=${NAMESPACE}`, {
      headers: { Authorization: "Bearer owner" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(
      `\nCannot reach the database emulator at ${DB_HOST}.\n` +
        `Start it first:  npm run emulators\n\n(${error.message})\n`
    );
    process.exit(1);
  }

  try {
    const response = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/config`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(
      `\nThe database emulator is up but the auth emulator at ${AUTH_HOST} is not.\n` +
        `firebase.json now declares it -- restart with:  npm run emulators\n\n(${error.message})\n`
    );
    process.exit(1);
  }
}

/** Wipe whatever a previous seed left behind, so runs are repeatable. */
async function resetEmulator() {
  await fetch(`http://${DB_HOST}/.json?ns=${NAMESPACE}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer owner" },
  });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: "DELETE",
  });
}

async function createAccount(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`${email}: ${body.error?.message ?? response.status}`);
  return body.localId;
}

async function writeDatabase(tree) {
  const response = await fetch(`http://${DB_HOST}/.json?ns=${NAMESPACE}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify(tree),
  });
  if (!response.ok) {
    throw new Error(`Database write failed: HTTP ${response.status} ${await response.text()}`);
  }
}

// -------------------------------------------------------------- fake people

const FIRST = ["Ada","Grace","Alan","Katherine","Linus","Barbara","Dennis","Radia","Ken","Margaret","Tim","Anita","Guido","Shafi","Bjarne","Frances","James","Carol","Donald","Evelyn","Rasmus","Hedy","Vint","Adele","Brian","Jean","Edsger","Sophie","Robert","Mary"];
const LAST = ["Lovelace","Hopper","Turing","Johnson","Torvalds","Liskov","Ritchie","Perlman","Thompson","Hamilton","Berners-Lee","Borg","Rossum","Goldwasser","Stroustrup","Allen","Gosling","Shaw","Knuth","Boyd","Lerdorf","Lamarr","Cerf","Goldberg","Kernighan","Bartik","Dijkstra","Wilson","Kahn","Keller"];
const MAJORS = ["Computer Science","Systems Engineering","Economics","Cognitive Science","Biomedical Engineering","Commerce","Statistics","Mathematics"];
const SCHOOLS = ["College of Arts & Sciences","School of Engineering","McIntire School of Commerce","School of Data Science"];
const YEARS = ["First Year","Second Year","Third Year","Fourth Year"];
const COMPANIES = ["Capital One","Deloitte","CarMax","Willow Tree","Aurora Labs","Northrop","S&P Global","Booz Allen"];
const INDUSTRIES = ["Healthcare","Education","Climate","Fintech","Accessibility","Agriculture","Transit","Civic tech"];
const IDEAS = ["Wayfinder","Rootstock","Clearing","Tandem","Almanac","Kindling","Foothold","Lantern","Sparrow","Ledger","Compass","Thicket","Beacon","Harbour","Quarry"];

const person = (i) => ({
  firstName: FIRST[i % FIRST.length],
  lastName: LAST[(i * 7) % LAST.length],
});

// -------------------------------------------------------------- the schedule
// Mirrors src/user/judge/planSchedule.js. Kept deliberately small and
// separate: this only exists so --schedule can hand you an event that is
// already mid-judging, and it must not become a second implementation anyone
// relies on. Build a plan in the app for the real thing.

function splitIntoBatches(items, batchCount) {
  const base = Math.floor(items.length / batchCount);
  const remainder = items.length % batchCount;
  const batches = [];
  let cursor = 0;
  for (let b = 0; b < batchCount; b++) {
    const size = base + (b < remainder ? 1 : 0);
    batches.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return batches;
}

function buildSchedule(teams, judges, rooms, batchTimes) {
  const batches = splitIntoBatches(teams, BATCHES).filter((batch) => batch.length);
  const byTeam = {};
  const byJudge = Object.fromEntries(judges.map((judge) => [judge.uid, {}]));

  batches.forEach((batch, batchIndex) => {
    const batchNumber = batchIndex + 1;
    batch.forEach((team, seat) => {
      byTeam[team.id] = {
        teamName: team.name,
        id: team.id,
        room: rooms[seat],
        time: batchTimes[batchNumber],
        batch: batchNumber,
        judges: [],
      };
    });
    judges.forEach((judge, judgeIndex) => {
      const seat = (judgeIndex + batchIndex * Math.floor(judgeIndex / batch.length)) % batch.length;
      const assignment = byTeam[batch[seat].id];
      assignment.judges.push({ judgeName: judge.name, judgeId: judge.uid });
      byJudge[judge.uid][batch[seat].id] = assignment;
    });
  });

  return { byTeam, byJudge };
}

// ------------------------------------------------------------------- seeding

async function main() {
  console.log(`\nSeeding ${PROJECT_ID} on the emulator`);
  console.log(
    `  ${TEAMS} teams · ${JUDGES} judges (+${FINAL_JUDGES} final round) · ` +
    `${ROOMS} rooms · ${BATCHES} batches\n`
  );

  if (TEAMS < 8) {
    console.warn(
      `  ! ${TEAMS} teams is below 8. With very few teams every judge sees every\n` +
        `    team in round one, so all of them are excluded from the final round\n` +
        `    and activation produces no assignments. That is a property of the\n` +
        `    data, not a bug. Seed at least 8 teams to exercise the final round.\n`
    );
  }

  await ensureEmulator();
  await resetEmulator();

  // ---- accounts ----
  process.stdout.write("  creating accounts... ");
  const adminUid = await createAccount("admin@example.com");

  // The first JUDGES are organizers (round one, and in the room for the final);
  // the rest are marked for the final round only, so a seeded event exercises
  // both roles -- including the generator's refusal to seat the second kind.
  const judges = [];
  for (let i = 0; i < JUDGES + FINAL_JUDGES; i++) {
    const { firstName, lastName } = person(i);
    judges.push({
      uid: await createAccount(`judge${i + 1}@example.com`),
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      index: i,
      finalOnly: i >= JUDGES,
    });
  }

  const competitors = [];
  for (let i = 0; i < TEAMS * MEMBERS_PER_TEAM; i++) {
    const { firstName, lastName } = person(i + 11);
    competitors.push({
      uid: await createAccount(`competitor${i + 1}@example.com`),
      firstName,
      lastName,
      index: i,
    });
  }
  console.log(`${1 + judges.length + competitors.length} created`);

  // ---- tree ----
  const now = Date.now();
  const batchTimes = Object.fromEntries(
    Array.from({ length: BATCHES }, (_, i) => [i + 1, `${5 + Math.floor(i / 4)}:${String((i * 15) % 60).padStart(2, "0")} PM`])
  );

  const teams = Array.from({ length: TEAMS }, (_, i) => ({
    id: `team-${String(i + 1).padStart(2, "0")}`,
    name: `${IDEAS[i % IDEAS.length]}${i >= IDEAS.length ? ` ${Math.floor(i / IDEAS.length) + 1}` : ""}`,
  }));

  const tree = {
    admins: { [adminUid]: true },
    config: {
      judgingRooms: Array.from({ length: ROOMS }, (_, i) => `Rice ${340 + i * 2}`),
      batchCount: BATCHES,
      batchTimes,
      finalRoundRoom: "Rice 011",
      eventStart: new Date(now + 86400000).toISOString(),
    },
    judges: {},
    competitors: {},
    teams: {},
  };

  judges.forEach((judge, i) => {
    tree.judges[judge.uid] = {
      firstName: judge.firstName,
      lastName: judge.lastName,
      email: `judge${i + 1}@example.com`,
      company: COMPANIES[i % COMPANIES.length],
      withCompany: true,
      wantsToJudge: true,
      wantsToMentor: i % 3 === 0,
      skills: ["Product", "Engineering"],
      timeslots: [],
      checkedIn: true,
      foodCheckIn: false,
      isRound1Judge: !judge.finalOnly,
      isFinalRoundJudge: judge.finalOnly,
      registeredAt: now - (JUDGES - i) * 60000,
    };
  });

  teams.forEach((team, teamIndex) => {
    const members = competitors.slice(
      teamIndex * MEMBERS_PER_TEAM,
      (teamIndex + 1) * MEMBERS_PER_TEAM
    );

    tree.teams[team.id] = {
      name: team.name,
      createdBy: members[0].uid,
      submitted: true,
      members: Object.fromEntries(members.map((member) => [member.uid, true])),
      submission: {
        ideaName: team.name,
        problemStatement: `${team.name} addresses a gap in ${INDUSTRIES[teamIndex % INDUSTRIES.length].toLowerCase()} that current tools leave open.`,
        targetIndustry: INDUSTRIES[teamIndex % INDUSTRIES.length],
        pitchDeckName: `${team.name.toLowerCase().replace(/\s+/g, "-")}-deck.pdf`,
        pitchDeckURL: "https://example.com/placeholder-deck.pdf",
      },
    };

    members.forEach((member, seat) => {
      tree.competitors[member.uid] = {
        firstName: member.firstName,
        lastName: member.lastName,
        email: `competitor${member.index + 1}@example.com`,
        major: MAJORS[member.index % MAJORS.length],
        skills: "React, Figma",
        learn: "Pitching",
        gender: seat % 2 === 0 ? "Woman" : "Man",
        schoolYear: YEARS[member.index % YEARS.length],
        uvaSchool: SCHOOLS[member.index % SCHOOLS.length],
        resume: "",
        dietaryRestriction: seat === 1 ? "Vegetarian" : "None",
        checkedIn: true,
        foodCheckIn: false,
        teamId: team.id,
        registeredAt: now - (competitors.length - member.index) * 30000,
      };
    });
  });

  // ---- optional schedule and scores ----
  if (WITH_SCHEDULE) {
    // round-one judges only, the same filter planSchedule applies: a judge
    // marked for the final round is not in the building for the first one
    const roundOneJudges = judges.filter((judge) => !judge.finalOnly);
    const { byTeam, byJudge } = buildSchedule(
      teams,
      roundOneJudges,
      tree.config.judgingRooms,
      batchTimes
    );

    for (const [teamId, assignment] of Object.entries(byTeam)) {
      tree.teams[teamId].schedule = assignment;
    }
    for (const [judgeUid, assignments] of Object.entries(byJudge)) {
      if (Object.keys(assignments).length) tree.judges[judgeUid].teamAssignments = assignments;
    }
    tree.config.scheduleMeta = {
      generatedAt: now,
      generatedBy: adminUid,
      teams: teams.length,
      judges: roundOneJudges.length,
      onlyCheckedIn: false,
    };

    if (WITH_SCORES) {
      tree.scores = { first: {} };
      // a deterministic spread, so the standings are stable between runs and
      // the top four are always the same teams
      let seed = 7;
      const next = (max) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % (max + 1));

      for (const [teamId, assignment] of Object.entries(byTeam)) {
        tree.scores.first[teamId] = {};
        for (const { judgeId } of assignment.judges) {
          const lift = TEAMS - Number(teamId.slice(-2)); // earlier teams score higher
          tree.scores.first[teamId][judgeId] = {
            problem: Math.min(10, 4 + next(3) + Math.round(lift / 4)),
            innovation: Math.min(10, 4 + next(4) + Math.round(lift / 5)),
            impact: Math.min(10, 4 + next(3) + Math.round(lift / 4)),
            viability: Math.min(5, 2 + next(2)),
            pitch_quality: Math.min(5, 2 + next(2)),
            fundable: next(2) > 0,
            notes: "Clear problem framing; the demo landed well.",
            teamName: assignment.teamName,
            room: assignment.room,
            time: assignment.time,
            judgeUid: judgeId,
            teamId,
            enteredBy: judgeId,
            source: "judge",
            submittedAt: now - next(3600000),
          };
        }
      }
    }
  }

  await writeDatabase(tree);

  // ---- report ----
  console.log("  database written\n");
  console.log("  Sign in with any of these (password: " + PASSWORD + ")");
  console.log("    admin@example.com          organizer, listed in /admins");
  console.log(`    judge1@example.com  …  judge${JUDGES}@example.com  round one`);
  if (FINAL_JUDGES > 0) {
    console.log(
      `    judge${JUDGES + 1}@example.com  …  judge${JUDGES + FINAL_JUDGES}@example.com  final round only`
    );
  }
  console.log(`    competitor1@example.com  …  competitor${TEAMS * MEMBERS_PER_TEAM}@example.com`);
  console.log("\n  State:");
  console.log(
    `    ${TEAMS} teams, all submitted · ${JUDGES} round-one judges and ` +
    `${FINAL_JUDGES} final-round judges, all checked in`
  );
  console.log(`    schedule: ${WITH_SCHEDULE ? "generated" : "not generated — press Generate Schedule"}`);
  console.log(`    scores:   ${WITH_SCORES ? "filed for every assignment" : "none"}`);
  console.log("\n  Now run:  npm run start:emulator");
  console.log(
    "\n  Note: seeding recreates every account, so a browser tab that was already\n" +
      "  signed in now holds a credential for a uid that no longer exists. Sign in\n" +
      "  again after seeding, or every read fails with Permission denied.\n"
  );
}

main().catch((error) => {
  console.error("\nSeeding failed:", error.message, "\n");
  process.exit(1);
});

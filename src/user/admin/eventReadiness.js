import { describeSupply, BATCH_COUNT } from "../judge/schedulePlan.js";

/**
 * The rules version this build of the app needs deployed.
 *
 * `database.rules.json` carries the same number in a comment, and `npm test`
 * fails if the two disagree. Rules are not readable from a browser, so the
 * deploy workflow records the number it deployed in `config/rulesVersion`, and
 * this compares the two.
 *
 * It matters more than a version mismatch usually does: before version 5,
 * restoring a restore point that contains scores fails and changes nothing,
 * before version 10 the database takes a team's submission whether or not
 * organizers have opened submissions or the deadline has passed -- only the
 * page hides the form -- and announcements cannot be posted at all, and before
 * version 11 the presentation waiver is not enforced, before version 12
 * organizers cannot check people in, and before version 13 competitors and
 * judges cannot see the resources organizers post.
 */
export const REQUIRED_RULES_VERSION = 13;

/**
 * Where the event has got to, and what an organizer should do next.
 *
 * The app knew all of this and told nobody. Every constraint in it was enforced
 * at the moment it was violated -- building a plan refuses when no rooms are
 * configured, refuses again when there are too few first-round judges, and the
 * final round produces no assignments when nobody is checked in. Each of those is a
 * good refusal in the wrong place: you meet it while trying to do the thing,
 * not while there is still time to fix it.
 *
 * The order was in the README and nowhere in the interface. An organizer who
 * had not read it had a dropdown of seven destinations and no way to know that
 * rooms come before a schedule, or that a schedule comes before judges see
 * anything at all.
 *
 * Pure, so the whole sequence can be tested without an emulator.
 */

export const SETUP = "setup";
export const READY = "ready";
export const SCHEDULED = "scheduled";
export const JUDGING = "judging";
export const FINAL = "final";

const PHASE_LABEL = {
  [SETUP]: "Setting up",
  [READY]: "Ready to schedule",
  [SCHEDULED]: "Schedule published",
  [JUDGING]: "Judging in progress",
  [FINAL]: "Final round",
};

export function phaseLabel(phase) {
  return PHASE_LABEL[phase] ?? "Setting up";
}

function countTeams(teams) {
  const all = Object.values(teams ?? {});
  return {
    total: all.length,
    submitted: all.filter((team) => team?.submitted).length,
    scheduled: all.filter((team) => team?.schedule).length,
  };
}

function countJudges(judges) {
  const all = Object.values(judges ?? {});
  return {
    total: all.length,
    roundOne: all.filter((judge) => judge?.isRound1Judge === true).length,
    checkedIn: all.filter((judge) => judge?.checkedIn === true).length,
  };
}

/**
 * The state of the event, as one object.
 *
 * `scoredTeams` is how many teams carry at least one first-round card; it is
 * what distinguishes "the schedule is published" from "judging has started",
 * and no flag in the database records that.
 */
export function readEventState({
  config = {},
  teams = {},
  judges = {},
  competitors = {},
  scoredTeams = 0,
  finalActive = false,
  hasDraft = false,
  legacyScoreTeams = 0,
} = {}) {
  const team = countTeams(teams);
  const judge = countJudges(judges);
  const rooms = (config.judgingRooms ?? []).length;
  const batchCount = Number(config.batchCount) || BATCH_COUNT;

  const competitorList = Object.values(competitors ?? {});
  const people = {
    competitors: competitorList.length,
    checkedIn: competitorList.filter((person) => person?.checkedIn === true).length,
  };

  // the planner's own answer to "could this event be scheduled at all", asked
  // before an organizer walks into it rather than at the moment it refuses
  const supply = describeSupply({
    teamCount: team.submitted,
    judgeCount: judge.roundOne,
    roomCount: rooms,
    batchCount,
  });

  let phase = SETUP;
  if (finalActive) phase = FINAL;
  else if (scoredTeams > 0) phase = JUDGING;
  else if (team.scheduled > 0) phase = SCHEDULED;
  else if (supply.ok) phase = READY;

  return {
    phase,
    phaseLabel: phaseLabel(phase),
    counts: { teams: team, judges: judge, people, rooms, batchCount, scoredTeams },
    supply,
    hasDraft,
    checks: checksFor({ rooms, judge, team, config, supply }),
    blockers: blockersFor({ config, legacyScoreTeams }),
    actions: actionsFor({ phase, hasDraft, supply, team, judge, scoredTeams }),
  };
}

/**
 * The setup list, in the order the day needs it. `done` is a fact, `detail`
 * says what the number actually is, and `to` is where it gets fixed.
 */
function checksFor({ rooms, judge, team, config, supply }) {
  return [
    {
      id: "rooms",
      label: "Judging rooms added",
      done: rooms > 0,
      detail: rooms ? `${rooms} room${rooms === 1 ? "" : "s"}` : "None yet. A plan cannot be built without them",
      to: "/user/admin/control?tab=setup",
    },
    {
      id: "judges",
      label: "First-round judges marked",
      done: judge.roundOne > 0 && supply.ok,
      detail: judge.roundOne
        ? `${judge.roundOne} of ${judge.total} judges`
        : "None yet, so nobody would be assigned",
      to: "/user/admin/judges",
    },
    {
      id: "date",
      label: "Event date set",
      done: Boolean(config.eventStart),
      detail: config.eventStart ? "Set" : "Using the built-in date",
      to: "/user/admin/control?tab=setup",
    },
    {
      id: "submissions",
      label: "Teams submitted",
      done: team.submitted > 0,
      // with nothing in yet, the likely reason is that nobody opened the form
      detail:
        team.submitted === 0 && config.submissionsOpen !== true
          ? "Submissions are closed. Open them in Event setup on the day"
          : `${team.submitted} of ${team.total} team${team.total === 1 ? "" : "s"}`,
      to:
        team.submitted === 0 && config.submissionsOpen !== true
          ? "/user/admin/control?tab=setup"
          : "/user/admin/teams",
    },
    {
      id: "schedule",
      label: "Schedule published",
      done: team.scheduled > 0,
      detail: team.scheduled ? `${team.scheduled} teams scheduled` : "Not yet. Judges see nothing until it is",
      to: "/user/admin/schedule",
    },
  ];
}

// What an older deployed version is missing, keyed by the version that fixed
// it, so the warning names only what is actually broken on that database.
const RULES_GAPS = [
  [10, "the database does not enforce the submissions switch or deadline, and announcements cannot be posted"],
  [11, "the presentation waiver is not enforced"],
  [12, "organizers cannot check people in"],
  [13, "competitors and judges cannot see resources"],
  [5, "restoring a restore point that contains scores fails and changes nothing"],
];

function joinGaps(gaps) {
  return gaps.length < 2 ? gaps.join("") : `${gaps.slice(0, -1).join(", ")}, and ${gaps[gaps.length - 1]}`;
}

function rulesDetail(published) {
  if (!Number.isFinite(published)) {
    return `Nobody has recorded which version is deployed. Until ${REQUIRED_RULES_VERSION} is published, restoring a restore point that contains scores may fail, the database does not enforce the submissions switch or deadline, announcements cannot be posted, the presentation waiver is not enforced, organizers cannot check people in, and competitors and judges cannot see resources.`;
  }
  const gaps = RULES_GAPS.filter(([fixedIn]) => published < fixedIn).map(([, gap]) => gap);
  if (!gaps.length) {
    return `Version ${published} is recorded as published, but this build expects ${REQUIRED_RULES_VERSION}.`;
  }
  return `Version ${published} is recorded as published. Until ${REQUIRED_RULES_VERSION} is, ${joinGaps(gaps)}.`;
}

/**
 * Things that must be done before the event and that nothing else will remind
 * anyone about, because both fail silently rather than loudly.
 */
function blockersFor({ config, legacyScoreTeams }) {
  const blockers = [];

  const published = Number(config.rulesVersion);
  if (published !== REQUIRED_RULES_VERSION) {
    blockers.push({
      id: "rules",
      title: `Publish database rules version ${REQUIRED_RULES_VERSION}`,
      detail: rulesDetail(published),
      how: "Publish a release; the deploy workflow publishes the rules and records the version. To do it by hand, deploy database.rules.json and set config/rulesVersion to match.",
      to: "/user/admin/control?tab=setup",
    });
  }

  if (legacyScoreTeams > 0) {
    blockers.push({
      id: "migration",
      title: "Finish the score migration",
      detail: `${legacyScoreTeams} team${legacyScoreTeams === 1 ? " still has" : "s still have"} score cards under the old location, which the app no longer reads. Those cards count for nothing until they are moved.`,
      how: "Run npm run migrate:scores, then check the standings look right.",
      to: "/user/admin/control?tab=data",
    });
  }

  return blockers;
}

/**
 * What to do next. At most three, most useful first, because a list of every
 * possible action is the dropdown this replaces.
 */
function actionsFor({ phase, hasDraft, supply, team, judge, scoredTeams }) {
  const actions = [];

  if (hasDraft) {
    actions.push({
      label: "Finish the schedule draft",
      to: "/user/admin/schedule",
      primary: true,
      why: "An unpublished plan is open. Judges see nothing until it is published.",
    });
  }

  if (phase === SETUP) {
    if (!supply.ok) {
      actions.push({ label: "Finish event setup", to: "/user/admin/control?tab=setup", primary: !hasDraft });
    }
    actions.push({ label: "Add people and roles", to: "/user/admin/control?tab=people" });
  }

  if (phase === READY && !hasDraft) {
    actions.push({
      label: "Plan the schedule",
      to: "/user/admin/schedule",
      primary: true,
      why: `${team.submitted} teams and ${judge.roundOne} first-round judges are ready.`,
    });
  }

  if (phase === SCHEDULED || phase === JUDGING) {
    actions.push({
      label: "Watch judging progress",
      to: "/user/admin/judging",
      primary: !hasDraft,
      why: phase === JUDGING ? `${scoredTeams} teams have scores so far.` : undefined,
    });
  }

  if (phase === JUDGING && scoredTeams > 0) {
    actions.push({
      label: "Plan the final round",
      to: "/user/admin/schedule?round=final",
      why: "Ranks every team and cuts the finalists. Nothing is written until you publish.",
    });
  }

  if (phase === FINAL) {
    actions.push({ label: "Final round progress", to: "/user/admin/judging", primary: true });
  }

  actions.push({ label: "Check people in", to: "/user/admin/scan" });

  return actions.slice(0, 3);
}

import { ref, get, push, runTransaction, serverTimestamp } from "firebase/database";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  connectAuthEmulator,
} from "firebase/auth";
import { database, auth, USING_EMULATOR } from "../../../firebase.js";
import { firebaseConfig } from "../../../firebaseConfig.js";
import { applyAdminAction } from "../adminAction.js";
import { grantAdmin, revokeAdmin, revokeGuard } from "../organizers/adminsService.js";
import { memberRemovalPath } from "../../team/teamMembers.js";

/**
 * Everything about a person that used to need the Firebase console.
 *
 * A role in this app is membership of a node named after it -- /admins/{uid},
 * /judges/{uid}, /competitors/{uid} -- and they are additive: one account can
 * be all three. Until now only /admins was reachable from the app, so making
 * someone a judge after they registered as a competitor meant opening the
 * console and hand-writing a record.
 *
 * Two limits are real and cannot be engineered away from a browser, so they are
 * surfaced rather than hidden:
 *
 *   - **The client SDK cannot delete a Firebase Auth account**, and cannot list
 *     them either. Deleting someone here removes their database records and
 *     leaves a working login that resolves to no role. That person can still
 *     sign in and will see an empty account.
 *   - **It cannot change someone's email or password.** A password reset is
 *     sent as an email to them; nobody here can set it directly.
 *
 * Creating an account IS possible, via a second Firebase app instance. Calling
 * createUserWithEmailAndPassword on the main one would sign the organizer out
 * and in as the person they just created, which is a memorable way to lose a
 * schedule generation halfway through.
 */

export const ROLE_NODES = { admin: "admins", judge: "judges", competitor: "competitors" };

/** A judge record with nothing filled in but the fields the app reads. */
export function blankJudge({ firstName = "", lastName = "", email = "", company = "" } = {}) {
  return {
    firstName, lastName, email, company,
    withCompany: Boolean(company),
    wantsToJudge: true,
    wantsToMentor: false,
    skills: [],
    timeslots: [],
    checkedIn: false,
    foodCheckIn: false,
    isRound1Judge: false,
    registeredAt: serverTimestamp(),
  };
}

/** A competitor record, same idea. */
export function blankCompetitor({ firstName = "", lastName = "", email = "" } = {}) {
  return {
    firstName, lastName, email,
    major: "",
    skills: "",
    learn: "",
    gender: "",
    schoolYear: "",
    uvaSchool: "",
    resume: "",
    // lowercase, to match every reader: Registration.js writes "none",
    // Profile.js lists ["none", ...], and Search.js's chip and dietary filter
    // both compare against "none". A capitalized default here used to slip a
    // record past all three -- catering saw a dietary flag reading "None" on
    // every walk-in an organizer added by hand, and the filter split one
    // bucket of "no restriction" into two.
    dietaryRestriction: "none",
    checkedIn: false,
    foodCheckIn: false,
    registeredAt: serverTimestamp(),
  };
}

/**
 * Everyone, with the roles they hold.
 *
 * /admins holds only `true`, so an admin who is neither judge nor competitor
 * has no name anywhere. They still have to be listed, or the one person you
 * most need to find -- the organizer you are about to revoke -- is invisible.
 */
export async function listPeople() {
  const [adminsSnap, judgesSnap, competitorsSnap, archiveSnap] = await Promise.all([
    get(ref(database, "admins")),
    get(ref(database, "judges")),
    get(ref(database, "competitors")),
    get(ref(database, "archive/people")),
  ]);

  const people = new Map();
  const touch = (uid) => {
    if (!people.has(uid)) {
      people.set(uid, { uid, name: "", email: "", roles: [], judge: null, competitor: null });
    }
    return people.get(uid);
  };

  for (const uid of Object.keys(adminsSnap.val() ?? {})) touch(uid).roles.push("admin");

  for (const [role, snap] of [["judge", judgesSnap], ["competitor", competitorsSnap]]) {
    for (const [uid, person] of Object.entries(snap.val() ?? {})) {
      const entry = touch(uid);
      entry.roles.push(role);
      entry[role] = person;
      const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
      if (name && !entry.name) entry.name = name;
      if (person?.email && !entry.email) entry.email = person.email;
    }
  }

  // Roles are exclusive, and /admins holds nothing but `true` -- so the record
  // carrying an organizer's name is the one their switch deleted. The archived
  // copy is where it went, and without this the person you most need to find in
  // this list is a uid.
  const archived = archiveSnap.val() ?? {};
  for (const entry of people.values()) {
    if (entry.name && entry.email) continue;
    const record = latestArchivedRecord(archived[entry.uid]);
    if (!record) continue;
    const name = [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
    if (name && !entry.name) entry.name = name;
    if (record.email && !entry.email) entry.email = record.email;
  }

  return [...people.values()]
    .map((p) => ({ ...p, name: p.name || p.email || `(no profile) ${p.uid.slice(0, 8)}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The most recently archived record for one person that carries a name or an
 * email. Keys are `{timestamp}-{role}`, so a plain descending sort is newest
 * first for any timestamp of the same width.
 */
export function latestArchivedRecord(entries) {
  for (const key of Object.keys(entries ?? {}).sort().reverse()) {
    const record = entries[key]?.record;
    if (!record) continue;
    if (record.firstName || record.lastName || record.email) return record;
  }
  return null;
}

export function matchesQuery(person, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) ||
    String(person.email).toLowerCase().includes(needle) ||
    person.uid.toLowerCase().includes(needle)
  );
}

/**
 * Every path that mentions this person, so removing them does not leave a name
 * on a schedule card nobody can explain. Pure, so the fan-out can be tested.
 */
export function removalChanges({
  uid,
  judgesData = {},
  teamsData = {},
  competitorsData = {},
  scoresData = {},
  finalRoundTeams = {},
  includeScores = false,
}) {
  const changes = [];

  if (judgesData[uid]) changes.push({ path: `judges/${uid}`, before: judgesData[uid], after: null });
  if (competitorsData[uid]) {
    changes.push({ path: `competitors/${uid}`, before: competitorsData[uid], after: null });
  }

  for (const [teamId, team] of Object.entries(teamsData)) {
    // a competitor leaves their team's roster -- whichever shape it is
    // stored in: a legacy team holds the uid as an array VALUE, not a key,
    // so hasOwnProperty(members, uid) would silently find nothing to remove
    const removal = memberRemovalPath(team?.members, uid);
    if (removal) {
      changes.push({ path: `teams/${teamId}/members/${removal.key}`, before: removal.before, after: null });
    }

    // a judge comes off every team's schedule card
    const raw = team?.schedule?.judges;
    const roster = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    if (roster.some((entry) => entry?.judgeId === uid)) {
      changes.push({
        path: `teams/${teamId}/schedule/judges`,
        before: roster,
        after: roster.filter((entry) => entry?.judgeId !== uid),
      });
    }

  }

  // and out of the final round exclusion list, or a deleted judge keeps a
  // finalist permanently unjudgeable
  for (const [teamId, standing] of Object.entries(finalRoundTeams ?? {})) {
    if (standing?.excludedJudges?.[uid]) {
      changes.push({
        path: `finalRound/teams/${teamId}/excludedJudges/${uid}`,
        before: standing.excludedJudges[uid],
        after: null,
      });
    }
  }

  if (includeScores) {
    for (const [round, teams] of Object.entries(scoresData ?? {})) {
      for (const [teamId, cards] of Object.entries(teams ?? {})) {
        if (cards?.[uid]) {
          changes.push({ path: `scores/${round}/${teamId}/${uid}`, before: cards[uid], after: null });
        }
      }
    }
  }

  return changes;
}

async function loadWorld() {
  const [judgesSnap, teamsSnap, competitorsSnap, scoresSnap, finalSnap, adminsSnap] =
    await Promise.all([
      get(ref(database, "judges")),
      get(ref(database, "teams")),
      get(ref(database, "competitors")),
      get(ref(database, "scores")),
      get(ref(database, "finalRound/teams")),
      get(ref(database, "admins")),
    ]);
  return {
    judgesData: judgesSnap.val() ?? {},
    teamsData: teamsSnap.val() ?? {},
    competitorsData: competitorsSnap.val() ?? {},
    scoresData: scoresSnap.val() ?? {},
    finalRoundTeams: finalSnap.val() ?? {},
    adminUids: Object.keys(adminsSnap.val() ?? {}),
  };
}

export const ROLE_LABELS = { admin: "Admin", judge: "Judge", competitor: "Competitor" };

/** The roles a person holds one of. Admin sits on top and is not one. */
export const PERSON_ROLES = ["judge", "competitor"];

/** Only the removal paths that belong to one role. */
function changesForRole(role, all) {
  return all.filter((change) =>
    role === "judge"
      ? change.path.startsWith("judges/") ||
        change.path.includes("/schedule/judges") ||
        change.path.startsWith("scores/") ||
        change.path.includes("/excludedJudges/")
      : change.path.startsWith("competitors/") || change.path.includes("/members/")
  );
}

/**
 * The name and email to carry onto the record being created, recovered from
 * whichever records this person already has.
 *
 * A record written with empty identity fields is not merely unhelpful. The app
 * merges a person's records into one profile at sign-in, so an empty firstName
 * or email on one of them used to overwrite the real one on another: the person
 * saw no name, no email, and a password reset that refused for want of an
 * address. Exclusive roles make it worse, not better -- the record they
 * registered with is the one being deleted.
 */
function identityFrom(records) {
  const identity = { firstName: "", lastName: "", email: "", company: "" };
  for (const record of records) {
    if (!record) continue;
    for (const key of Object.keys(identity)) {
      if (!identity[key] && record[key]) identity[key] = record[key];
    }
  }
  return identity;
}

/**
 * What an organizer is about to destroy, in plain sentences, for the dialog
 * that asks them to confirm it. Pure, so the wording can be tested.
 *
 * The archived copy is named deliberately. Everything else here is a list of
 * things that do not come back with the role, and somebody reading a list of
 * losses needs to know the record itself is recoverable.
 */
export function describeSwitch({ person, role }) {
  const lines = [];
  // organizer is a flag on top, not one of the roles being swapped
  const leaving = (person?.roles ?? []).filter(
    (held) => held !== role && PERSON_ROLES.includes(held)
  );

  for (const held of leaving) lines.push(`Deletes their ${held} record.`);

  const competitor = leaving.includes("competitor") ? person?.competitor : null;
  if (competitor?.teamId) lines.push("Takes them off their team.");
  if (competitor?.resume) lines.push("Drops the resume on file.");

  const judge = leaving.includes("judge") ? person?.judge : null;
  const assignments = Object.keys(judge?.teamAssignments ?? {}).length;
  if (assignments) {
    lines.push(`Removes ${assignments} judging assignment${assignments === 1 ? "" : "s"}, and their name from those teams' cards.`);
  }
  if (judge?.isRound1Judge) lines.push("Clears their first-round judge mark.");
  if (judge) lines.push("Scores they filed are kept, because they count toward averages.");

  if (leaving.length) {
    lines.push("A copy of the record is archived, and can be put back.");
  }

  return lines;
}

/**
 * Give somebody exactly one role, replacing whatever they hold.
 *
 * Roles used to be additive -- one account could be a judge and a competitor at
 * once -- and the control panel offered a +/- button per role. Two of those
 * buttons in a row is how a record gets deleted and re-created empty, which
 * reads as an account wiping itself. One role, one dropdown, one write.
 *
 * Organizer is deliberately NOT one of these. It is a flag at /admins/{uid}
 * with no record of its own, and it sits on top: an organizer who is also a
 * judge needs the judge record to be scheduled, to see their cards and to file
 * a score under their own name. Making organizer exclusive with the rest
 * deleted that record and quietly took away their ability to judge. See
 * `setOrganizer`.
 *
 * Everything goes into a single atomic update: the archive copy, the removal
 * fan-out for the role being left, and the record for the role being taken.
 * The archive is written in the SAME update as the delete, so there is no
 * window in which the record is gone and the copy is not yet there.
 *
 * `role` is "judge", "competitor", or "none".
 */
export async function setSoleRole({ uid, name, role, includeScores = false }) {
  if (!uid) return { ok: false, error: "Pick a person first." };
  if (role !== "none" && !PERSON_ROLES.includes(role)) {
    return { ok: false, error: `Unknown role "${role}".` };
  }

  const world = await loadWorld();

  const held = PERSON_ROLES.filter((current) =>
    current === "judge" ? world.judgesData[uid] : world.competitorsData[uid]
  );

  const label = role === "none" ? "no role" : ROLE_LABELS[role].toLowerCase();
  if (held.length === 1 && held[0] === role) {
    return { ok: false, error: `${name || uid} is already a ${label}.` };
  }
  if (role === "none" && !held.length) {
    return { ok: false, error: `${name || uid} has no role to remove.` };
  }

  const leaving = held.filter((current) => current !== role);

  const changes = [];
  const stamp = Date.now();
  const by = auth.currentUser?.uid ?? "admin";
  const all = removalChanges({ uid, ...world, includeScores });

  for (const current of leaving) {
    const record = current === "judge" ? world.judgesData[uid] : world.competitorsData[uid];
    changes.push({
      path: `archive/people/${uid}/${stamp}-${current}`,
      before: null,
      after: { role: current, record, archivedAt: serverTimestamp(), archivedBy: by },
    });
    changes.push(...changesForRole(current, all));
  }

  // A record for the role they are keeping is left exactly as it is. Rewriting
  // it would blank whatever an organizer or the person had already filled in.
  if (role !== "none" && !held.includes(role)) {
    const identity = identityFrom([world.judgesData[uid], world.competitorsData[uid]]);
    const record = role === "judge" ? blankJudge(identity) : blankCompetitor(identity);
    changes.push({ path: `${ROLE_NODES[role]}/${uid}`, before: null, after: record });
  }

  return applyAdminAction({
    action: "role.set",
    summary:
      role === "none"
        ? `Removed the role from ${name || uid}`
        : `Made ${name || uid} a ${label}`,
    changes,
  });
}

/**
 * What was archived for this person, newest first.
 *
 * The archive existed with nothing to read it: a role change copied the record
 * it was about to delete and then there was no way to get it back, which made
 * "a copy is archived, and can be put back" true only of the first half.
 */
export async function listArchived(uid) {
  if (!uid) return [];
  try {
    const snap = await get(ref(database, `archive/people/${uid}`));
    if (!snap.exists()) return [];
    return Object.entries(snap.val() ?? {})
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => b.key.localeCompare(a.key));
  } catch (error) {
    console.error("Could not read the archive:", error);
    return [];
  }
}

/**
 * Put an archived record back.
 *
 * It refuses rather than overwrites when a record already exists at that path:
 * whatever is there now is something somebody made after the archive was taken,
 * and losing it to a restore is the failure this whole mechanism exists to
 * prevent.
 */
export async function restoreArchived({ uid, key }) {
  if (!uid || !key) return { ok: false, error: "Pick an archived record to restore." };

  const entries = await listArchived(uid);
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry?.record) return { ok: false, error: "That archived record no longer exists." };

  const node = ROLE_NODES[entry.role];
  if (!node) return { ok: false, error: `Cannot restore a "${entry.role}" record.` };

  // whole-node read, like every other lookup in this file, so one place decides
  // what "they already have a record" means
  const world = await loadWorld();
  const existing = entry.role === "judge" ? world.judgesData[uid] : world.competitorsData[uid];
  if (existing) {
    return {
      ok: false,
      error:
        `They already have a ${entry.role} record. Restoring would overwrite what is there now — ` +
        `change their role away from ${entry.role} first if you mean to replace it.`,
    };
  }

  const name = [entry.record.firstName, entry.record.lastName].filter(Boolean).join(" ").trim();
  return applyAdminAction({
    action: "archive.restore",
    summary: `Restored the ${entry.role} record for ${name || uid}`,
    changes: [{ path: `${node}/${uid}`, before: null, after: entry.record }],
  });
}

/**
 * Turn organizer access on or off, independently of the person's role.
 *
 * Delegates rather than reimplements: `revokeAdmin` carries the lockout guard
 * that stops /admins being emptied, which cannot be undone from inside the app
 * because writing /admins requires already being an admin.
 */
export async function setOrganizer({ uid, name, enabled }) {
  if (!uid) return { ok: false, error: "Pick a person first." };
  return enabled ? grantAdmin({ uid, name }) : revokeAdmin(uid, { name });
}

/**
 * Remove a person entirely: every role, every reference.
 *
 * Their login survives. Nothing in a browser can delete a Firebase Auth
 * account, so the honest thing is to do the half that is possible and say so.
 */
export async function deletePerson({ uid, name, includeScores = false }) {
  if (!uid) return { ok: false, error: "Pick a person first." };
  if (uid === auth.currentUser?.uid) {
    return { ok: false, error: "You cannot delete your own records while signed in as them." };
  }

  const world = await loadWorld();
  const adminsSnap = await get(ref(database, "admins"));
  const adminUids = Object.keys(adminsSnap.val() ?? {});

  if (adminUids.includes(uid)) {
    const refusal = revokeGuard({ uid, currentUid: auth.currentUser?.uid ?? null, adminUids });
    if (refusal) return { ok: false, error: refusal };
  }

  const changes = removalChanges({ uid, ...world, includeScores });
  if (adminUids.includes(uid)) {
    changes.push({ path: `admins/${uid}`, before: true, after: null });
  }

  if (!changes.length) return { ok: false, error: "There is nothing recorded for that person." };

  const result = await applyAdminAction({
    action: "person.delete",
    summary: `Deleted every record for ${name || uid}`,
    changes,
  });

  return {
    ...result,
    warning:
      "Their login still works. A browser cannot delete a Firebase Auth account, so they can " +
      "sign in and will see an account with no role. Remove the account in the Firebase console " +
      "if that matters.",
  };
}

/**
 * Create an account and its record.
 *
 * The account is created on a SECOND Firebase app, because
 * createUserWithEmailAndPassword signs the new user in on whichever app it is
 * called against -- doing that on the main one would sign the organizer out
 * mid-task and leave them acting as the person they just created.
 */
export async function createPerson({ role, firstName, lastName, email, password, company = "" }) {
  if (!ROLE_NODES[role] || role === "admin") {
    return { ok: false, error: "Create a judge or a competitor; admin is a flag on top." };
  }
  if (!String(email ?? "").includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (String(password ?? "").length < 6) {
    return { ok: false, error: "The password must be at least 6 characters." };
  }

  let secondary;
  let uid;
  try {
    secondary = initializeApp(firebaseConfig, `admin-create-${Date.now()}`);
    const secondaryAuth = getAuth(secondary);
    if (USING_EMULATOR) {
      const host = process.env.REACT_APP_EMULATOR_HOST || "127.0.0.1";
      connectAuthEmulator(secondaryAuth, `http://${host}:9099`, { disableWarnings: true });
    }

    const credential = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    uid = credential.user.uid;
    await signOut(secondaryAuth);
  } catch (error) {
    const message =
      error?.code === "auth/email-already-in-use"
        ? "That email already has an account. Search for them instead and add the role."
        : error?.message || "The account could not be created.";
    return { ok: false, error: message };
  } finally {
    if (secondary) {
      try { await deleteApp(secondary); } catch { /* already gone */ }
    }
  }

  const record =
    role === "judge"
      ? blankJudge({ firstName, lastName, email: email.trim(), company })
      : blankCompetitor({ firstName, lastName, email: email.trim() });

  const result = await applyAdminAction({
    action: "person.create",
    summary: `Created ${role} ${[firstName, lastName].filter(Boolean).join(" ") || email}`,
    changes: [{ path: `${ROLE_NODES[role]}/${uid}`, before: null, after: record }],
  });

  return { ...result, uid };
}

/**
 * Create a database record for a uid that already has a login.
 *
 * The existence check used to be a plain `get` before the write -- two
 * organizers independently fixing the same broken uid could both read "no
 * record yet" and both write, with the second silently overwriting the
 * first's name and email and neither one told anything went wrong. That is
 * the same shape of race that let two organizers stomp each other's schedule
 * draft (see draftStore.saveDraft), and the fix is the same one: a
 * transaction that re-reads the path at the moment it commits and only
 * writes if it is still empty, instead of trusting a read from a moment ago.
 *
 * This is a true compare-and-swap on `${role}/${uid}`, not a narrower window
 * -- RTDB transactions are conditional (they retry against the server's
 * current value and abort if a callback returns undefined), which a plain
 * multi-path `update()` never is. It closes the double-attach race
 * completely: whichever attempt commits first wins, and the second is told
 * plainly rather than silently discarded. The one path this does NOT cover is
 * a write racing an *edit* to the same record made in the instant between the
 * transaction committing and the log entry below re-affirming the same value
 * -- that would need the log write folded into the same transaction, which
 * `applyAdminAction`'s single shared multi-path update does not support.
 */
export async function attachRecord({ uid, role, firstName, lastName, email, company = "" }) {
  if (!uid) return { ok: false, error: "Enter the account's uid." };
  if (!ROLE_NODES[role] || role === "admin") {
    return { ok: false, error: "Pick judge or competitor." };
  }

  const record =
    role === "judge"
      ? blankJudge({ firstName, lastName, email, company })
      : blankCompetitor({ firstName, lastName, email });

  let result;
  try {
    result = await runTransaction(ref(database, `${ROLE_NODES[role]}/${uid}`), (current) =>
      current === null ? record : undefined
    );
  } catch (error) {
    return { ok: false, error: error.message || "The record could not be saved." };
  }

  if (!result.committed) {
    return { ok: false, error: `That uid already has a ${role} record.` };
  }

  return applyAdminAction({
    action: "person.create",
    summary: `Added a ${role} record for ${[firstName, lastName].filter(Boolean).join(" ") || uid}`,
    changes: [{ path: `${ROLE_NODES[role]}/${uid}`, before: null, after: record }],
  });
}

/** Email a reset link. The only password operation a browser is allowed. */
export async function sendReset(email) {
  if (!String(email ?? "").includes("@")) return { ok: false, error: "That person has no email on file." };
  try {
    await sendPasswordResetEmail(auth, email.trim());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || "The reset email could not be sent." };
  }
}

/**
 * Set one boolean on many people at once.
 *
 * Check-in for a whole company's judges, or marking the round-one pool, is
 * otherwise one dialog per person -- which is how a room of forty judges gets
 * half checked in.
 */
export async function bulkSet({ uids, role, field, value }) {
  const allowed = {
    judge: ["checkedIn", "foodCheckIn", "isRound1Judge"],
    competitor: ["checkedIn", "foodCheckIn"],
  };
  if (!allowed[role]?.includes(field)) {
    return { ok: false, error: `Cannot set ${field} on a ${role}.` };
  }
  if (!uids?.length) return { ok: false, error: "Nobody is selected." };

  const node = ROLE_NODES[role];
  const before = await Promise.all(
    uids.map(async (uid) => {
      const snap = await get(ref(database, `${node}/${uid}/${field}`));
      return snap.exists() ? snap.val() : null;
    })
  );

  const changes = uids
    .map((uid, i) => ({ path: `${node}/${uid}/${field}`, before: before[i], after: value }))
    .filter((change) => change.before !== change.after);

  if (!changes.length) return { ok: false, error: "They are all already set that way." };

  return applyAdminAction({
    action: "people.bulk",
    summary: `Set ${field} to ${value} for ${changes.length} ${role}(s)`,
    changes,
  });
}

/** Create a team with no members, so walk-ins have somewhere to go. */
export async function createTeam(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Give the team a name." };

  const teamId = push(ref(database, "teams")).key;
  return applyAdminAction({
    action: "team.create",
    summary: `Created the team ${trimmed}`,
    changes: [
      {
        path: `teams/${teamId}`,
        before: null,
        after: { name: trimmed, createdBy: auth.currentUser?.uid ?? "admin", submitted: false },
      },
    ],
  });
}

/** Delete a team, detaching its members rather than orphaning their teamId. */
export async function deleteTeam({ teamId, teamName }) {
  const [teamSnap, competitorsSnap, judgesSnap, finalSnap] = await Promise.all([
    get(ref(database, `teams/${teamId}`)),
    get(ref(database, "competitors")),
    get(ref(database, "judges")),
    get(ref(database, "finalRound/teams")),
  ]);
  if (!teamSnap.exists()) return { ok: false, error: "That team no longer exists." };

  const team = teamSnap.val();
  const changes = [{ path: `teams/${teamId}`, before: team, after: null }];

  for (const [uid, person] of Object.entries(competitorsSnap.val() ?? {})) {
    if (person?.teamId === teamId) {
      changes.push({ path: `competitors/${uid}/teamId`, before: teamId, after: null });
    }
  }

  // every judge holds a copy of the assignment, because they cannot read /teams
  for (const [uid, judge] of Object.entries(judgesSnap.val() ?? {})) {
    if (judge?.teamAssignments?.[teamId]) {
      changes.push({
        path: `judges/${uid}/teamAssignments/${teamId}`,
        before: judge.teamAssignments[teamId],
        after: null,
      });
    }
    if (judge?.finalAssignments?.[teamId]) {
      changes.push({
        path: `judges/${uid}/finalAssignments/${teamId}`,
        before: judge.finalAssignments[teamId],
        after: null,
      });
    }
  }

  // And out of the standings. Without this, deleting a finalist left a team in
  // /finalRound/teams that no longer exists anywhere else -- and the results
  // page ranks whatever is in there, so a deleted team could be shown winning.
  const standing = (finalSnap.exists() ? finalSnap.val() : {})?.[teamId];
  if (standing) {
    changes.push({ path: `finalRound/teams/${teamId}`, before: standing, after: null });
  }

  return applyAdminAction({
    action: "team.delete",
    summary: `Deleted the team ${teamName || teamId}`,
    changes,
  });
}

/** Write any config key, for the settings that have no dedicated control. */
export async function setConfigValue(key, value) {
  const trimmed = String(key ?? "").trim();
  if (!trimmed || trimmed.includes("/")) {
    return { ok: false, error: "Give a single config key, with no slashes." };
  }

  const snap = await get(ref(database, `config/${trimmed}`));
  return applyAdminAction({
    action: "config.set",
    summary: `Set config/${trimmed}`,
    changes: [{ path: `config/${trimmed}`, before: snap.exists() ? snap.val() : null, after: value }],
  });
}

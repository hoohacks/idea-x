import { ref, get, update, push } from "firebase/database";
import { getAuth } from "firebase/auth";
import { database } from "../../firebase.js";

/**
 * Creating, joining and leaving a team.
 *
 * Membership is stored in two places that must agree:
 *
 *   teams/{teamId}/members/{uid} = true      what the rules read
 *   competitors/{uid}/teamId     = teamId    what the app routes on
 *
 * These used to be written as two sequential `set()` calls. If the second one
 * failed -- a dropped connection on venue wifi is the normal case, not the
 * exotic one -- the person ended up a member of a team the app would not route
 * them to, and the create screen would happily let them make a second one. The
 * admin-side equivalent, moveCompetitorToTeam, already got this right with a
 * single multi-path update; this is the same fix for the three flows a
 * competitor actually uses.
 *
 * Realtime Database applies a multi-path update atomically and checks each path
 * against its own rule, both of which a competitor already holds.
 */

/**
 * The largest a team may get.
 *
 * This is advisory, and it is worth being precise about why: Realtime Database
 * rules cannot count children. numChildren() is a client SDK method, and a rule
 * that calls it does not merely fail -- it stops the whole rules file loading.
 * So there is no server-side cap, and someone working from the console can
 * exceed it. It stops the ordinary path, which is what it is for.
 *
 * The closed-after-submission limit below IS enforced in the rules, because
 * that one is expressible.
 */
export const MAX_TEAM_SIZE = 6;

function requireUid() {
  const user = getAuth().currentUser;
  if (!user?.uid) throw new Error("You must be signed in.");
  return user.uid;
}

/**
 * Create a team with this person as creator and only member.
 *
 * Returns { ok, teamId } or { ok: false, error }.
 */
export async function createTeam(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Give the team a name." };

  let uid;
  try {
    uid = requireUid();
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const existing = await get(ref(database, `competitors/${uid}/teamId`));
    if (existing.exists() && existing.val()) {
      return { ok: false, error: "You are already on a team. Leave it before creating another." };
    }

    const teamId = push(ref(database, "teams")).key;

    await update(ref(database), {
      [`teams/${teamId}`]: {
        name: trimmed,
        createdBy: uid,
        // a keyed set, not an array, so the rules can check members.hasChild()
        members: { [uid]: true },
      },
      [`competitors/${uid}/teamId`]: teamId,
    });

    return { ok: true, teamId };
  } catch (error) {
    console.error("Error creating team:", error);
    return { ok: false, error: "Could not create the team. Please try again." };
  }
}

/**
 * Join an existing team by id.
 *
 * **Only `name` is readable here.** Everything else about a team -- including
 * `submitted` and `members` -- is readable by members and the creator only, and
 * whoever is joining is by definition neither. This function used to read all
 * three up front in a `Promise.all`; two of the three were denied every time,
 * the rejection was caught, and every join in the app failed with "Could not
 * join that team. Please try again." Retrying never helped, because the reads
 * were never going to succeed.
 *
 * So the decision is left where it is actually enforceable: the rules. The
 * write to `teams/{id}/members/{uid}` is allowed only if the person holds a
 * competitor record and the team has not submitted, which is the whole of the
 * policy. What this does is attempt it and turn a refusal back into the
 * sentence the person needed.
 *
 * `submitted` and `members` are still read, opportunistically, purely so a
 * refusal can be explained *before* the attempt when the reader happens to be
 * allowed -- an organizer, or somebody rejoining a team they are still on. A
 * denial there is expected and ignored.
 */
export async function joinTeam(teamId) {
  const trimmed = String(teamId ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter a team ID." };

  let uid;
  try {
    uid = requireUid();
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const existing = await get(ref(database, `competitors/${uid}/teamId`));
    if (existing.exists() && existing.val()) {
      return { ok: false, error: "You are already on a team. Leave it before joining another." };
    }

    // the one thing a non-member may read, and the only one this depends on
    const nameSnap = await get(ref(database, `teams/${trimmed}/name`));
    if (!nameSnap.exists()) {
      return { ok: false, error: `No team found with the ID "${trimmed}".` };
    }
    const teamName = nameSnap.val();

    // Best effort. Denied for the person this function is usually for, which is
    // fine: the rules make the same decision a moment later.
    const [submitted, members] = await Promise.all([
      readOrNull(`teams/${trimmed}/submitted`),
      readOrNull(`teams/${trimmed}/members`),
    ]);

    if (submitted === true) return { ok: false, error: closedMessage(teamName) };

    if (members && Object.keys(members).length >= MAX_TEAM_SIZE) {
      return {
        ok: false,
        error: `${teamName} already has ${MAX_TEAM_SIZE} members, which is the maximum. An organizer can add you from the Competitors dashboard if the team is meant to be larger.`,
      };
    }

    try {
      // just this member, so joining cannot drop or reorder anyone else --
      // and deliberately NOT a rewrite of the whole `members` node. A team
      // created before scripts/migrate-team-members.mjs was run still stores
      // members as an array, and landing this write on one turns the node
      // mixed (RTDB drops array-ness the moment a non-numeric key appears):
      // leftover array slots sitting next to this one well-formed entry.
      // Fixing that shape here, by writing the whole migrated node instead of
      // just this key, was considered and rejected -- the rule at
      // members/$memberUid grants a write only where $memberUid === auth.uid,
      // so a joiner has permission to touch their OWN key and nobody else's;
      // a client-side rewrite of every existing member's entry would be
      // refused outright, turning a silently-wrong read into a hard failure
      // for every join on that team. memberIds (teamMembers.js) reads a mixed
      // node correctly regardless of how many more people join it, so there
      // is nothing left for this write to protect against.
      await update(ref(database), {
        [`teams/${trimmed}/members/${uid}`]: true,
        [`competitors/${uid}/teamId`]: trimmed,
      });
    } catch (error) {
      // The write rule refuses for exactly two reasons, so a refusal is not
      // ambiguous: either they have no competitor record, or the team is closed.
      const self = await readOrNull(`competitors/${uid}`);
      if (!self) {
        return {
          ok: false,
          error:
            "Only competitors can join a team. Ask an organizer to add a competitor record to your account.",
        };
      }
      return { ok: false, error: closedMessage(teamName) };
    }

    return { ok: true, teamId: trimmed, teamName };
  } catch (error) {
    console.error("Error joining team:", error);
    return { ok: false, error: "Could not join that team. Please try again." };
  }
}

function closedMessage(teamName) {
  return (
    `${teamName} has already submitted its project, so it is closed to new members. ` +
    `Ask an organizer if you need to be added.`
  );
}

/** A read whose denial is expected and means "cannot tell", not "failed". */
async function readOrNull(path) {
  try {
    const snap = await get(ref(database, path));
    return snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
}

/** Leave a team, clearing both halves of the membership together. */
export async function leaveTeam(teamId) {
  let uid;
  try {
    uid = requireUid();
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    await update(ref(database), {
      [`teams/${teamId}/members/${uid}`]: null,
      [`competitors/${uid}/teamId`]: null,
    });
    return { ok: true };
  } catch (error) {
    console.error("Error leaving team:", error);
    return { ok: false, error: "Could not leave the team. Please try again." };
  }
}

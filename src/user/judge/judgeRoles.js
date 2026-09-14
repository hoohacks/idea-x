import { personName } from "../../roles.js";

/**
 * The two judging roles, as one definition each.
 *
 * An event runs on two kinds of judge. The organizers carry `isRound1Judge`:
 * there are dozens of them, they work the first round, and they are in the room
 * for the final as well. The professors and professionals carry
 * `isFinalRoundJudge`: they come for the final round only, and the first-round
 * generator must never hand them a batch -- they are not in the building yet.
 *
 * Both marks are admin-set; the database rules stop a judge seeding either at
 * registration. Neither implies the other, and somebody who is both an
 * organizer and an industry judge can carry both.
 *
 * This module is pure so that both planners, both drift readers and every
 * picker can share one answer. Two modules disagreeing about who counts is
 * exactly the bug `readLiveBasis` exists to avoid.
 */

/** Works the first round, and is therefore what the generator allocates from. */
export function judgesRoundOne(judge) {
  return judge?.isRound1Judge === true;
}

/**
 * Marked for either round, which is two questions with one answer.
 *
 * It is who works the final round -- organizers and industry judges alike sit
 * in that one room, and the finalists present to it in sequence. It is also
 * everyone an organizer may put on a FIRST round panel by hand: the generator
 * will not seat an industry judge, but if one is standing there when an
 * organizer no-shows, nothing should stop them filling the gap. What they must
 * never be is auto-assigned, which `judgesRoundOne` is what decides.
 */
export function judgesEitherRound(judge) {
  return judge?.isRound1Judge === true || judge?.isFinalRoundJudge === true;
}

/**
 * The judges a per-team picker should offer, in the order it should offer them.
 *
 * Checked-in first, then by name: the useful answer to "who can I put on this
 * team right now" is almost always somebody already in the building, and a
 * picker that buries them under forty absent names is one an organizer scrolls
 * past rather than reads.
 *
 * `finalOnly` marks the judges the generator would never have seated. They are
 * offered because a no-show has to be fillable from whoever is actually there,
 * but seating one is a deliberate reach outside the first-round pool and the
 * picker says so rather than presenting them as ordinary choices.
 */
export function judgePickerOptions(judgesData) {
  return Object.entries(judgesData ?? {})
    .filter(([, judge]) => judgesEitherRound(judge))
    .map(([uid, judge]) => ({
      uid,
      name: personName(judge, "Unnamed Judge"),
      checkedIn: judge?.checkedIn === true,
      finalOnly: !judgesRoundOne(judge),
    }))
    .sort(
      (a, b) => Number(b.checkedIn) - Number(a.checkedIn) || a.name.localeCompare(b.name)
    );
}

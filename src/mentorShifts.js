/**
 * The mentoring shifts, and who is on them.
 *
 * The list lives here rather than in the sign-up form because two things read
 * it: the form offers these shifts, and the organizers' Mentors page lays its
 * roster out along them. A second copy on the page would agree with the form
 * until the day somebody added a 5:00 PM.
 */
export const SHIFTS = ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

/**
 * The shifts on a judge record, as an array whatever shape they came back in.
 *
 * Realtime Database does not store an empty array, so a mentor with no shifts
 * has no `timeslots` at all, and an array with a gap in it comes back keyed.
 */
export function timeslotsOf(record) {
  const slots = record?.timeslots;
  if (!slots) return [];
  return (Array.isArray(slots) ? slots : Object.values(slots)).filter(Boolean);
}

/**
 * How busy a shift is, from 0 to 1, against the busiest one.
 *
 * Relative rather than against a fixed number, because nobody has said how
 * many mentors an hour should have: what the page can honestly show is which
 * hours are thinner than the others.
 */
export function heatOf(count, busiest) {
  return busiest > 0 ? count / busiest : 0;
}

const nameOf =(person) => `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();

/**
 * `/judges` turned round: each shift with the mentors who picked it.
 *
 * Only people who are mentoring are counted. Saying no to mentoring from the
 * edit drawer leaves the shifts on the record, and a roster that still listed
 * them would be promising cover nobody is going to provide.
 *
 * `other` holds any shift the form does not offer -- an older list, a record
 * edited by hand -- so that it shows up rather than vanishing, and
 * `unscheduled` the mentors with no shift at all.
 */
export function shiftRoster(judges) {
  const mentors = Object.entries(judges ?? {})
    .map(([id, record]) => ({ id, ...record }))
    .filter((person) => person.wantsToMentor === true)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const on = (shift) => mentors.filter((person) => timeslotsOf(person).includes(shift));

  const unknown = [...new Set(mentors.flatMap(timeslotsOf))].filter((shift) => !SHIFTS.includes(shift));

  return {
    shifts: SHIFTS.map((shift) => ({ shift, mentors: on(shift) })),
    other: unknown.sort().map((shift) => ({ shift, mentors: on(shift) })),
    unscheduled: mentors.filter((person) => timeslotsOf(person).length === 0),
  };
}

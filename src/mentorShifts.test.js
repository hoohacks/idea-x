import { SHIFTS, heatOf, shiftRoster, timeslotsOf } from "./mentorShifts";

const mentor = (firstName, timeslots, extra = {}) => ({
  firstName, lastName: "Test", wantsToMentor: true, timeslots, ...extra,
});

const names = (mentors) => mentors.map((m) => m.firstName);

test("every shift on the form is listed in order, taken or not", () => {
  const { shifts } = shiftRoster({ a: mentor("Ada", ["2:00 PM", "11:00 AM"]) });

  expect(shifts.map((s) => s.shift)).toEqual(SHIFTS);
  expect(names(shifts[0].mentors)).toEqual(["Ada"]);
  expect(shifts[1].mentors).toEqual([]);
  expect(names(shifts[3].mentors)).toEqual(["Ada"]);
});

test("a shift lists its mentors by name, each carrying the uid it is keyed by", () => {
  const { shifts } = shiftRoster({
    z: mentor("Zed", ["1:00 PM"]),
    a: mentor("Ada", ["1:00 PM"]),
  });

  expect(names(shifts[2].mentors)).toEqual(["Ada", "Zed"]);
  expect(shifts[2].mentors[0].id).toBe("a");
});

test("someone who is not mentoring is on no shift, whatever their record still holds", () => {
  const roster = shiftRoster({
    a: { firstName: "Ada", wantsToMentor: false, timeslots: ["1:00 PM"] },
    b: { firstName: "Bo" },
  });

  expect(roster.shifts.every((s) => s.mentors.length === 0)).toBe(true);
  expect(roster.unscheduled).toEqual([]);
});

test("a mentor with no shifts is kept apart rather than dropped", () => {
  // Realtime Database does not store an empty array, so the field is simply absent
  const roster = shiftRoster({ a: { firstName: "Ada", wantsToMentor: true } });

  expect(names(roster.unscheduled)).toEqual(["Ada"]);
});

test("a shift the form does not offer is listed after the ones it does", () => {
  const roster = shiftRoster({
    a: mentor("Ada", ["9:00 AM", "1:00 PM"]),
    b: mentor("Bo", ["9:00 AM"]),
  });

  expect(roster.other).toEqual([
    { shift: "9:00 AM", mentors: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })] },
  ]);
  // being on an unknown shift is still being on a shift
  expect(roster.unscheduled).toEqual([]);
});

test("timeslots read the same whether they came back as an array or keyed", () => {
  expect(timeslotsOf({ timeslots: ["11:00 AM", "1:00 PM"] })).toEqual(["11:00 AM", "1:00 PM"]);
  // a sparse array comes back from Realtime Database as an object
  expect(timeslotsOf({ timeslots: { 0: "11:00 AM", 2: "1:00 PM" } })).toEqual(["11:00 AM", "1:00 PM"]);
  expect(timeslotsOf({})).toEqual([]);
  expect(timeslotsOf(undefined)).toEqual([]);
});

test("no judges at all is six empty shifts, not a crash", () => {
  const roster = shiftRoster(null);

  expect(roster.shifts).toHaveLength(SHIFTS.length);
  expect(roster.other).toEqual([]);
  expect(roster.unscheduled).toEqual([]);
});

test("a shift's heat is its headcount against the busiest shift", () => {
  expect(heatOf(4, 4)).toBe(1);
  expect(heatOf(1, 4)).toBe(0.25);
  expect(heatOf(0, 4)).toBe(0);
  // nobody anywhere is no heat, not a division by zero
  expect(heatOf(0, 0)).toBe(0);
});

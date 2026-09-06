/**
 * The event start, and the reason it carries an offset.
 *
 * A date-time string with no offset is read as the *reader's* local time. The
 * constant used to have none, so "10:00" meant ten o'clock wherever the phone
 * was: the countdown on the home page ran hours out for anyone not on Eastern
 * time, and the admin panel moved the event every time it was saved. Neither
 * showed up in development, because Charlottesville is Eastern and so is the
 * machine this was written on.
 *
 * So none of these assertions may depend on the zone the suite runs in. They
 * compare against absolute instants and against wall clocks in the event's own
 * zone, both of which are the same answer on any machine.
 */
import {
  EVENT,
  EVENT_START,
  EVENT_TIME_ZONE,
  eventPhase,
  eventLocalToInstant,
  instantToEventLocal,
} from "./eventInfo";

describe("the start is an instant, not a set of digits", () => {
  test("it names a single moment in time", () => {
    // 10:00 Eastern on a day inside daylight time is 14:00 UTC
    expect(new Date(EVENT_START).toISOString()).toBe("2026-10-18T14:00:00.000Z");
  });

  test("the printed date is the event's, not the reader's", () => {
    expect(EVENT.dateLabel).toBe("Sunday, October 18, 2026");
    expect(EVENT.dayLabel).toBe("October 18");
    expect(EVENT.year).toBe(2026);
  });
});

describe("wall clock to instant", () => {
  test("reads what an organizer typed as Eastern", () => {
    expect(eventLocalToInstant("2026-10-18T10:00").toISOString()).toBe("2026-10-18T14:00:00.000Z");
    expect(eventLocalToInstant("2026-10-18T10:00:00").toISOString()).toBe("2026-10-18T14:00:00.000Z");
  });

  test("follows the zone across the daylight saving boundary", () => {
    // the clocks go back on 1 November 2026: -04:00 before, -05:00 after
    expect(eventLocalToInstant("2026-10-31T12:00").toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(eventLocalToInstant("2026-11-30T12:00").toISOString()).toBe("2026-11-30T17:00:00.000Z");
  });

  test("something unparseable stays unparseable rather than becoming a wrong date", () => {
    expect(Number.isNaN(eventLocalToInstant("not a date").getTime())).toBe(true);
    expect(Number.isNaN(eventLocalToInstant("").getTime())).toBe(true);
  });
});

describe("instant to wall clock", () => {
  test("shows an absolute instant as the Eastern time it is", () => {
    // what scripts/seed-event.mjs writes: a UTC instant
    expect(instantToEventLocal("2026-10-18T14:00:00.000Z")).toBe("2026-10-18T10:00");
    expect(instantToEventLocal(EVENT_START)).toBe("2026-10-18T10:00");
  });

  test("midnight is 00, not 24", () => {
    expect(instantToEventLocal("2026-10-18T04:00:00.000Z")).toBe("2026-10-18T00:00");
  });

  test("a round trip through the admin panel does not move the event", () => {
    // the bug this replaces: display sliced the string, save appended seconds,
    // and every press of Save shifted the start by the UTC offset
    const stored = "2026-10-18T14:00:00.000Z";
    const shown = instantToEventLocal(stored);
    expect(eventLocalToInstant(shown).toISOString()).toBe(stored);
  });

  test("an empty or broken value gives an empty field, not \"Invalid Date\"", () => {
    expect(instantToEventLocal("")).toBe("");
    expect(instantToEventLocal("nonsense")).toBe("");
    expect(instantToEventLocal(null)).toBe("");
  });
});

test("the zone is named once and used everywhere", () => {
  expect(EVENT_TIME_ZONE).toBe("America/New_York");
});

/**
 * "In progress" is a claim about right now, and it was made by the countdown
 * simply having run out -- which is true from 10am on the day until the heat
 * death of the site. By November the home page was telling people the event was
 * currently happening.
 */
describe("which part of the day it is", () => {
  const start = new Date(EVENT_START);
  const at = (offsetMs) => new Date(start.getTime() + offsetMs);
  const HOUR = 60 * 60 * 1000;

  test("before it starts", () => {
    expect(eventPhase(start, at(-1))).toBe("before");
    expect(eventPhase(start, at(-30 * 24 * HOUR))).toBe("before");
  });

  test("while it is running", () => {
    expect(eventPhase(start, at(0))).toBe("during");
    expect(eventPhase(start, at(5 * HOUR))).toBe("during");
    // judging ends at 7pm, nine hours in
    expect(eventPhase(start, at(9 * HOUR - 1))).toBe("during");
  });

  test("once it is over, and it stays over", () => {
    expect(eventPhase(start, at(9 * HOUR))).toBe("after");
    expect(eventPhase(start, at(24 * HOUR))).toBe("after");
    expect(eventPhase(start, at(365 * 24 * HOUR))).toBe("after");
  });

  test("an unreadable start reads as before, not as happening now", () => {
    expect(eventPhase("not a date", start)).toBe("before");
    expect(eventPhase(null, start)).toBe("before");
  });
});

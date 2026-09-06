/**
 * Everything about this year's event, in one place. Dates and years used to be
 * hardcoded across the registration forms, the footer and the countdown, which
 * is how the site ended up advertising 2025 with a 2026 graduation list.
 *
 * The countdown also reads `config/eventStart` from the database when it is
 * set, so the date can be moved without a deploy; this is the fallback.
 */

/**
 * The event happens in Charlottesville, so every time this app shows is Eastern
 * -- including the ones written as plain text ("10:00 AM - 7:00 PM").
 */
export const EVENT_TIME_ZONE = "America/New_York";

/**
 * The start, as an absolute instant.
 *
 * The offset is not decoration. A date-time string without one is read as the
 * *reader's* local time, so this constant used to mean 10:00 wherever the phone
 * happened to be: the countdown ran three hours late for anyone on Pacific time
 * and eleven hours early for anyone whose clock was still set to home. It was
 * invisible here because Charlottesville is Eastern, which is where it was
 * always tested.
 *
 * October 18th is inside daylight time; the clocks go back on November 1st.
 */
export const EVENT_START = "2026-10-18T10:00:00-04:00";

const start = new Date(EVENT_START);

/**
 * How long the day runs, so "in progress" can stop being true.
 *
 * The countdown showed a live "In progress" badge for any start time in the
 * past -- which is every moment after 10am on the day, for ever. The site is up
 * all year, so by November it was telling people the event was happening.
 *
 * A duration rather than an end instant, because config/eventStart can move the
 * start without a deploy and an absolute end would be left behind.
 */
export const EVENT_DURATION_MS = 9 * 60 * 60 * 1000; // 10:00 to 19:00

/**
 * "before" | "during" | "after", for a given start and clock.
 *
 * Pure, and takes `now`, so the three states are testable without waiting for
 * October.
 */
export function eventPhase(start, now = new Date()) {
  const startedAt = start instanceof Date ? start : new Date(String(start ?? ""));
  if (Number.isNaN(startedAt.getTime())) return "before";

  const elapsed = now.getTime() - startedAt.getTime();
  if (elapsed < 0) return "before";
  return elapsed < EVENT_DURATION_MS ? "during" : "after";
}

/** The offset the event's zone is at around a given instant, as "-04:00". */
function zoneOffsetAt(instant) {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: EVENT_TIME_ZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
    // "GMT-04:00", or a bare "GMT" when the zone is sitting on UTC
    const offset = (name ?? "").replace("GMT", "");
    return offset || "+00:00";
  } catch {
    // an engine too old for longOffset: better the event's standard time than
    // silently falling back to the reader's
    return "-05:00";
  }
}

/**
 * A wall-clock time in the event's zone -> the instant it refers to.
 *
 * `datetime-local` inputs speak wall clock and nothing else, so this is what
 * turns what an organizer typed into something that means the same thing on
 * every device.
 */
export function eventLocalToInstant(wallClock) {
  const trimmed = String(wallClock ?? "").trim().slice(0, 19);
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;

  // Read it as UTC first, only to land near the right date; then ask the zone
  // what its offset was there and read it again for real.
  const approximate = new Date(`${withSeconds}Z`);
  if (Number.isNaN(approximate.getTime())) return new Date(NaN);
  return new Date(`${withSeconds}${zoneOffsetAt(approximate)}`);
}

/** An instant -> the "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
export function instantToEventLocal(value) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export const EVENT = {
  name: "Ideathon",
  edition: "sixth annual",
  year: Number(instantToEventLocal(start).slice(0, 4)),
  start,
  // "Sunday, October 18, 2026"
  dateLabel: start.toLocaleDateString("en-US", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }),
  // "October 18th"
  dayLabel: start.toLocaleDateString("en-US", {
    timeZone: EVENT_TIME_ZONE,
    month: "long",
    day: "numeric",
  }),
  hours: "10:00 AM – 7:00 PM",
  judgingHours: "5:00 PM – 7:00 PM",
  venue: "Rice Hall",
  siteUrl: "https://ideathon.hoohacks.io",
};

// Graduation years offered on the registration form: this year's class through
// four years out, so the list never goes stale.
export const GRADUATION_YEARS = Array.from(
  { length: 5 },
  (_, i) => EVENT.year + i
);

export default EVENT;

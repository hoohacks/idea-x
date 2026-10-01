/**
 * The event's fixed facts and the time helpers' boundaries.
 *
 * eventInfo.test.js covers the time zone behaviour; this pins the facts printed
 * on every page (name, venue, schools, graduation years) and the edges of each
 * helper: the exact end of the day, the 48-hour switch to days, the fallbacks
 * when the browser's Intl support is missing.
 */
import {
  EVENT,
  EVENT_START,
  EVENT_DURATION_MS,
  GRADUATION_YEARS,
  SCHOOLS,
  describeRemaining,
  eventLocalToInstant,
  eventPhase,
  formatEventTime,
  instantToEventLocal,
  schoolLabel,
} from "./eventInfo";

const HOUR = 60 * 60 * 1000;

describe("the event's facts", () => {
  test("are what every page prints", () => {
    expect(EVENT_START).toBe("2026-10-25T10:00:00-04:00");
    expect(EVENT).toEqual({
      name: "Ideathon",
      edition: "sixth annual",
      year: 2026,
      start: new Date("2026-10-25T14:00:00Z"),
      dateLabel: "Sunday, October 25, 2026",
      dayLabel: "October 25",
      hours: "10:00 AM - 7:00 PM",
      judgingHours: "5:00 PM - 7:00 PM",
      venue: "Rice Hall",
      siteUrl: "https://ideathon.hoohacks.io",
    });
  });

  test("the day runs nine hours", () => {
    expect(EVENT_DURATION_MS).toBe(9 * HOUR);
  });

  test("graduation years run from this year's class to four years out", () => {
    expect(GRADUATION_YEARS).toEqual([2026, 2027, 2028, 2029, 2030]);
  });

  test("the schools offered, in the order the form shows them", () => {
    expect(SCHOOLS).toEqual([
      ["college", "College of Arts and Sciences"],
      ["engineering", "School of Engineering and Applied Science"],
      ["commerce", "McIntire School of Commerce"],
      ["architecture", "School of Architecture"],
      ["wise", "UVA's College at Wise"],
      ["medicine", "School of Medicine"],
      ["law", "School of Law"],
      ["business", "Darden School of Business"],
      ["education", "School of Education and Human Development"],
      ["professional", "School of Continuing & Professional Studies"],
    ]);
  });

  test("a school is spelled out, a retired one too, and anything else is shown as given", () => {
    expect(schoolLabel(" law ")).toBe("School of Law");
    expect(schoolLabel("other")).toBe("Not a UVA student");
    expect(schoolLabel("mit")).toBe("mit");
    expect(schoolLabel("")).toBe("");
    expect(schoolLabel(undefined)).toBe("");
    expect(schoolLabel("toString")).toBe("toString");
  });
});

describe("which part of the day", () => {
  const start = new Date(EVENT_START);
  const at = (ms) => new Date(start.getTime() + ms);

  test("the last millisecond is still during, and nine hours on is after", () => {
    expect(eventPhase(start, at(9 * HOUR - 1))).toBe("during");
    expect(eventPhase(start, at(9 * HOUR))).toBe("after");
    expect(eventPhase(start, at(0))).toBe("during");
    expect(eventPhase(start, at(-1))).toBe("before");
  });

  test("a start given as text is read, and nothing at all is before", () => {
    expect(eventPhase(EVENT_START, at(HOUR))).toBe("during");
    expect(eventPhase(undefined, at(HOUR))).toBe("before");
  });

  test("defaults to now", () => {
    expect(eventPhase(new Date(Date.now() - HOUR))).toBe("during");
  });
});

describe("wall clock to instant", () => {
  test("accepts seconds, surrounding spaces, and drops anything past the seconds", () => {
    const expected = new Date("2026-10-25T13:30:15-04:00").getTime();
    expect(eventLocalToInstant("2026-10-25T13:30:15").getTime()).toBe(expected);
    expect(eventLocalToInstant("  2026-10-25T13:30:15  ").getTime()).toBe(expected);
    expect(eventLocalToInstant("2026-10-25T13:30:15.999Z").getTime()).toBe(expected);
    expect(eventLocalToInstant("2026-10-25T13:30").getTime()).toBe(new Date("2026-10-25T13:30:00-04:00").getTime());
  });

  test("nothing is not a date", () => {
    expect(Number.isNaN(eventLocalToInstant(undefined).getTime())).toBe(true);
  });

  describe("when the browser cannot name the zone's offset", () => {
    const RealFormat = Intl.DateTimeFormat;
    afterEach(() => {
      Intl.DateTimeFormat = RealFormat;
    });

    test("an engine without longOffset falls back to Eastern standard time", () => {
      Intl.DateTimeFormat = function Broken(locale, options) {
        if (options?.timeZoneName === "longOffset") throw new RangeError("unsupported");
        return new RealFormat(locale, options);
      };
      expect(eventLocalToInstant("2026-07-01T12:00").toISOString()).toBe("2026-07-01T17:00:00.000Z");
    });

    test("a zone sitting on UTC, printed as bare GMT, is no offset", () => {
      Intl.DateTimeFormat = function Utc(locale, options) {
        if (options?.timeZoneName !== "longOffset") return new RealFormat(locale, options);
        return { formatToParts: () => [{ type: "timeZoneName", value: "GMT" }] };
      };
      expect(eventLocalToInstant("2026-07-01T12:00").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    });

    test("no zone part at all is no offset", () => {
      Intl.DateTimeFormat = function Missing(locale, options) {
        if (options?.timeZoneName !== "longOffset") return new RealFormat(locale, options);
        return { formatToParts: () => [] };
      };
      expect(eventLocalToInstant("2026-07-01T12:00").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    });
  });
});

describe("instant to wall clock", () => {
  test("reads a timestamp given as text or a number", () => {
    expect(instantToEventLocal("2026-10-25T21:05:00Z")).toBe("2026-10-25T17:05");
    expect(instantToEventLocal(new Date("2026-10-25T21:05:00Z").toISOString())).toBe("2026-10-25T17:05");
    expect(instantToEventLocal(undefined)).toBe("");
  });
});

describe("saying a time", () => {
  test("an unreadable time says nothing", () => {
    expect(formatEventTime("not a time")).toBe("");
  });

  test("defaults to comparing against now", () => {
    expect(formatEventTime(Date.now())).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });
});

describe("time left", () => {
  test("rounds down to the minute, and never goes negative", () => {
    expect(describeRemaining(59_999)).toBe("under a minute");
    expect(describeRemaining(-5)).toBe("under a minute");
    expect(describeRemaining(60_000)).toBe("1 minute");
    expect(describeRemaining(119_999)).toBe("1 minute");
    expect(describeRemaining(2 * 60_000)).toBe("2 minutes");
  });

  test("hours and minutes, then hours alone on the hour", () => {
    expect(describeRemaining(HOUR)).toBe("1 hour");
    expect(describeRemaining(HOUR + 60_000)).toBe("1 hour 1 minute");
    expect(describeRemaining(2 * HOUR + 5 * 60_000)).toBe("2 hours 5 minutes");
  });

  test("switches to days at exactly 48 hours, rounding down", () => {
    expect(describeRemaining(47 * HOUR + 59 * 60_000)).toBe("47 hours 59 minutes");
    expect(describeRemaining(48 * HOUR)).toBe("2 days");
    expect(describeRemaining(71 * HOUR)).toBe("2 days");
    expect(describeRemaining(72 * HOUR)).toBe("3 days");
  });
});

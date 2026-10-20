import { describe, expect, it } from "vitest";
import { parseIcsBusy, overlapsBusy, maskFeedUrl } from "../src/worker/calendar/ics";

const NOW = new Date("2026-05-04T08:00:00.000Z");

const ics = (events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events.flatMap((e) => e.split("\n")),
    "END:VCALENDAR",
  ].join("\r\n");

describe("parseIcsBusy", () => {
  it("parses a plain timed event into an interval", () => {
    const result = parseIcsBusy(
      ics([
        [
          "BEGIN:VEVENT",
          "DTSTART:20260506T090000Z",
          "DTEND:20260506T170000Z",
          "SUMMARY:Site visit",
          "END:VEVENT",
        ].join("\n"),
      ]),
      NOW,
    );
    expect(result.eventCount).toBe(1);
    expect(result.unparsedCount).toBe(0);
    expect(result.intervals).toEqual([
      { startUtc: "2026-05-06T09:00:00.000Z", endUtc: "2026-05-06T17:00:00.000Z" },
    ]);
  });

  it("clips events outside the 90-day forward window", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:20270106T090000Z\nDTEND:20270106T100000Z\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.eventCount).toBe(1);
    expect(result.intervals).toEqual([]);
  });

  it("handles all-day events as full-day blocks", () => {
    const result = parseIcsBusy(
      ics(["BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260510\nDTEND;VALUE=DATE:20260511\nEND:VEVENT"]),
      NOW,
    );
    expect(result.intervals).toEqual([
      { startUtc: "2026-05-10T00:00:00.000Z", endUtc: "2026-05-11T00:00:00.000Z" },
    ]);
  });

  it("defaults an event without DTEND to a 1-hour block", () => {
    const result = parseIcsBusy(
      ics(["BEGIN:VEVENT\nDTSTART:20260506T090000Z\nEND:VEVENT"]),
      NOW,
    );
    expect(result.intervals).toEqual([
      { startUtc: "2026-05-06T09:00:00.000Z", endUtc: "2026-05-06T10:00:00.000Z" },
    ]);
  });

  it("expands DAILY RRULE within the window and honours COUNT", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:20260506T090000Z\nDTEND:20260506T100000Z\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.intervals).toHaveLength(3);
    expect(result.intervals[0]!.startUtc).toBe("2026-05-06T09:00:00.000Z");
    expect(result.intervals[2]!.startUtc).toBe("2026-05-08T09:00:00.000Z");
  });

  it("expands WEEKLY RRULE with UNTIL", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:20260506T090000Z\nDTEND:20260506T100000Z\nRRULE:FREQ=WEEKLY;UNTIL=20260520T090000Z\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.intervals).toHaveLength(3); // May 6, 13, 20
  });

  it("counts exotic RRULEs as a single occurrence, not an expansion", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:20260506T090000Z\nDTEND:20260506T100000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=13\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.eventCount).toBe(1);
    expect(result.intervals).toHaveLength(1);
    expect(result.unparsedCount).toBe(0);
  });

  it("skips cancelled and transparent events", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:20260506T090000Z\nDTEND:20260506T100000Z\nSTATUS:CANCELLED\nEND:VEVENT",
        "BEGIN:VEVENT\nDTSTART:20260507T090000Z\nDTEND:20260507T100000Z\nTRANSP:TRANSPARENT\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.intervals).toEqual([]);
    expect(result.eventCount).toBe(0);
  });

  it("counts malformed events as unparsed without dying", () => {
    const result = parseIcsBusy(
      ics([
        "BEGIN:VEVENT\nDTSTART:not-a-date\nDTEND:20260506T100000Z\nEND:VEVENT",
        "BEGIN:VEVENT\nDTSTART:20260506T090000Z\nDTEND:20260506T080000Z\nEND:VEVENT",
      ]),
      NOW,
    );
    expect(result.intervals).toEqual([]);
    expect(result.unparsedCount).toBe(2);
  });

  it("unfolds line continuations", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260506T09",
      " 0000Z",
      "DTEND:20260506T100000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = parseIcsBusy(text, NOW);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]!.startUtc).toBe("2026-05-06T09:00:00.000Z");
  });
});

describe("overlapsBusy", () => {
  const intervals = [
    { startUtc: "2026-05-06T09:00:00.000Z", endUtc: "2026-05-06T17:00:00.000Z" },
  ];

  it("detects overlap inside an event", () => {
    expect(overlapsBusy(intervals, "2026-05-06T10:00:00.000Z", "2026-05-06T12:00:00.000Z")).toBeTruthy();
  });

  it("detects overlap spanning an event", () => {
    expect(overlapsBusy(intervals, "2026-05-06T00:00:00.000Z", "2026-05-07T00:00:00.000Z")).toBeTruthy();
  });

  it("clears a non-overlapping range", () => {
    expect(overlapsBusy(intervals, "2026-05-06T17:00:00.000Z", "2026-05-06T20:00:00.000Z")).toBeNull();
  });
});

describe("maskFeedUrl", () => {
  it("keeps host, hides the secret path", () => {
    const masked = maskFeedUrl(
      "https://calendar.google.com/calendar/ical/c_abcd1234/private-secretkey/basic.ics",
    );
    expect(masked).toBe("https://calendar.google.com/…asic.ics");
    expect(masked).not.toContain("private-");
    expect(masked).not.toContain("c_abcd1234");
  });
});

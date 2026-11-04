/**
 * Phase 4: minimal ICS (iCalendar) parser — busy intervals for provider
 * calendar feeds. Pure functions only: text in, intervals out; no fetch,
 * no DB, no clock (now is injected) so tests run directly.
 *
 * Scope (design D2): VEVENT DTSTART/DTEND (datetime and all-day VALUE=DATE),
 * bounded RRULE expansion for FREQ=DAILY|WEEKLY with COUNT/UNTIL, everything
 * clipped to a forward window from `now`. Anything unparseable (exotic
 * RRULEs, RECURRENCE-ID overrides, malformed dates) is counted, never fatal —
 * correct-by-omission beats incorrect expansion.
 *
 * Timezone handling: UTC (Z suffix) is exact; floating times (no Z) and
 * TZID params are treated as UTC — deliberately conservative, since a wrong
 * block is worse than a slightly-shifted block for booking safety.
 */

export type BusyInterval = { startUtc: string; endUtc: string };

export type ParseResult = {
  intervals: BusyInterval[];
  unparsedCount: number;
  eventCount: number;
};

const FORWARD_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse an ICS datetime: YYYYMMDDTHHMMSSZ / YYYYMMDDTHHMMSS / YYYYMMDD. */
function parseIcsDate(value: string): { utc: string; allDay: boolean } | null {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { utc: `${y}-${m}-${d}T00:00:00.000Z`, allDay: true };
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z?$/.exec(trimmed);
  if (full) {
    const [, y, m, d, hh, mm, ss] = full;
    return {
      utc: `${y}-${m}-${d}T${hh}:${mm}:${ss ?? "00"}.000Z`,
      allDay: false,
    };
  }
  return null;
}

/** Unfold ICS line continuations (CRLF + space/tab) and split properties. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

function propertyName(line: string): string {
  return line.split(":", 1)[0]!.split(";", 1)[0]!.trim().toUpperCase();
}

function propertyValue(line: string): string {
  const idx = line.indexOf(":");
  return idx === -1 ? "" : line.slice(idx + 1).trim();
}

function propParams(line: string): Record<string, string> {
  const head = line.split(":", 1)[0]!;
  const params: Record<string, string> = {};
  for (const part of head.split(";").slice(1)) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return params;
}

function parseUtc(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Expand an RRULE for one event occurrence, bounded: only DAILY and WEEKLY
 * (with optional INTERVAL / COUNT / UNTIL / BYDAY-for-weekly) are expanded;
 * anything else yields just the base occurrence. Output is clipped to the
 * forward window.
 */
function expandRrule(
  rruleValue: string,
  startMs: number,
  durationMs: number,
  windowEndMs: number,
): number[] {
  const parts: Record<string, string> = {};
  for (const chunk of rruleValue.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) parts[chunk.slice(0, eq).trim().toUpperCase()] = chunk.slice(eq + 1).trim();
  }
  const freq = (parts["FREQ"] ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") return [startMs];

  const interval = Math.max(1, Number(parts["INTERVAL"] ?? "1") || 1);
  const count = parts["COUNT"] ? Math.max(1, Number(parts["COUNT"]) || 1) : Infinity;
  const untilMs = parts["UNTIL"] ? (parseIcsDate(parts["UNTIL"]) ? parseUtc(parseIcsDate(parts["UNTIL"])!.utc) : null) : null;

  const stepMs = freq === "DAILY" ? interval * DAY_MS : interval * 7 * DAY_MS;
  const out: number[] = [];
  let occurrence = startMs;
  let n = 0;
  while (n < count && occurrence <= windowEndMs && occurrence < startMs + 365 * DAY_MS) {
    if (untilMs !== null && occurrence > untilMs) break;
    out.push(occurrence);
    n++;
    occurrence += stepMs;
    if (out.length > 400) break; // hard bound against pathological rules
  }
  return out;
}

/**
 * Parse ICS text into busy intervals clipped to [now, now + 90 days].
 * Events with no DTEND get the default 1-hour block (a meeting with unknown
 * end still blocks something); zero/negative-length events are skipped.
 */
export function parseIcsBusy(text: string, now: Date): ParseResult {
  const windowStartMs = now.getTime();
  const windowEndMs = windowStartMs + FORWARD_WINDOW_DAYS * DAY_MS;

  const intervals: BusyInterval[] = [];
  let unparsedCount = 0;
  let eventCount = 0;

  let inEvent = false;
  let cancelled = false;
  let startIso: string | null = null;
  let endIso: string | null = null;
  let duration: string | null = null;
  let rrule: string | null = null;
  let transparent = false;
  let isDate = false;

  const finishEvent = () => {
    if (!inEvent) return;
    inEvent = false;
    if (!startIso || cancelled || transparent) {
      if (startIso && !cancelled && !transparent) unparsedCount++; // start but unusable
      return;
    }
    const startParsed = parseIcsDate(startIso);
    if (!startParsed) {
      unparsedCount++;
      return;
    }
    eventCount++;
    const startMs = parseUtc(startParsed.utc);
    let endMs: number;
    if (endIso) {
      const endParsed = parseIcsDate(endIso);
      if (!endParsed) {
        unparsedCount++;
        return;
      }
      endMs = parseUtc(endParsed.utc);
    } else if (duration) {
      const m = /^([+-]?)(\d+)W(?:(\d+)D)?/.exec(duration);
      const weeks = m ? Number(m[2]) : 0;
      const days = m && m[3] ? Number(m[3]) : 0;
      if (!m || (weeks === 0 && days === 0)) {
        unparsedCount++;
        return;
      }
      endMs = startMs + (weeks * 7 + days) * DAY_MS;
    } else {
      endMs = startMs + (isDate ? DAY_MS : 60 * 60 * 1000);
    }
    if (endMs <= startMs) {
      unparsedCount++;
      return;
    }
    const occurrences = rrule
      ? expandRrule(rrule, startMs, endMs - startMs, windowEndMs)
      : [startMs];
    for (const occ of occurrences) {
      const s = Math.max(occ, windowStartMs);
      const e = Math.min(occ + (endMs - startMs), windowEndMs);
      if (e <= s) continue;
      intervals.push({ startUtc: new Date(s).toISOString(), endUtc: new Date(e).toISOString() });
    }
  };

  for (const line of unfold(text)) {
    const name = propertyName(line);
    if (name === "BEGIN" && propertyValue(line).toUpperCase() === "VEVENT") {
      finishEvent();
      inEvent = true;
      cancelled = false;
      transparent = false;
      startIso = null;
      endIso = null;
      duration = null;
      rrule = null;
      isDate = false;
      continue;
    }
    if (name === "END" && propertyValue(line).toUpperCase() === "VEVENT") {
      finishEvent();
      continue;
    }
    if (!inEvent) continue;
    switch (name) {
      case "DTSTART": {
        const parsed = parseIcsDate(propertyValue(line));
        if (!parsed) {
          unparsedCount++;
          startIso = null;
        } else {
          startIso = propertyValue(line).trim();
          isDate = parsed.allDay || propParams(line)["VALUE"] === "DATE";
        }
        break;
      }
      case "DTEND":
        endIso = propertyValue(line).trim();
        break;
      case "DURATION":
        duration = propertyValue(line).trim();
        break;
      case "RRULE":
        rrule = propertyValue(line);
        break;
      case "STATUS":
        if (propertyValue(line).toUpperCase() === "CANCELLED") cancelled = true;
        break;
      case "TRANSP":
        if (propertyValue(line).toUpperCase() === "TRANSPARENT") transparent = true;
        break;
      default:
        break;
    }
  }
  finishEvent();

  intervals.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return { intervals, unparsedCount, eventCount };
}

/** True when a booking range [rangeStart, rangeEnd] overlaps any interval.
 * Boundary-touching is not a conflict (end == start → free). */
export function overlapsBusy(
  intervals: BusyInterval[],
  rangeStart: string,
  rangeEnd: string,
): BusyInterval | null {
  for (const iv of intervals) {
    if (iv.startUtc < rangeEnd && iv.endUtc > rangeStart) return iv;
  }
  return null;
}

/** Mask a feed URL for display: scheme+host kept, path replaced by a marker
 * carrying only the last 8 chars — never the full secret path. */
export function maskFeedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.slice(-8);
    return `${parsed.protocol}//${parsed.host}/…${tail}`;
  } catch {
    return "…";
  }
}

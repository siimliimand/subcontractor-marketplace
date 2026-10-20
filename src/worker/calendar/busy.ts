import { and, eq, lte, gte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { calendarBusyIntervals } from "../db/schema";
import type { BusyInterval } from "./ics";

/**
 * Booking-side consult of imported busy intervals (design D4): the calendar
 * is the stronger signal — a declared-free slot still blocks when the
 * provider's calendar says busy. Checked at the route layer (not a trigger):
 * intervals are advisory derived data refreshed hourly, and the declaration
 * triggers remain the hard capacity invariant.
 *
 * Booking ranges are date-only (YYYY-MM-DD); the check window spans the full
 * days UTC — conservative, since a wrong "free" is worse than a wrong "busy".
 */

function dayWindow(startDate: string, endDate: string): { from: string; to: string } {
  return {
    from: `${startDate}T00:00:00.000Z`,
    to: `${endDate}T23:59:59.999Z`,
  };
}

/** The first overlapping interval for a company, or null when free. */
export async function findCalendarConflict(
  db: DrizzleD1Database,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<BusyInterval | null> {
  const { from, to } = dayWindow(startDate, endDate);
  const rows = await db
    .select()
    .from(calendarBusyIntervals)
    .where(
      and(
        eq(calendarBusyIntervals.companyId, companyId),
        lte(calendarBusyIntervals.startUtc, to),
        gte(calendarBusyIntervals.endUtc, from),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { startUtc: row.startUtc, endUtc: row.endUtc } : null;
}

/** Calendar-conflict rejection payload — deliberately opaque about the
 * feed's contents (no event names, no times beyond the requested range). */
export function calendarConflictResponse(conflict: BusyInterval) {
  return {
    error: "calendar_conflict",
    message: "provider calendar is busy for the requested range",
    conflict: { startUtc: conflict.startUtc, endUtc: conflict.endUtc },
  };
}

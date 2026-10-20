import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { holds, HOLD_TTL_MS } from "./db/schema";

/**
 * Holds are advisory 48-hour reservations on provider capacity, gated behind
 * the BOOKING_HOLDS_ENABLED flag. Expiry is lazy: any read or write over holds
 * first flips active holds past their `expiresAt` to `expired` in the same
 * statement, so no cron is needed.
 */

/** Lazily expire due holds; returns the number expired. */
export async function expireDueHolds(db: DrizzleD1Database): Promise<number> {
  const result = await db
    .update(holds)
    .set({ state: "expired", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(holds.state, "active"),
        sql`${holds.expiresAt} < ${new Date().toISOString()}`,
      ),
    )
    .returning();
  return result.length;
}

export function holdsEnabled(env: { BOOKING_HOLDS_ENABLED?: string }): boolean {
  return env.BOOKING_HOLDS_ENABLED === "true";
}

export function holdExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + HOLD_TTL_MS).toISOString();
}

/**
 * Active (non-expired) holds overlapping the given range for a provider+trade.
 * Callers should run expireDueHolds first (or in the same batch).
 */
export function overlappingHoldCondition(companyId: string, trade: string, dateFrom: string, dateTo: string) {
  return and(
    eq(holds.companyId, companyId),
    eq(holds.trade, trade),
    eq(holds.state, "active"),
    sql`${holds.startDate} <= ${dateTo}`,
    sql`${holds.endDate} >= ${dateFrom}`,
  );
}

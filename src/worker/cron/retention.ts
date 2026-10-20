import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type RetentionResult = {
  tokensDeleted: number;
  holdsDeleted: number;
  intervalsDeleted: number;
};

/**
 * Phase 3: config-driven retention purge, run from the scheduled handler.
 *
 * - Email tokens expired longer than `tokenRetentionDays` are deleted (the
 *   response they reference lives on; only the dead credential goes).
 * - Holds in a terminal state (expired / released / superseded) older than
 *   `holdRetentionDays` are deleted; active holds are never touched.
 * - Phase 4: busy intervals from feeds stale beyond `intervalRetentionDays`
 *   are purged — derived calendar data must not accumulate indefinitely. The
 *   feed row itself is kept for staff review.
 *
 * Bookings, audit events, requests, and responses are never purged here —
 * the funnel history is the product. Counts are returned for logging, not
 * written to the audit trail (funnel events stay funnel-only).
 */
export async function purgeExpiredArtifacts(
  db: DrizzleD1Database,
  opts: {
    now: Date;
    tokenRetentionDays: number;
    holdRetentionDays: number;
    intervalRetentionDays?: number;
  },
): Promise<RetentionResult> {
  const tokenCutoff = new Date(
    opts.now.getTime() - opts.tokenRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const holdCutoff = new Date(
    opts.now.getTime() - opts.holdRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const tokens = await db.run(sql`
    DELETE FROM email_tokens
    WHERE expiresAt < ${tokenCutoff}
  `);
  const holds = await db.run(sql`
    DELETE FROM holds
    WHERE state IN ('expired', 'released', 'superseded')
      AND updatedAt < ${holdCutoff}
  `);

  // Phase 4: intervals whose feed has not fetched successfully within the
  // retention window (default 14 days — twice the default staleness window).
  let intervalsDeleted = 0;
  const intervalDays = opts.intervalRetentionDays ?? 14;
  if (intervalDays > 0) {
    const intervalCutoff = new Date(
      opts.now.getTime() - intervalDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const intervals = await db.run(sql`
      DELETE FROM calendar_busy_intervals
      WHERE feedId IN (
        SELECT id FROM calendar_feeds
        WHERE state != 'active'
           OR lastSuccessAt IS NULL
           OR lastSuccessAt < ${intervalCutoff}
      )
    `);
    intervalsDeleted = intervals.meta.changes ?? 0;
  }

  return {
    tokensDeleted: tokens.meta.changes ?? 0,
    holdsDeleted: holds.meta.changes ?? 0,
    intervalsDeleted,
  };
}

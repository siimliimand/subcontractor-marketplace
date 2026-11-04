import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEventStatement } from "../events";
import { outreachEntries } from "../db/schema";

// ---------------------------------------------------------------------------
// SUBC-011: stale-sent resolution sweep.
//
// With no provider lifecycle signal arriving at all, an email-channel entry
// would stay 'sent' forever (the original dormant-consumer symptom). After a
// configurable window (EMAIL_RESOLVE_AFTER_MINUTES, default 10) with no
// bounce, the message is settled as an explicitly-marked INFERRED delivery:
// the audit payload carries { inferred: true, reason:
// "resolution_window_elapsed", source: "resolution" } so inferred deliveries
// stay honestly distinguishable from provider-confirmed ones.
//
// Runs every 5 minutes (cron */5) — window + sweep bounds settle time to
// ~15 minutes. A late real bounce still wins afterwards: 'bounced' is legal
// from 'delivered'. Manual/matching-channel and null-status entries are
// never touched.
// ---------------------------------------------------------------------------

export type StaleSentRow = {
  id: string;
  requestId: string;
  companyId: string;
};

/**
 * Resolves email-channel entries still 'sent' past the window to inferred
 * 'delivered'. Returns the resolved entry ids (for logging). Idempotent: a
 * re-run finds nothing left to resolve.
 */
export async function resolveStaleSentEmails(
  db: DrizzleD1Database,
  opts: { now: Date; resolveAfterMinutes: number; limit?: number },
): Promise<string[]> {
  const cutoff = new Date(opts.now.getTime() - opts.resolveAfterMinutes * 60_000).toISOString();
  const stale = (await db.all<StaleSentRow>(sql`
    SELECT e.id AS id, e.requestId AS requestId, e.companyId AS companyId
    FROM outreach_entries e
    WHERE e.channel = 'email' AND e.emailStatus = 'sent' AND e.sentAt < ${cutoff}
    ORDER BY e.sentAt ASC
    LIMIT ${opts.limit ?? 500}
  `)) as unknown as StaleSentRow[];
  if (stale.length === 0) return [];

  // Two-phase CAS: first every guarded transition (with .returning so we
  // learn which rows THIS sweep actually settled), then one audit event per
  // row that genuinely transitioned. A concurrent producer (webhook, inbound
  // DSN, pixel) that already moved an entry between the SELECT above and
  // these updates makes its update a no-op — and then no audit event is
  // written either, so a single real transition never yields two
  // email_delivered events (the /overview delivered count reads those).
  const transitionResults = (await db.batch(
    stale.map((row) =>
      db
        .update(outreachEntries)
        .set({ emailStatus: "delivered" })
        .where(
          and(
            eq(outreachEntries.id, row.id),
            eq(outreachEntries.emailStatus, "sent"),
            eq(outreachEntries.channel, "email"),
          ),
        )
        .returning({ id: outreachEntries.id }),
    ) as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  )) as unknown as { id: string }[][];
  const resolvedRows = stale.filter((_, i) => (transitionResults[i] ?? []).length > 0);
  if (resolvedRows.length === 0) return [];

  await db.batch(
    resolvedRows.map((row) =>
      auditEventStatement(db, {
        actorUserId: null,
        actorEmail: null,
        entity: "outreach_entry",
        entityId: row.id,
        action: "email_delivered",
        channel: "automated",
        payload: {
          inferred: true,
          reason: "resolution_window_elapsed",
          resolveAfterMinutes: opts.resolveAfterMinutes,
          source: "resolution",
          requestId: row.requestId,
          companyId: row.companyId,
        },
      }),
    ) as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  );

  return resolvedRows.map((row) => row.id);
}

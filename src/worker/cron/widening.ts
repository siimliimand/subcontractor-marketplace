import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEventStatement } from "../events";
import { listTrades } from "../catalog";
import type { Trade } from "../config";
import { findCalendarConflict } from "../calendar/busy";
import { outreachEntries, requestTrades, requests, responses } from "../db/schema";
import { selectCandidates, WIDENED_BATCH_SIZE } from "../matching/engine";

export type WidenOutcome = {
  requestId: string;
  trade: string;
  created: number;
};

export type WidenActor = { id: string | null; email: string | null };

/**
 * Phase 3: timeout-triggered widening. A request sitting in outreach with a
 * matching batch but no qualified response past `timeoutHours` is widened
 * once toward the widened batch size — the same widening the manual route
 * performs, attributed to the system (actor null, channel automated) and
 * marked with a `widening_timeout` reason in the event payload.
 *
 * Fires at most once per request (the `-w` batch suffix is the guard) and
 * never when a qualified response already arrived.
 */
export async function widenTimedOutRequests(
  db: DrizzleD1Database,
  opts: {
    now: Date;
    timeoutHours: number;
    actor: WidenActor | null;
    limit?: number;
  },
): Promise<WidenOutcome[]> {
  const cutoff = new Date(opts.now.getTime() - opts.timeoutHours * 60 * 60 * 1000).toISOString();

  // Requests in outreach whose matching batch predates the cutoff and which
  // have never been widened. Batch age = earliest matching entry (`sentAt` is
  // the entry's creation timestamp).
  const candidateRows = (await db.all<{ id: string; firstMatchedAt: string }>(sql`
    SELECT r.id AS id, MIN(e.sentAt) AS firstMatchedAt
    FROM requests r
    JOIN outreach_entries e ON e.requestId = r.id AND e.channel = 'matching'
    WHERE r.status = 'in_outreach'
    GROUP BY r.id
    HAVING SUM(CASE WHEN e.batchNumber LIKE '%-w' THEN 1 ELSE 0 END) = 0
  `)) as unknown as Array<{ id: string; firstMatchedAt: string }>;

  const timedOut = candidateRows
    .filter((c) => c.firstMatchedAt < cutoff)
    .slice(0, opts.limit ?? 10);
  if (timedOut.length === 0) return [];

  const ids = timedOut.map((c) => c.id);

  // Silence check: any qualified response (interest or quote) stops widening.
  const answered = await db
    .selectDistinct({ requestId: responses.requestId })
    .from(responses)
    .where(
      and(
        inArray(responses.requestId, ids),
        inArray(responses.type, ["interest", "quote"]),
      ),
    );
  const answeredIds = new Set(answered.map((r) => r.requestId));

  const outcomes: WidenOutcome[] = [];
  for (const candidate of timedOut) {
    if (answeredIds.has(candidate.id)) continue;
    outcomes.push(...(await widenRequest(db, candidate.id, opts.actor)));
  }
  return outcomes;
}

/**
 * Widen a single request once toward `WIDENED_BATCH_SIZE` per required trade.
 * Mirrors the manual widen branch of the matching route (no diversity cap on
 * widening; already-contacted providers are skipped).
 */
export async function widenRequest(
  db: DrizzleD1Database,
  requestId: string,
  actor: WidenActor | null,
): Promise<WidenOutcome[]> {
  const request = (await db.select().from(requests).where(eq(requests.id, requestId)).limit(1))[0];
  if (!request || request.status !== "in_outreach") return [];

  const tradeRows = await db
    .select()
    .from(requestTrades)
    .where(eq(requestTrades.requestId, requestId));
  // Phase 4: catalog is the vocabulary; known-but-deactivated trades on
  // in-flight requests still widen.
  const catalogSlugs = new Set((await listTrades(db)).map((t) => t.slug));
  const trades = tradeRows.map((t) => t.trade).filter((t) => catalogSlugs.has(t)) as Trade[];
  if (trades.length === 0) return [];

  const contacted = await db
    .select()
    .from(outreachEntries)
    .where(eq(outreachEntries.requestId, requestId));
  if (contacted.some((e) => e.channel === "matching" && e.batchNumber.endsWith("-w"))) {
    return []; // already widened once
  }
  const contactedIds = new Set(contacted.map((e) => e.companyId));

  const statements: unknown[] = [];
  const events: unknown[] = [];
  const outcomes: WidenOutcome[] = [];

  for (const trade of trades) {
    const run = await selectCandidates(db, request, trade);
    const priorMatching = contacted.filter((e) => e.channel === "matching" && e.trade === trade);
    if (priorMatching.length === 0 || priorMatching.length >= WIDENED_BATCH_SIZE) continue;

    const picks = run.candidates
      .filter((cand) => !contactedIds.has(cand.companyId))
      .slice(0, WIDENED_BATCH_SIZE - priorMatching.length);
    if (picks.length === 0) continue;

    // Phase 4: candidates whose calendar conflicts with the request window
    // are excluded from the widened round with a recorded reason — no feed
    // details, just that the provider's calendar is busy.
    const calendarConflicts: Array<{ companyId: string; legalName: string }> = [];
    const bookable: typeof picks = [];
    for (const cand of picks) {
      const conflict = await findCalendarConflict(
        db,
        cand.companyId,
        request.startDate,
        request.startDate,
      );
      if (conflict) calendarConflicts.push({ companyId: cand.companyId, legalName: cand.legalName });
      else bookable.push(cand);
    }

    const batchNumber = `M-${new Date().toISOString().slice(0, 10)}-${Math.random()
      .toString(36)
      .slice(2, 7)}-w`;
    for (const cand of bookable) {
      contactedIds.add(cand.companyId);
      statements.push(
        db.insert(outreachEntries).values({
          requestId,
          companyId: cand.companyId,
          batchNumber,
          contactedBy: actor?.id ?? (contacted[0]?.contactedBy ?? ""),
          channel: "matching",
          trade: cand.trade,
          matchScore: cand.score,
          matchFactorsJson: JSON.stringify({ factors: cand.factors, weights: run.weights }),
        }),
      );
    }
    events.push(
      auditEventStatement(db, {
        actorUserId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        entity: "request",
        entityId: requestId,
        action: "matched",
        payload: {
          trade,
          batchNumber,
          widen: true,
          reason: "widening_timeout",
          calendarConflicts,
          ranked: bookable.map((cand) => ({
            companyId: cand.companyId,
            score: cand.score,
          })),
        },
        channel: "automated",
      }),
    );
    outcomes.push({ requestId, trade, created: bookable.length });
  }

  const batch = [...statements, ...events] as unknown as [
    BatchItem<"sqlite">,
    ...BatchItem<"sqlite">[],
  ];
  if (batch.length > 0) await db.batch(batch);
  return outcomes;
}

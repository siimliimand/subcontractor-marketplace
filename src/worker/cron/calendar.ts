import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEventStatement } from "../events";
import { calendarBusyIntervals, calendarFeeds } from "../db/schema";
import { parseIcsBusy } from "../calendar/ics";

/**
 * Phase 4: hourly calendar fetch. Every active, due feed is fetched; a
 * successful fetch replaces that feed's stored intervals wholesale (the feed
 * is the truth about its own events); a failed fetch records the failure and
 * backs off exponentially (capped) while the last good intervals keep
 * blocking conservatively. Unparseable events are counted on the feed.
 *
 * Per-feed state (failCount/nextAttemptAt/lastSuccessAt) lives on the row so
 * the job is stateless. Errors never throw out of the job — one bad feed
 * must not starve the others.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_HOURS = 24;

export type FeedFetchOutcome = {
  feedId: string;
  companyId: string;
  ok: boolean;
  intervals?: number;
  unparsed?: number;
  error?: string;
};

export type FetchResult = {
  fetched: number;
  ok: number;
  failed: number;
  outcomes: FeedFetchOutcome[];
};

function backoffHours(failCount: number): number {
  return Math.min(MAX_BACKOFF_HOURS, Math.pow(2, Math.min(failCount, 5)));
}

export async function fetchCalendarFeeds(
  db: DrizzleD1Database,
  opts: { now: Date },
): Promise<FetchResult> {
  const nowIso = opts.now.toISOString();
  const due = await db
    .select()
    .from(calendarFeeds)
    .where(
      and(
        eq(calendarFeeds.state, "active"),
        or(isNull(calendarFeeds.nextAttemptAt), lt(calendarFeeds.nextAttemptAt, nowIso)),
      ),
    );

  const result: FetchResult = { fetched: 0, ok: 0, failed: 0, outcomes: [] };
  for (const feed of due) {
    result.fetched++;
    const outcome = await fetchOneFeed(db, feed, opts.now);
    result.outcomes.push(outcome);
    if (outcome.ok) result.ok++;
    else result.failed++;
  }
  return result;
}

async function fetchOneFeed(
  db: DrizzleD1Database,
  feed: typeof calendarFeeds.$inferSelect,
  now: Date,
): Promise<FeedFetchOutcome> {
  const nowIso = now.toISOString();
  try {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/calendar, text/plain, */*" },
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error("empty_feed");

    const parsed = parseIcsBusy(text, now);

    // Replace-on-success: delete this feed's old intervals, insert the fresh
    // set. Two independent statements (not a drizzle batch — the DELETE is a
    // run() candidate and mixing is unnecessary; a crash between them just
    // re-runs next hour).
    await db.run(sql`DELETE FROM calendar_busy_intervals WHERE feedId = ${feed.id}`);
    if (parsed.intervals.length > 0) {
      await db.insert(calendarBusyIntervals).values(
        parsed.intervals.map((iv) => ({
          feedId: feed.id,
          companyId: feed.companyId,
          startUtc: iv.startUtc,
          endUtc: iv.endUtc,
        })),
      );
    }
    await db
      .update(calendarFeeds)
      .set({
        failCount: 0,
        nextAttemptAt: null,
        lastFetchAt: nowIso,
        lastSuccessAt: nowIso,
        lastStatus: `ok:${response.status}`,
        unparsedCount: parsed.unparsedCount,
        updatedAt: nowIso,
      })
      .where(eq(calendarFeeds.id, feed.id));

    return {
      feedId: feed.id,
      companyId: feed.companyId,
      ok: true,
      intervals: parsed.intervals.length,
      unparsed: parsed.unparsedCount,
    };
  } catch (e) {
    const failCount = feed.failCount + 1;
    const nextAttemptAt = new Date(
      now.getTime() + backoffHours(failCount) * 3_600_000,
    ).toISOString();
    await db
      .update(calendarFeeds)
      .set({
        failCount,
        nextAttemptAt,
        lastFetchAt: nowIso,
        lastStatus: String(e).slice(0, 120),
        updatedAt: nowIso,
      })
      .where(eq(calendarFeeds.id, feed.id));

    // Fetch failures are operational, not funnel — a single audit trail row
    // per failure gives staff the forensic trail without polluting events.
    try {
      await db.batch([
        auditEventStatement(db, {
          actorUserId: null,
          actorEmail: null,
          entity: "calendar_feed",
          entityId: feed.id,
          action: "calendar_fetch_failed",
          payload: { companyId: feed.companyId, failCount, nextAttemptAt },
          channel: "automated",
        }),
      ]);
    } catch {
      // audit failure must not break the loop
    }
    return { feedId: feed.id, companyId: feed.companyId, ok: false, error: String(e).slice(0, 120) };
  }
}

/** Staleness: a feed whose last successful fetch predates the window. */
export function isFeedStale(
  feed: Pick<typeof calendarFeeds.$inferSelect, "lastSuccessAt" | "state">,
  now: Date,
  staleDays: number,
): boolean {
  if (feed.state !== "active") return false;
  if (!feed.lastSuccessAt) return true;
  return now.getTime() - new Date(feed.lastSuccessAt).getTime() > staleDays * 24 * 3_600_000;
}

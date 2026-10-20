import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  calendarBusyIntervals,
  calendarFeeds,
  companies,
} from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { maskFeedUrl } from "../calendar/ics";
import { isFeedStale } from "../cron/calendar";

export const calendarRouter = new Hono<AppEnv>();

/**
 * Phase 4: provider ICS feed management. Feed URLs are secrets — they are
 * stored (the cron must fetch them) but every response masks them via
 * `maskFeedUrl`, and no log line ever carries one. Registration enforces
 * MAX_FEEDS_PER_COMPANY; removal purges the derived intervals (cascade plus
 * an explicit count for the response). Every change is audit-logged with the
 * feed id — never the URL.
 */

function feedLimit(env: AppEnv["Bindings"]): number {
  const parsed = Number(env.MAX_FEEDS_PER_COMPANY);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function staleDays(env: AppEnv["Bindings"]): number {
  const parsed = Number(env.CALENDAR_STALE_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

calendarRouter.get("/providers/:id/calendar", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json({ error: "not_found" }, 404);

  const feeds = await db.select().from(calendarFeeds).where(eq(calendarFeeds.companyId, id));
  const now = new Date();
  const days = staleDays(c.env);
  const out = [];
  for (const feed of feeds) {
    const intervalRows = await db
      .select({ value: count() })
      .from(calendarBusyIntervals)
      .where(eq(calendarBusyIntervals.feedId, feed.id));
    const intervals = Number(intervalRows[0]?.value ?? 0);
    out.push({
      id: feed.id,
      // urlMasked only — the raw URL never leaves the storage.
      urlMasked: maskFeedUrl(feed.url),
      label: feed.label,
      state: feed.state,
      stale: isFeedStale(feed, now, days),
      lastSuccessAt: feed.lastSuccessAt,
      lastFetchAt: feed.lastFetchAt,
      lastStatus: feed.lastStatus,
      failCount: feed.failCount,
      unparsedCount: feed.unparsedCount,
      intervals: Number(intervals ?? 0),
      createdAt: feed.createdAt,
    });
  }
  return c.json({
    feeds: out,
    staleWindowDays: days,
    maxFeeds: feedLimit(c.env),
  });
});

calendarRouter.post("/providers/:id/calendar", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const url = typeof b.url === "string" ? b.url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return c.json({ error: "invalid_url" }, 400);
  }
  if (!["https:", "http:"].includes(parsedUrl.protocol))
    return c.json({ error: "invalid_feed_url: expected an http(s) ICS calendar URL" }, 400);

  const limit = feedLimit(c.env);
  const existing = await db.select().from(calendarFeeds).where(eq(calendarFeeds.companyId, id));
  if (existing.length >= limit)
    return c.json({ error: `feed_limit_reached: max ${limit} feeds per company` }, 409);
  if (existing.some((f) => f.url === url))
    return c.json({ error: "feed_already_registered" }, 409);

  const inserted = await db
    .insert(calendarFeeds)
    .values({
      companyId: id,
      url,
      label: typeof b.label === "string" ? b.label.trim() || null : null,
      createdBy: user.id,
    })
    .returning();
  const feed = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "calendar_feed",
      entityId: feed.id,
      action: "calendar_feed_added",
      payload: { companyId: id, urlMasked: maskFeedUrl(url), label: feed.label },
    }),
  ]);
  return c.json(
    {
      id: feed.id,
      urlMasked: maskFeedUrl(feed.url),
      label: feed.label,
      state: feed.state,
      createdAt: feed.createdAt,
    },
    201,
  );
});

calendarRouter.delete("/providers/:id/calendar/:feedId", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const feedId = c.req.param("feedId");
  const feed = (
    await db
      .select()
      .from(calendarFeeds)
      .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.companyId, id)))
      .limit(1)
  )[0];
  if (!feed) return c.json({ error: "not_found" }, 404);

  // Intervals cascade with the feed row; count first for the response.
  const purgedRows = await db
    .select({ value: count() })
    .from(calendarBusyIntervals)
    .where(eq(calendarBusyIntervals.feedId, feedId));
  const purged = Number(purgedRows[0]?.value ?? 0);

  await db.batch([
    db.delete(calendarFeeds).where(eq(calendarFeeds.id, feedId)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "calendar_feed",
      entityId: feedId,
      action: "calendar_feed_removed",
      payload: { companyId: id, intervalsPurged: purged },
    }),
  ]);
  return c.json({ ok: true, feedId, intervalsPurged: purged });
});

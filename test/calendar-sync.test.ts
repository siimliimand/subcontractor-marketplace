import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  calendarBusyIntervals,
  calendarFeeds,
  companies,
  responses,
  requests,
  requestTrades,
  services,
  outreachEntries,
  bookings,
  bookingRequests,
  holds,
  availabilityDeclarations,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { fetchCalendarFeeds, isFeedStale } from "../src/worker/cron/calendar";
import { purgeExpiredArtifacts } from "../src/worker/cron/retention";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(calendarBusyIntervals);
  await db().delete(calendarFeeds);
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(bookingRequests);
  await db().delete(holds);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;
async function createProvider() {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Calendar ${++regCounter}`,
      registrationIdentifier: `reg-cal-${regCounter}`,
      contactEmail: `cal${regCounter}@x.ee`,
    }),
  });
  return (await res.json()) as { id: string };
}

describe("calendar feed management", () => {
  it("registers a feed, masks the URL, audits, enforces limits and duplicates", async () => {
    const provider = await createProvider();
    const url = "https://calendar.google.com/calendar/ical/private-secret/basic.ics";

    const added = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url, label: "Google kalender" }),
    });
    expect(added.status).toBe(201);
    const feed = (await added.json()) as { id: string; urlMasked: string };
    expect(feed.urlMasked).not.toContain("private-secret");
    expect(feed.urlMasked).toContain("calendar.google.com");

    // Raw URL is not in any list response.
    const list = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      headers: authHeaders,
    });
    const listBody = (await list.json()) as { feeds: { urlMasked: string }[] };
    expect(listBody.feeds).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain("private-secret");

    const dupe = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url }),
    });
    expect(dupe.status).toBe(409);

    // Limit (default 3) enforced.
    for (let i = 0; i < 2; i++) {
      await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ url: `https://cal.example.com/f${i}/basic.ics` }),
      });
    }
    const over = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://cal.example.com/overflow/basic.ics" }),
    });
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toContain("feed_limit_reached");

    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "calendar_feed"));
    expect(events.some((e) => e.action === "calendar_feed_added")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private-secret");
  });

  it("removal purges intervals and audits", async () => {
    const provider = await createProvider();
    const added = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://cal.example.com/x/basic.ics" }),
    });
    const feed = (await added.json()) as { id: string };

    // Seed an interval as if a fetch had happened.
    await db().insert(calendarBusyIntervals).values({
      feedId: feed.id,
      companyId: provider.id,
      startUtc: "2026-11-02T09:00:00.000Z",
      endUtc: "2026-11-02T17:00:00.000Z",
    });

    const removed = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/calendar/${feed.id}`,
      { method: "DELETE", headers: { "Content-Type": "application/json", ...authHeaders }, body: "{}" },
    );
    expect(removed.status).toBe(200);
    const body = (await removed.json()) as { intervalsPurged: number };
    expect(body.intervalsPurged).toBe(1);
    const remaining = await db().select().from(calendarBusyIntervals);
    expect(remaining).toHaveLength(0);
    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "calendar_feed"));
    expect(events.some((e) => e.action === "calendar_feed_removed")).toBe(true);
  });
});

describe("fetchCalendarFeeds", () => {
  it("replaces intervals on success, preserves them on failure with backoff", async () => {
    const provider = await createProvider();
    const now = new Date("2026-05-04T08:00:00.000Z");

    // Good feed: wrap the parser fixture in a data: URL? fetch() in tests
    // cannot hit the network — use fetchMock-like behaviour via a real
    // registration then inject intervals by pointing the feed at a mocked
    // host. cloudflare:test fetchMock is reserved for Access; outbound use
    // pendingRemote: register feed, mock via fetchMock.
    const added = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://ics.test/feed/basic.ics" }),
    });
    const feed = (await added.json()) as { id: string };

    const { fetchMock } = await import("cloudflare:test");
    fetchMock.get("https://ics.test").intercept({ path: "/feed/basic.ics" }).reply(
      200,
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART:20260610T090000Z",
        "DTEND:20260610T170000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      { headers: { "Content-Type": "text/calendar" } },
    );

    const result = await fetchCalendarFeeds(db(), { now });
    expect(result.ok).toBe(1);
    expect(result.outcomes[0]!.intervals).toBe(1);

    const intervals = await db().select().from(calendarBusyIntervals);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.companyId).toBe(provider.id);

    // Feed row reports health.
    const feedRow = (await db().select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)))[0]!;
    expect(feedRow.failCount).toBe(0);
    expect(feedRow.lastSuccessAt).not.toBeNull();
    expect(isFeedStale(feedRow, now, 3)).toBe(false);

    // Failing feed keeps last good data + backs off.
    fetchMock.get("https://ics.test").intercept({ path: "/feed/basic.ics" }).reply(500, "boom").persist();
    const failed = await fetchCalendarFeeds(db(), { now: new Date("2026-05-04T09:00:00.000Z") });
    expect(failed.failed).toBe(1);
    expect(await db().select().from(calendarBusyIntervals)).toHaveLength(1);
    const failedRow = (await db().select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)))[0]!;
    expect(failedRow.failCount).toBe(1);
    expect(failedRow.nextAttemptAt).not.toBeNull();
    const failEvents = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "calendar_fetch_failed"));
    expect(failEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("flags stale feeds; intervals still block", () => {
    const stale = isFeedStale({ state: "active", lastSuccessAt: "2026-04-20T08:00:00.000Z" }, new Date("2026-05-04T08:00:00.000Z"), 3);
    expect(stale).toBe(true);
    const fresh = isFeedStale({ state: "active", lastSuccessAt: "2026-05-04T06:00:00.000Z" }, new Date("2026-05-04T08:00:00.000Z"), 3);
    expect(fresh).toBe(false);
    const never = isFeedStale({ state: "active", lastSuccessAt: null }, new Date(), 3);
    expect(never).toBe(true);
  });
});

describe("bookings respect busy intervals", () => {
  it("rejects a booking request overlapping an interval with calendar_conflict, opaque about contents", async () => {
    const provider = await createProvider();
    const feedRes = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://cal.example.com/conflict/basic.ics" }),
    });
    const feed = (await feedRes.json()) as { id: string };
    await db().insert(calendarBusyIntervals).values({
      feedId: feed.id,
      companyId: provider.id,
      startUtc: "2026-11-02T00:00:00.000Z",
      endUtc: "2026-11-03T00:00:00.000Z",
    });

    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Conflict booking",
        description: "Rewiring",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 3,
      }),
    });
    const request = (await requestRes.json()) as { id: string };
    for (const to of ["approved", "matched", "in_outreach"]) {
      await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const responseRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ type: "interest", companyId: provider.id, workersCount: 3, availableFrom: "2026-11-02" }),
    });
    const { response } = (await responseRes.json()) as { response: { id: string } };

    const bookingRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-04",
        workersCount: 3,
      }),
    });
    expect(bookingRes.status).toBe(409);
    const body = (await bookingRes.json()) as { error: string; message: string };
    expect(body.error).toBe("calendar_conflict");
    expect(body.message).not.toContain("Site visit");
  });

  it("leaves behaviour unchanged when the provider has no feeds", async () => {
    const provider = await createProvider();
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Clean booking",
        description: "Rewiring",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 3,
      }),
    });
    const request = (await requestRes.json()) as { id: string };
    for (const to of ["approved", "matched", "in_outreach"]) {
      await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const responseRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ type: "interest", companyId: provider.id, workersCount: 3, availableFrom: "2026-11-02" }),
    });
    const { response } = (await responseRes.json()) as { response: { id: string } };
    const bookingRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-04",
        workersCount: 3,
      }),
    });
    expect(bookingRes.status).toBe(201);
  });
});

describe("retention purges stale intervals", () => {
  it("deletes intervals for feeds stale beyond the window, keeps the feed row", async () => {
    const provider = await createProvider();
    const added = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://cal.example.com/stale/basic.ics" }),
    });
    const feed = (await added.json()) as { id: string };
    await db().insert(calendarBusyIntervals).values({
      feedId: feed.id,
      companyId: provider.id,
      startUtc: "2026-11-02T09:00:00.000Z",
      endUtc: "2026-11-02T17:00:00.000Z",
    });

    // Feed has never fetched successfully (lastSuccessAt NULL) → stale.
    const result = await purgeExpiredArtifacts(db(), {
      now: new Date("2026-05-04T08:00:00.000Z"),
      tokenRetentionDays: 30,
      holdRetentionDays: 90,
      intervalRetentionDays: 14,
    });
    expect(result.intervalsDeleted).toBe(1);
    expect(await db().select().from(calendarBusyIntervals)).toHaveLength(0);
    const feedRow = (await db().select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)))[0];
    expect(feedRow).toBeDefined();
  });
});

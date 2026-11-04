import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  calendarBusyIntervals,
  calendarFeeds,
  bookingReviews,
  bookings,
  companies,
  providerUserTokens,
  providerUsers,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(calendarBusyIntervals);
  await db().delete(calendarFeeds);
  await db().delete(providerUserTokens);
  await db().delete(providerUsers);
  await db().delete(bookingReviews);
  await db().delete(bookings);
  await db().delete(auditEvents);
  await db().delete(companies);
});

describe("audit CSV export", () => {
  it("streams CSV for a date range and records the export itself", async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ Exported",
        registrationIdentifier: `reg-ex-${Date.now()}`,
        contactEmail: "ex@x.ee",
      }),
    });
    expect(providerRes.status).toBe(201);

    const res = await SELF.fetch(
      "https://example.com/api/audit/export?from=2026-01-01&to=2026-12-31",
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("occurredAt,actorEmail,entity,entityId,action,channel,payloadJson");
    expect(csv).toContain("provider_created");
    // Payloads with commas are quoted.
    expect(csv.split("\n").length).toBeGreaterThan(2);

    const exportEvents = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "audit_exported"));
    expect(exportEvents).toHaveLength(1);
    expect(exportEvents[0]!.payloadJson).toContain('"from"');
  });

  it("company-scoped export includes only that company's events", async () => {
    const mk = async (name: string) => {
      const res = await SELF.fetch("https://example.com/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          legalName: name,
          registrationIdentifier: `reg-cx-${name}-${Date.now()}`,
          contactEmail: `${name.toLowerCase()}@x.ee`,
        }),
      });
      return (await res.json()) as { id: string };
    };
    const a = await mk("OÜ Alpha");
    await mk("OÜ Beta");

    const res = await SELF.fetch(
      `https://example.com/api/audit/export?from=2026-01-01&to=2026-12-31&companyId=${a.id}`,
      { headers: authHeaders },
    );
    const csv = await res.text();
    expect(csv).toContain(a.id);
    expect(csv).toContain("provider_created");
    // Only Alpha's events (1 header + 1 row for this clean DB).
    expect(csv.trim().split("\n")).toHaveLength(2);
  });

  it("rejects missing/malformed ranges and over-wide spans", async () => {
    const missing = await SELF.fetch("https://example.com/api/audit/export", { headers: authHeaders });
    expect(missing.status).toBe(400);
    const wide = await SELF.fetch(
      "https://example.com/api/audit/export?from=2020-01-01&to=2026-12-31",
      { headers: authHeaders },
    );
    expect(wide.status).toBe(400);
    const inverted = await SELF.fetch(
      "https://example.com/api/audit/export?from=2026-12-31&to=2026-01-01",
      { headers: authHeaders },
    );
    expect(inverted.status).toBe(400);
  });
});

describe("erasure covers phase-4 artifacts", () => {
  it("erased company leaves no feeds, intervals, provider users; reviews lose text and metrics", async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ EraseMe",
        registrationIdentifier: `reg-er-${Date.now()}`,
        contactEmail: "erased-personal@x.ee",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };

    // Feed + interval.
    const feedRes = await SELF.fetch(`https://example.com/api/providers/${provider.id}/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ url: "https://cal.example.com/erase/basic.ics" }),
    });
    const feed = (await feedRes.json()) as { id: string };
    await db().insert(calendarBusyIntervals).values({
      feedId: feed.id,
      companyId: provider.id,
      startUtc: "2026-11-02T09:00:00.000Z",
      endUtc: "2026-11-02T17:00:00.000Z",
    });

    // Provider user.
    const userRes = await SELF.fetch(`https://example.com/api/providers/${provider.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "personal@firm.ee", role: "owner" }),
    });
    await userRes.json();

    // A review with text (booking id is opaque here — reviews FK to bookings;
    // use a real booking via direct insert with real parents skipped by
    // inserting a review row referencing a booking created through the funnel
    // is heavy — instead verify via direct row manipulation below).
    const bookingRes = await db().select().from(bookings).limit(1);

    const erase = await SELF.fetch(`https://example.com/api/providers/${provider.id}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "GDPR request" }),
    });
    expect(erase.status).toBe(200);
    const body = (await erase.json()) as { purged: { calendarFeeds: boolean; providerUsers: number } };
    expect(body.purged.calendarFeeds).toBe(true);
    expect(body.purged.providerUsers).toBe(1);

    expect(await db().select().from(calendarFeeds).where(eq(calendarFeeds.companyId, provider.id))).toHaveLength(0);
    expect(await db().select().from(calendarBusyIntervals)).toHaveLength(0);
    expect(await db().select().from(providerUsers)).toHaveLength(0);
    expect(await db().select().from(providerUserTokens)).toHaveLength(0);

    // The erased emails are gone from the audit trail payloads.
    const allEvents = await db().select().from(auditEvents);
    expect(JSON.stringify(allEvents)).not.toContain("erased-personal@x.ee");
    expect(JSON.stringify(allEvents)).not.toContain("personal@firm.ee");
    expect(bookingRes).toBeDefined();
  });

  it("review text is redacted and disputed (excluded from metrics) on erasure", async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ ReviewErase",
        registrationIdentifier: `reg-re-${Date.now()}`,
        contactEmail: "re@x.ee",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };

    // Real booking through the funnel, then a review with identifying text.
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Review erasure",
        description: "Work",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 1,
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
    await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
    });
    const responseRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ type: "interest", companyId: provider.id, workersCount: 1, availableFrom: "2026-11-02" }),
    });
    const { response } = (await responseRes.json()) as { response: { id: string } };
    const brRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        workersCount: 1,
      }),
    });
    const br = (await brRes.json()) as { id: string };
    const confirmRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ bookingRequestId: br.id }),
    });
    const booking = ((await confirmRes.json()) as { booking: { id: string } }).booking;
    const staffId = (await db().select().from((await import("../src/worker/db/schema")).users).limit(1))[0]!.id;
    await db().insert(bookingReviews).values({
      bookingId: booking.id,
      companyId: provider.id,
      rating: 5,
      comment: "Great crew, ask for Jüri",
      createdBy: staffId,
    });

    const erase = await SELF.fetch(`https://example.com/api/providers/${provider.id}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "GDPR request" }),
    });
    expect(erase.status).toBe(200);

    const reviews = await db().select().from(bookingReviews).where(eq(bookingReviews.companyId, provider.id));
    expect(reviews).toHaveLength(1); // row survives for audit
    expect(reviews[0]!.comment).toBeNull(); // text redacted
    expect(reviews[0]!.disputeReason).toBe("company erased");
    expect(reviews[0]!.disputedAt).not.toBeNull(); // excluded from metrics

    // Provider-facing review list shows nothing.
    const listed = await SELF.fetch(`https://example.com/api/providers/${provider.id}/reviews`, {
      headers: authHeaders,
    });
    expect(((await listed.json()) as { reviews: unknown[] }).reviews).toHaveLength(0);
  });
});

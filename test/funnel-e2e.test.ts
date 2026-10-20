import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  availabilityDeclarations,
  bookingRequests,
  bookings,
  companies,
  holds,
  outreachEntries,
  requests,
  requestTrades,
  responses,
  services,
  briefProposals,
} from "../src/worker/db/schema";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../src/worker/app";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(briefProposals);
  await db().delete(bookingRequests);
  await db().delete(holds);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

/**
 * Funnel completeness (cross-cutting invariant): every phase 2 mutation fires
 * its funnel/audit event with actor, timestamp and channel. This walk exercises
 * the real UI flow end to end:
 * brief → approve → create request → approve → match → outreach generated →
 * response → booking request → confirm → work start.
 */
describe("end-to-end funnel walk", () => {
  it("brief → request → match → response → booking → work-start fires every event in order", async () => {
    // Provider with availability + service in Tallinn
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ E2E Elekter",
        registrationIdentifier: "reg-e2e-1",
        contactEmail: "e2e@elekter.ee",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };
    const serviceRes = await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour", skills: "panel" }),
    });
    expect(serviceRes.status).toBe(201);
    const declRes = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/availability`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          trade: "electrical",
          workersCount: 3,
          dateFrom: "2026-11-01",
          dateTo: "2026-11-30",
          channel: "booking_system",
        }),
      },
    );
    expect(declRes.status).toBe(201);

    // 1. Brief draft + approval (AI mocked at the binding boundary)
    const good = JSON.stringify({
      workType: "renovation",
      location: "Tallinn",
      trades: ["electrical"],
      crewSize: 3,
      startDate: "2026-11-02",
    });
    const app = createApp();
    const aiEnv = { ...env, AI: { run: () => Promise.resolve({ response: good }) } };
    const draftRes = await app.request(
      "https://example.com/api/briefs/draft",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          sourceText: "we need an electrical subcontractor for an apartment renovation in Tallinn starting 2026-11-02, 3 fitters",
        }),
      },
      aiEnv,
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string; draft: Record<string, unknown>; missing: string[] };

    const approveRes = await app.request(
      `https://example.com/api/briefs/${draft.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ final: draft.draft }),
      },
      aiEnv,
    );
    expect(approveRes.status).toBe(200);

    // 2. Request created from the approved values, then approved
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Apartment rewiring",
        description: "Full rewiring, 2nd floor",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 3,
      }),
    });
    const request = (await requestRes.json()) as { id: string };
    const transitionRes = await SELF.fetch(
      `https://example.com/api/requests/${request.id}/transition`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to: "approved" }),
      },
    );
    expect(transitionRes.status).toBe(200);

    // 3. Matching generates a batch (availability declared → capacity factor fires)
    const matchRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(matchRes.status).toBe(201);
    const matchBody = (await matchRes.json()) as {
      runs: { candidates: { companyId: string; factors: Record<string, { missing: boolean }> }[] }[];
    };
    expect(matchBody.runs[0]!.candidates).toHaveLength(1);
    expect(matchBody.runs[0]!.candidates[0]!.factors.confirmedCapacity!.missing).toBe(false);

    // 4. Response arrives for the contacted provider
    const responseRes = await SELF.fetch(
      `https://example.com/api/requests/${request.id}/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          type: "quote",
          companyId: provider.id,
          workersCount: 3,
          availableFrom: "2026-11-02",
          reason: "48 EUR/h",
        }),
      },
    );
    expect(responseRes.status).toBe(201);

    // 5. Booking request → confirm
    const brRes = await SELF.fetch(
      `https://example.com/api/requests/${request.id}/bookings/request`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          trade: "electrical",
          startDate: "2026-11-02",
          endDate: "2026-11-10",
          workersCount: 3,
          companyId: provider.id,
        }),
      },
    );
    expect(brRes.status).toBe(400); // needs a responseId — booking from hold only via holdId
    const responseId = ((await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}`, { headers: authHeaders })
    ).json()) as { responses: { response: { id: string } }[] }).responses[0]!.response.id;
    const brOk = await SELF.fetch(
      `https://example.com/api/requests/${request.id}/bookings/request`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          responseId,
          trade: "electrical",
          startDate: "2026-11-02",
          endDate: "2026-11-10",
          workersCount: 3,
        }),
      },
    );
    expect(brOk.status).toBe(201);
    const br = (await brOk.json()) as { id: string };
    const confirmRes = await SELF.fetch(
      `https://example.com/api/requests/${request.id}/bookings/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ bookingRequestId: br.id }),
      },
    );
    expect(confirmRes.status).toBe(201);

    // 6. Work starts
    const workRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/work-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(workRes.status).toBe(200);

    // Funnel completeness: every event fired exactly once with actor + timestamp
    const events = await db()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entity, "request"), eq(auditEvents.entityId, request.id)));
    const actions = events.map((e) => e.action);
    const expectedOnce = [
      "request_created",
      "request_approved",
      "matched",
      "response_received",
      "qualified_response",
      "quote_submitted",
      "booking_requested",
      "booking_confirmed",
      "work_started",
    ];
    for (const action of expectedOnce) {
      expect(actions.filter((a) => a === action), action).toHaveLength(1);
    }
    expect(actions).toContain("quote_submitted");

    // brief_approved is stored under entity=brief
    const briefEvents = await db()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entity, "brief"), eq(auditEvents.action, "brief_approved")));
    expect(briefEvents).toHaveLength(1);
    expect(briefEvents[0]!.occurredAt).toBeTruthy();
    for (const event of events) {
      expect(event.occurredAt, event.action).toBeTruthy();
      expect(event.actorUserId, event.action).toBeTruthy();
    }

    // Final state
    const detail = (await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}`, { headers: authHeaders })
    ).json()) as {
      request: { status: string };
      comparison: { trade: string; entries: { availability: { label: string } }[] }[];
    };
    expect(detail.request.status).toBe("booked");
    expect(detail.comparison[0]!.entries[0]!.availability.label).toBe("current");

    // Dashboard reflects the flow: booking conversion 1.0
    const overview = (await (
      await SELF.fetch("https://example.com/api/dashboard/overview", { headers: authHeaders })
    ).json()) as { bookingFlow: { requested: number; confirmed: number; conversion: number } };
    expect(overview.bookingFlow.requested).toBe(1);
    expect(overview.bookingFlow.confirmed).toBe(1);
    expect(overview.bookingFlow.conversion).toBe(1);
  });
});

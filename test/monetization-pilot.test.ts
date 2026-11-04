import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { createApp } from "../src/worker/app";
import {
  auditEvents,
  companies,
  responses,
  requests,
  requestTrades,
  services,
  outreachEntries,
  bookingRequests,
  bookings,
  holds,
  availabilityDeclarations,
  partners,
  pilotAgreements,
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
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(bookingRequests);
  await db().delete(holds);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(requestTrades);
  await db().delete(services);
  await db().delete(companies);
  await db().delete(pilotAgreements);
  await db().delete(partners);
});

/** Flag-on requests run against a directly-invoked app (SELF's env is fixed). */
const pilotApp = createApp();
async function pilotFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return pilotApp.request(
    `https://example.com${path}`,
    {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    { ...env, MONETIZATION_PILOT_ENABLED: "true" } as typeof env,
  );
}

let regCounter = 0;

/** Full setup: provider + request (optionally with partnerId) reaching `responded`. */
async function setupRequestWithResponse(opts: { partnerId?: string } = {}) {
  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Pilot ${++regCounter}`,
      registrationIdentifier: `reg-pilot-${regCounter}`,
      contactEmail: `pilot${regCounter}@x.ee`,
    }),
  });
  const provider = (await providerRes.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
  });
  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Pilot booking",
      description: "Work",
      location: "Tallinn",
      trades: ["electrical"],
      startDate: "2026-11-02",
      crewSize: 2,
      partnerId: opts.partnerId,
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
    body: JSON.stringify({
      type: "interest",
      companyId: provider.id,
      workersCount: 2,
      availableFrom: "2026-11-02",
    }),
  });
  const { response } = (await responseRes.json()) as { response: { id: string } };
  return { provider, request, response };
}

async function createPartnerWithAgreement(): Promise<string> {
  const created = await SELF.fetch("https://example.com/api/pilot/agreements", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ partnerName: "Merko Ehitus", monthlyEur: 350, notes: "hand-billed pilot" }),
  });
  expect(created.status).toBe(201);
  const agreement = (await created.json()) as { partnerId: string; id: string };
  return agreement.partnerId;
}

describe("pilot agreements", () => {
  it("records and ends hand-billed agreements with audit", async () => {
    const partnerId = await createPartnerWithAgreement();
    expect(partnerId).toBeTruthy();

    const list = await SELF.fetch("https://example.com/api/pilot/agreements", { headers: authHeaders });
    const listBody = (await list.json()) as { agreements: { id: string; partnerName: string | null; status: string }[] };
    expect(listBody.agreements).toHaveLength(1);
    expect(listBody.agreements[0]!.partnerName).toBe("Merko Ehitus");
    expect(listBody.agreements[0]!.status).toBe("active");

    const agreementId = listBody.agreements[0]!.id;
    const ended = await SELF.fetch(`https://example.com/api/pilot/agreements/${agreementId}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    });
    expect(ended.status).toBe(200);

    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "pilot_agreement"));
    const actions = events.map((e) => e.action);
    expect(actions).toContain("pilot_agreement_added");
    expect(actions).toContain("pilot_agreement_ended");
  });
});

describe("booking interface gate", () => {
  it("flag off means no gating even without any partner", async () => {
    const { request, response } = await setupRequestWithResponse();
    const bookingRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        workersCount: 2,
      }),
    });
    expect(bookingRes.status).toBe(201);
  });

  it("flag on: partner without agreement is gated read-only with a counted event", async () => {
    const { request, response } = await setupRequestWithResponse();
    const bookingRes = await pilotFetch(`/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      body: {
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        workersCount: 2,
      },
    });
    expect(bookingRes.status).toBe(403);
    const body = (await bookingRes.json()) as { error: string; readOnly: boolean };
    expect(body.error).toBe("pilot_gate_required");
    expect(body.readOnly).toBe(true);

    // Funnel evidence: the blocked view is counted.
    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "pilot_gate_blocked"));
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe("unassigned");
  });

  it("flag on: partner with an active agreement flows unchanged; after ending, gated again", async () => {
    const partnerId = await createPartnerWithAgreement();
    const { request, response } = await setupRequestWithResponse({ partnerId });

    const bookingRes = await pilotFetch(`/api/requests/${request.id}/bookings/request`, {
      method: "POST",
      body: {
        responseId: response.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        workersCount: 2,
      },
    });
    expect(bookingRes.status).toBe(201);

    // End the agreement → further booking mutations are gated.
    const list = await SELF.fetch("https://example.com/api/pilot/agreements", { headers: authHeaders });
    const agreementId = ((await list.json()) as { agreements: { id: string }[] }).agreements[0]!.id;
    await SELF.fetch(`https://example.com/api/pilot/agreements/${agreementId}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    });

    const blocked = await pilotFetch(`/api/requests/${request.id}/work-start`, { method: "POST", body: {} });
    expect(blocked.status).toBe(403);
  });
});

describe("pilot metrics", () => {
  it("per-partner usage with share on agreements", async () => {
    const partnerId = await createPartnerWithAgreement();
    const { request } = await setupRequestWithResponse({ partnerId });
    const metrics = await SELF.fetch("https://example.com/api/pilot/metrics", { headers: authHeaders });
    const body = (await metrics.json()) as {
      partners: number;
      onAgreements: number;
      shareOnAgreements: number;
      usage: { partnerId: string; activeAgreement: boolean; requests: number }[];
    };
    expect(body.partners).toBe(1);
    expect(body.onAgreements).toBe(1);
    expect(body.shareOnAgreements).toBe(1);
    expect(body.usage[0]!.partnerId).toBe(partnerId);
    expect(body.usage[0]!.requests).toBe(1);
    expect(request).toBeTruthy();
  });
});

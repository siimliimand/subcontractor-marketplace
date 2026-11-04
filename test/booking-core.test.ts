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
  responses,
  services,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../src/worker/app";

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
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;

async function createProviderWithResponse(opts: { trade?: string; area?: string } = {}) {
  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Booking ${++regCounter}`,
      registrationIdentifier: `reg-bk-${regCounter}`,
      contactEmail: `bk${regCounter}@x.ee`,
    }),
  });
  const provider = (await providerRes.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      trade: opts.trade ?? "electrical",
      serviceArea: opts.area ?? "Tallinn",
      pricingModel: "hour",
    }),
  });

  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Rewire floor 2",
      description: "Rewiring",
      location: "Tallinn",
      trades: [opts.trade ?? "electrical"],
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
    body: JSON.stringify({
      type: "interest",
      companyId: provider.id,
      workersCount: 3,
      availableFrom: "2026-11-02",
    }),
  });
  const { response } = (await responseRes.json()) as {
    response: { id: string };
  };
  return { provider, request, response };
}

function bookingRequestBody(requestId: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://example.com/api/requests/${requestId}/bookings/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
}

function bookingConfirm(requestId: string, bookingRequestId: string) {
  return SELF.fetch(`https://example.com/api/requests/${requestId}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ bookingRequestId }),
  });
}

const RANGE = { startDate: "2026-11-02", endDate: "2026-11-10", workersCount: 3 };

describe("booking request → confirmation flow", () => {
  it("records booking_requested without committing anything", async () => {
    const { request, response } = await createProviderWithResponse();
    const res = await bookingRequestBody(request.id, {
      responseId: response.id,
      trade: "electrical",
      ...RANGE,
    });
    expect(res.status).toBe(201);
    const br = (await res.json()) as { state: string };

    expect(br.state).toBe("requested");
    const bookingRows = await db().select().from(bookings);
    expect(bookingRows).toHaveLength(0);
    const detail = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    const body = (await detail.json()) as { request: { status: string } };
    expect(body.request.status).toBe("responded");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "booking_requested"));
    expect(events).toHaveLength(1);
  });

  it("confirmation inserts the booking with trade, sets booked, records booking_confirmed; second confirm rejected", async () => {
    const { request, response } = await createProviderWithResponse();
    const brRes = await bookingRequestBody(request.id, {
      responseId: response.id,
      trade: "electrical",
      ...RANGE,
    });
    const br = (await brRes.json()) as { id: string };

    const confirm = await bookingConfirm(request.id, br.id);
    expect(confirm.status).toBe(201);
    const { booking } = (await confirm.json()) as { booking: { trade: string; companyId: string } };
    expect(booking.trade).toBe("electrical");

    const detail = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    const body = (await detail.json()) as { request: { status: string } };
    expect(body.request.status).toBe("booked");

    const confirmedEvents = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "booking_confirmed"));
    expect(confirmedEvents).toHaveLength(1);

    // booking request now confirmed; second confirm refused at request level
    const again = await bookingConfirm(request.id, br.id);
    expect(again.status).toBe(409);
    expect(String((await again.json() as { error: string }).error)).toContain("already_booked");
  });

  it("requires the trade to be in the request's trades and a date range", async () => {
    const { request, response } = await createProviderWithResponse({ trade: "electrical" });
    const badTrade = await bookingRequestBody(request.id, {
      responseId: response.id,
      trade: "painting",
      ...RANGE,
    });
    expect(badTrade.status).toBe(400);

    const badRange = await bookingRequestBody(request.id, {
      responseId: response.id,
      trade: "electrical",
      startDate: "2026-11-10",
      endDate: "2026-11-02",
      workersCount: 3,
    });
    expect(badRange.status).toBe(400);
  });

  it("records work_started on booked requests only", async () => {
    const { request, response } = await createProviderWithResponse();
    const early = await SELF.fetch(`https://example.com/api/requests/${request.id}/work-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(early.status).toBe(400);

    const br = (await (
      await bookingRequestBody(request.id, { responseId: response.id, trade: "electrical", ...RANGE })
    ).json()) as { id: string };
    await bookingConfirm(request.id, br.id);

    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/work-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "work_started"));
    expect(events).toHaveLength(1);
  });
});

describe("first-confirmed-wins capacity conflicts", () => {
  it("rejects a second confirmation for the same provider+trade+overlapping dates with 409 naming the winner", async () => {
    const first = await createProviderWithResponse();
    const br1 = (await (
      await bookingRequestBody(first.request.id, {
        responseId: first.response.id,
        trade: "electrical",
        ...RANGE,
      })
    ).json()) as { id: string };
    const ok = await bookingConfirm(first.request.id, br1.id);
    expect(ok.status).toBe(201);

    // second request, same provider (new response), overlapping dates
    const secondRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Second job same provider",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-05",
        crewSize: 2,
      }),
    });
    const second = (await secondRes.json()) as { id: string };
    for (const to of ["approved", "matched", "in_outreach"]) {
      await SELF.fetch(`https://example.com/api/requests/${second.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const respRes = await SELF.fetch(`https://example.com/api/requests/${second.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type: "interest",
        companyId: first.provider.id,
        workersCount: 2,
        availableFrom: "2026-11-05",
      }),
    });
    const { response: resp2 } = (await respRes.json()) as { response: { id: string } };
    const br2 = (await (
      await bookingRequestBody(second.id, { responseId: resp2.id, trade: "electrical", startDate: "2026-11-05", endDate: "2026-11-12", workersCount: 2 })
    ).json()) as { id: string };

    const conflict = await bookingConfirm(second.id, br2.id);
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as {
      error: string;
      winner: { bookingId: string; requestId: string } | null;
    };
    expect(body.error).toBe("capacity_conflict");
    expect(body.winner?.requestId).toBe(first.request.id);

    // the first booking stands; request 2 still responded
    const detail = await SELF.fetch(`https://example.com/api/requests/${second.id}`, {
      headers: authHeaders,
    });
    const detailBody = (await detail.json()) as { request: { status: string } };
    expect(detailBody.request.status).toBe("responded");
  });

  it("allows non-overlapping dates for the same provider+trade", async () => {
    const first = await createProviderWithResponse();
    const br1 = (await (
      await bookingRequestBody(first.request.id, {
        responseId: first.response.id,
        trade: "electrical",
        ...RANGE,
      })
    ).json()) as { id: string };
    expect((await bookingConfirm(first.request.id, br1.id)).status).toBe(201);

    const secondRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Later job",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-12-01",
        crewSize: 2,
      }),
    });
    const second = (await secondRes.json()) as { id: string };
    for (const to of ["approved", "matched", "in_outreach"]) {
      await SELF.fetch(`https://example.com/api/requests/${second.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const respRes = await SELF.fetch(`https://example.com/api/requests/${second.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type: "interest",
        companyId: first.provider.id,
        workersCount: 2,
        availableFrom: "2026-12-01",
      }),
    });
    const { response: resp2 } = (await respRes.json()) as { response: { id: string } };
    const br2 = (await (
      await bookingRequestBody(second.id, { responseId: resp2.id, trade: "electrical", startDate: "2026-12-01", endDate: "2026-12-05", workersCount: 2 })
    ).json()) as { id: string };
    const ok = await bookingConfirm(second.id, br2.id);
    expect(ok.status).toBe(201);
  });

  it("cancelled bookings free capacity", async () => {
    const first = await createProviderWithResponse();
    const br1 = (await (
      await bookingRequestBody(first.request.id, {
        responseId: first.response.id,
        trade: "electrical",
        ...RANGE,
      })
    ).json()) as { id: string };
    await bookingConfirm(first.request.id, br1.id);

    // customer cancels the booking
    const cancel = await SELF.fetch(`https://example.com/api/requests/${first.request.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "project shelved" }),
    });
    expect(cancel.status).toBe(200);

    // the same window is now bookable again by another request
    const secondRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Replacement job",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-03",
        crewSize: 2,
      }),
    });
    const second = (await secondRes.json()) as { id: string };
    for (const to of ["approved", "matched", "in_outreach"]) {
      await SELF.fetch(`https://example.com/api/requests/${second.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const respRes = await SELF.fetch(`https://example.com/api/requests/${second.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type: "interest",
        companyId: first.provider.id,
        workersCount: 2,
        availableFrom: "2026-11-03",
      }),
    });
    const { response: resp2 } = (await respRes.json()) as { response: { id: string } };
    const br2 = (await (
      await bookingRequestBody(second.id, { responseId: resp2.id, trade: "electrical", startDate: "2026-11-03", endDate: "2026-11-08", workersCount: 2 })
    ).json()) as { id: string };
    const ok = await bookingConfirm(second.id, br2.id);
    expect(ok.status).toBe(201);
  });
});

describe("48-hour holds behind BOOKING_HOLDS_ENABLED", () => {
  it("places a hold with ~48h expiry and refuses overlapping holds", async () => {
    const { provider, request } = await createProviderWithResponse();
    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        trade: "electrical",
        ...RANGE,
      }),
    });
    expect(res.status).toBe(201);
    const hold = (await res.json()) as { state: string; expiresAt: string };
    expect(hold.state).toBe("active");
    const ttlH =
      (new Date(hold.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(ttlH).toBeGreaterThan(47);
    expect(ttlH).toBeLessThan(49);

    // overlapping hold for the same provider+trade refused
    const again = await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        trade: "electrical",
        startDate: "2026-11-05",
        endDate: "2026-11-12",
        workersCount: 1,
      }),
    });
    expect(again.status).toBe(409);
  });

  it("lazily expires past-due holds on read", async () => {
    const { provider, request } = await createProviderWithResponse();
    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        trade: "electrical",
        ...RANGE,
      }),
    });
    const hold = (await res.json()) as { id: string };
    await db()
      .update(holds)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(holds.id, hold.id));

    const list = await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, {
      headers: authHeaders,
    });
    const rows = (await list.json()) as { state: string }[];
    expect(rows[0]!.state).toBe("expired");
  });

  it("confirmation supersedes the request's active holds", async () => {
    const { provider, request, response } = await createProviderWithResponse();
    await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ companyId: provider.id, trade: "electrical", ...RANGE }),
    });
    const br = (await (
      await bookingRequestBody(request.id, { responseId: response.id, trade: "electrical", ...RANGE })
    ).json()) as { id: string };
    await bookingConfirm(request.id, br.id);

    const rows = (await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}/holds`, { headers: authHeaders })
    ).json()) as { state: string }[];
    expect(rows[0]!.state).toBe("superseded");
  });

  it("flag off rejects hold creation", async () => {
    const { provider, request } = await createProviderWithResponse();
    const app = createApp();
    const flagOffEnv = { ...env, BOOKING_HOLDS_ENABLED: "false" };
    const res = await app.request(
      `https://example.com/api/requests/${request.id}/holds`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ companyId: provider.id, trade: "electrical", ...RANGE }),
      },
      flagOffEnv,
    );
    expect(res.status).toBe(403);
    expect(String((await res.json() as { error: string }).error)).toContain("holds_disabled");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  availabilityDeclarations,
  bookingRequests,
  bookingReschedules,
  bookings,
  companies,
  holds,
  outreachEntries,
  requests,
  responses,
  services,
  users,
} from "../src/worker/db/schema";
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
  await db().delete(bookingReschedules);
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

const RANGE = { startDate: "2026-11-02", endDate: "2026-11-10", workersCount: 3 };

/** Provider + walked request + qualified response, ready for booking. */
async function createProviderWithResponse() {
  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Hardening ${++regCounter}`,
      registrationIdentifier: `reg-hd-${regCounter}`,
      contactEmail: `hd${regCounter}@x.ee`,
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
      title: "Hardening job",
      description: "d",
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
    body: JSON.stringify({
      type: "interest",
      companyId: provider.id,
      workersCount: 3,
      availableFrom: "2026-11-02",
    }),
  });
  const { response } = (await responseRes.json()) as { response: { id: string } };
  return { provider, request: request.id, response: response.id };
}

async function bookIt(ctx: { request: string; response: string }, range = RANGE) {
  const br = (await (
    await SELF.fetch(`https://example.com/api/requests/${ctx.request}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ responseId: ctx.response, trade: "electrical", ...range }),
    })
  ).json()) as { id: string };
  if (!br.id) throw new Error(`booking request failed: ${JSON.stringify(br)}`);
  const confirmRes = await SELF.fetch(
    `https://example.com/api/requests/${ctx.request}/bookings/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ bookingRequestId: br.id }),
    },
  );
  expect(confirmRes.status).toBe(201);
  const { booking } = (await confirmRes.json()) as { booking: { id: string } };
  return { bookingRequestId: br.id, bookingId: booking.id };
}

const detail = async (requestId: string) =>
  (await (
    await SELF.fetch(`https://example.com/api/requests/${requestId}`, { headers: authHeaders })
  ).json()) as {
  request: { status: string };
  bookings: { booking: { id: string; startDate: string; endDate: string; workersCount: number; outcome: string | null } }[];
  bookingRequests: { br: { id: string; state: string } }[];
  reschedules: { id: string; state: string; startDate: string }[];
  reconfirmations: Record<string, { required: boolean; worstState: string | null }>;
};

describe("reschedule: propose → confirm → record", () => {
  it("proposes, confirms (booking moves), retains history, audits", async () => {
    const ctx = await createProviderWithResponse();
    await bookIt({ request: ctx.request, response: ctx.response });

    const propRes = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/reschedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          startDate: "2026-11-20",
          endDate: "2026-11-28",
          workersCount: 2,
          reason: "slipped schedule",
        }),
      },
    );
    expect(propRes.status).toBe(201);
    const proposal = (await propRes.json()) as { id: string; state: string };

    const dupRes = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/reschedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ startDate: "2026-12-01", endDate: "2026-12-05", workersCount: 1 }),
      },
    );
    expect(dupRes.status).toBe(409);

    const confirmRes = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/reschedule/${proposal.id}/confirm`,
      { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: "{}" },
    );
    expect(confirmRes.status).toBe(200);
    const { booking } = (await confirmRes.json()) as {
      booking: { startDate: string; endDate: string; workersCount: number };
    };
    expect(booking.startDate).toBe("2026-11-20");
    expect(booking.workersCount).toBe(2);

    const d = await detail(ctx.request);
    expect(d.reschedules.map((r) => r.state)).toEqual(["confirmed"]);
    const events = await db().select().from(auditEvents);
    const rescheduled = events.filter((e) => e.action === "booking_rescheduled");
    expect(rescheduled.map((e) => JSON.parse(e.payloadJson ?? "{}").state).sort()).toEqual([
      "confirmed",
      "proposed",
    ]);
  });

  it("rejects a proposal and leaves the booking unchanged", async () => {
    const ctx = await createProviderWithResponse();
    await bookIt({ request: ctx.request, response: ctx.response });

    const proposal = (await (
      await SELF.fetch(`https://example.com/api/requests/${ctx.request}/bookings/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ startDate: "2026-11-20", endDate: "2026-11-28", workersCount: 2 }),
      })
    ).json()) as { id: string };

    const rejectRes = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/reschedule/${proposal.id}/reject`,
      { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: "{}" },
    );
    expect(rejectRes.status).toBe(200);

    const d = await detail(ctx.request);
    expect(d.reschedules[0]!.state).toBe("rejected");
    expect(d.bookings[0]!.booking.startDate).toBe("2026-11-02");
  });

  it("capacity conflict on confirm names the winner and keeps original dates", async () => {
    const first = await createProviderWithResponse();
    await bookIt(first);

    // Second booking for the same provider on disjoint dates…
    const secondRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Second job",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-20",
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
        availableFrom: "2026-11-20",
      }),
    });
    const { response: resp2 } = (await respRes.json()) as { response: { id: string } };
    await bookIt(
      { request: second.id, response: resp2.id },
      { startDate: "2026-11-20", endDate: "2026-11-28", workersCount: 2 },
    );

    // …then reschedule it onto the first booking's window → conflict.
    const proposal = (await (
      await SELF.fetch(`https://example.com/api/requests/${second.id}/bookings/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ startDate: "2026-11-05", endDate: "2026-11-12", workersCount: 2 }),
      })
    ).json()) as { id: string };

    const conflictRes = await SELF.fetch(
      `https://example.com/api/requests/${second.id}/bookings/reschedule/${proposal.id}/confirm`,
      { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: "{}" },
    );
    expect(conflictRes.status).toBe(409);
    const body = (await conflictRes.json()) as { error: string; winner: { requestId: string } | null };
    expect(body.error).toBe("capacity_conflict");
    expect(body.winner?.requestId).toBe(first.request);

    const d = await detail(second.id);
    expect(d.bookings[0]!.booking.startDate).toBe("2026-11-20");
  });
});

describe("booking-level cancellation with attribution", () => {
  it("cancels with attribution, request returns to responded and is re-bookable", async () => {
    const ctx = await createProviderWithResponse();
    await bookIt({ request: ctx.request, response: ctx.response });

    const noAttr = await SELF.fetch(`https://example.com/api/requests/${ctx.request}/bookings/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "no attribution" }),
    });
    expect(noAttr.status).toBe(400);

    const noReason = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ cancelledBy: "provider" }),
      },
    );
    expect(noReason.status).toBe(400);

    const cancelRes = await SELF.fetch(
      `https://example.com/api/requests/${ctx.request}/bookings/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ cancelledBy: "provider", reason: "crew reassigned" }),
      },
    );
    expect(cancelRes.status).toBe(200);
    const { booking, requestStatus } = (await cancelRes.json()) as {
      booking: { outcome: string | null; cancelledBy: string | null; cancelReason: string | null };
      requestStatus: string;
    };
    expect(booking.outcome).toBe("cancelled");
    expect(booking.cancelledBy).toBe("provider");
    expect(booking.cancelReason).toBe("crew reassigned");
    expect(requestStatus).toBe("responded");

    // Re-bookable: a new booking request on the same response works.
    const brRes = await SELF.fetch(`https://example.com/api/requests/${ctx.request}/bookings/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ responseId: ctx.response, trade: "electrical", ...RANGE }),
    });
    expect(brRes.status).toBe(201);

    const events = await db().select().from(auditEvents);
    expect(events.some((e) => e.action === "booking_cancelled")).toBe(true);
  });
});

describe("reconfirmation prompts and one-click reconfirm", () => {
  it("flags stale declarations behind a live booking and reconfirm refreshes freshness", async () => {
    const ctx = await createProviderWithResponse();
    const { bookingId } = await bookIt({ request: ctx.request, response: ctx.response });

    // Stale declaration (confirmed 20 days ago) covering the booking window.
    await db().insert(availabilityDeclarations).values({
      companyId: ctx.provider.id,
      trade: "electrical",
      workersCount: 3,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-15",
      channel: "booking_system",
      lastConfirmedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: (await db().select().from(users).limit(1))[0]!.id,
    });

    let d = await detail(ctx.request);
    expect(d.reconfirmations[bookingId]!.required).toBe(true);
    expect(d.reconfirmations[bookingId]!.worstState).toBe("stale");

    const reconfirmRes = await SELF.fetch(
      `https://example.com/api/providers/${ctx.provider.id}/availability/reconfirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ bookingId }),
      },
    );
    expect(reconfirmRes.status).toBe(201);
    const declaration = (await reconfirmRes.json()) as { freshness: string; notes: string };
    expect(declaration.freshness).toBe("current");
    expect(declaration.notes).toContain("reconfirmation");

    d = await detail(ctx.request);
    expect(d.reconfirmations[bookingId]!.required).toBe(false);

    const events = await db().select().from(auditEvents);
    expect(events.some((e) => e.action === "availability_reconfirmed")).toBe(true);
  });

  it("flags bookings with no covering declarations at all", async () => {
    const ctx = await createProviderWithResponse();
    const { bookingId } = await bookIt({ request: ctx.request, response: ctx.response });
    const d = await detail(ctx.request);
    expect(d.reconfirmations[bookingId]).toEqual({ required: true, worstState: "expired" });
  });
});

describe("tentative vs confirmed in API data", () => {
  it("booking requests stay `requested` (tentative) and only confirmed bookings create booking rows", async () => {
    const ctx = await createProviderWithResponse();
    const br = (await (
      await SELF.fetch(`https://example.com/api/requests/${ctx.request}/bookings/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ responseId: ctx.response, trade: "electrical", ...RANGE }),
      })
    ).json()) as { id: string; state: string };
    expect(br.state).toBe("requested");

    const d = await detail(ctx.request);
    // Tentative request visible; no confirmed booking row yet.
    expect(d.bookingRequests[0]!.br.state).toBe("requested");
    expect(d.bookings.length).toBe(0);
    expect(d.request.status).toBe("responded");
  });
});

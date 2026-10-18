import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, bookings, companies, requests, responses, users } from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;
let userId: string;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  const res = await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  const me = (await res.json()) as { id: string };
  userId = me.id;
  await db().delete(auditEvents);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(requests);
  await db().delete(companies);
});

async function createRequest(overrides: Record<string, unknown> = {}) {
  const res = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Warehouse rewiring",
      description: "Replace main distribution board",
      location: "Tallinn, Sadama 12",
      trade: "electrical",
      startDate: "2026-11-02",
      crewSize: 3,
      ...overrides,
    }),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function createProvider() {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: "OÜ Elektrimees",
      registrationIdentifier: `reg-${Math.random()}`,
      contactEmail: "info@elektrimees.ee",
    }),
  });
  return (await res.json()) as { id: string };
}

async function transition(id: string, to: string) {
  return SELF.fetch(`https://example.com/api/requests/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to }),
  });
}

describe("request administration", () => {
  it("creates a draft request with required fields and writes request_created", async () => {
    const { res, body } = await createRequest();
    expect(res.status).toBe(201);
    expect(body.status).toBe("draft");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "request_created"));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(userId);
  });

  it("rejects creation missing required fields", async () => {
    const { res, body } = await createRequest({ startDate: undefined });
    expect(res.status).toBe(400);
    expect((body as { error: string }).error).toContain("startDate");
  });

  it("enforces the state machine: invalid transitions rejected", async () => {
    const { body } = await createRequest();
    const id = body.id as string;

    const bad = await transition(id, "responded");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("invalid_transition");

    const stillDraft = (await (await SELF.fetch(`https://example.com/api/requests/${id}`, { headers: authHeaders })).json()) as { request: { status: string } };
    expect(stillDraft.request.status).toBe("draft");
  });

  it("approval requires a complete brief", async () => {
    const { body: req2 } = await createRequest();
    // simulate an incomplete stored brief
    await db().update(requests).set({ startDate: "" }).where(eq(requests.id, req2.id as string));
    const approve = await transition(req2.id as string, "approved");
    expect(approve.status).toBe(400);
    expect(((await approve.json()) as { error: string }).error).toContain("startDate");
    const still = (await (await SELF.fetch(`https://example.com/api/requests/${req2.id}`, { headers: authHeaders })).json()) as { request: { status: string } };
    expect(still.request.status).toBe("draft");
  });

  it("approve writes request_approved and moves to approved", async () => {
    const { body } = await createRequest();
    const id = body.id as string;
    const res = await transition(id, "approved");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("approved");
    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "request_approved"));
    expect(events).toHaveLength(1);
  });

  it("records an interest response with capacity; moves matched request to responded; writes qualified_response", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");

    const res = await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        type: "interest",
        workersCount: 3,
        availableFrom: "2026-11-02",
      }),
    });
    expect(res.status).toBe(201);
    const { request } = (await res.json()) as { request: { status: string } };
    expect(request.status).toBe("responded");

    const received = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "response_received"));
    const qualified = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "qualified_response"));
    expect(received).toHaveLength(1);
    expect(qualified).toHaveLength(1);
  });

  it("decline without reason is rejected; with reason stored", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");

    const noReason = await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ companyId: provider.id, type: "decline" }),
    });
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { error: string }).error).toBe("decline_requires_reason");

    const ok = await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ companyId: provider.id, type: "decline", reason: "no crew available" }),
    });
    expect(ok.status).toBe(201);
  });

  it("interest response without capacity declaration is rejected", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");
    const res = await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ companyId: provider.id, type: "interest" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("capacity_declaration_required");
  });

  it("first booking wins: second confirmation rejected", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");
    const response = (
      await (
        await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            companyId: provider.id,
            type: "interest",
            workersCount: 3,
            availableFrom: "2026-11-02",
          }),
        })
      ).json()
    ) as { response: { id: string } };

    const book = await SELF.fetch(`https://example.com/api/requests/${id}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.response.id,
        startDate: "2026-11-05",
        endDate: "2026-11-09",
        workersCount: 3,
      }),
    });
    expect(book.status).toBe(201);
    expect(((await book.json()) as { request: { status: string } }).request.status).toBe("booked");

    const second = await SELF.fetch(`https://example.com/api/requests/${id}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.response.id,
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        workersCount: 2,
      }),
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toContain("already_booked");

    const rows = await db().select().from(bookings).where(eq(bookings.requestId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startDate).toBe("2026-11-05");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "booking_confirmed"));
    expect(events).toHaveLength(1);
  });

  it("records outcomes and closes the request", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");
    const response = (
      await (
        await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            companyId: provider.id,
            type: "quote",
            workersCount: 2,
            availableFrom: "2026-11-02",
          }),
        })
      ).json()
    ) as { response: { id: string } };
    await SELF.fetch(`https://example.com/api/requests/${id}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        responseId: response.response.id,
        startDate: "2026-11-05",
        endDate: "2026-11-09",
        workersCount: 2,
      }),
    });

    const noShow = await SELF.fetch(`https://example.com/api/requests/${id}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ outcome: "accepted_but_not_delivered", reason: "crew never showed" }),
    });
    expect(noShow.status).toBe(200);
    const { request, booking } = (await noShow.json()) as {
      request: { status: string };
      booking: { outcome: string };
    };
    expect(request.status).toBe("closed");
    expect(booking.outcome).toBe("accepted_but_not_delivered");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "accepted_but_not_delivered"));
    expect(events).toHaveLength(1);
  });

  it("customer cancellation from in_outreach stores attribution and reason", async () => {
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");
    await transition(id, "in_outreach");

    const noAttribution = await SELF.fetch(`https://example.com/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "project dropped" }),
    });
    expect(noAttribution.status).toBe(400);

    const res = await SELF.fetch(`https://example.com/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "project dropped" }),
    });
    expect(res.status).toBe(200);
    const cancelled = (await res.json()) as { status: string; cancelledBy: string };
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBe("customer");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "request_cancelled"));
    expect(events).toHaveLength(1);
  });

  it("request history returns events in chronological order", async () => {
    const provider = await createProvider();
    const { body } = await createRequest();
    const id = body.id as string;
    await transition(id, "approved");
    await transition(id, "matched");
    await SELF.fetch(`https://example.com/api/requests/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        type: "interest",
        workersCount: 3,
        availableFrom: "2026-11-02",
      }),
    });

    const history = (await (
      await SELF.fetch(`https://example.com/api/requests/${id}/history`, { headers: authHeaders })
    ).json()) as { action: string; occurredAt: string }[];
    expect(history.length).toBeGreaterThanOrEqual(4);
    const times = history.map((e) => e.occurredAt);
    expect([...times].sort()).toEqual(times);
    expect(history.map((e) => e.action)).toContain("request_created");
    expect(history.map((e) => e.action)).toContain("request_approved");
    expect(history.map((e) => e.action)).toContain("response_received");
  });
});

describe("event atomicity", () => {
  it("failed mutation writes neither data nor event", async () => {
    const { privateKey } = (globalThis as any).__testAccessKey;
    const attackerHeaders = accessHeaders(
      await makeAccessToken(privateKey, { email: "staff@example.com" }),
    );
    // provider create fails on duplicate: data and event both absent for the failed attempt
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...attackerHeaders },
      body: JSON.stringify({
        legalName: "A",
        registrationIdentifier: "dup-1",
        contactEmail: "a@b.c",
      }),
    });
    expect(providerRes.status).toBe(201);
    const before = await db().select().from(auditEvents);
    const failRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...attackerHeaders },
      body: JSON.stringify({
        legalName: "B",
        registrationIdentifier: "dup-1",
        contactEmail: "b@b.c",
      }),
    });
    expect(failRes.status).toBe(409);
    const after = await db().select().from(auditEvents);
    expect(after.length).toBe(before.length);

    // request with invalid trade: nothing written
    const badRequest = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...attackerHeaders },
      body: JSON.stringify({
        title: "t",
        description: "d",
        location: "l",
        trade: "welding",
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    expect(badRequest.status).toBe(400);
    const final = await db().select().from(auditEvents);
    expect(final.length).toBe(after.length);
    const reqRows = await db().select().from(requests);
    expect(reqRows).toHaveLength(0);
  });
});

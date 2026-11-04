import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { applyEmailLifecycleEvent } from "../src/worker/email/events";
import {
  auditEvents,
  companies,
  emailSuppressions,
  emailTokens,
  outreachEntries,
  requests,
  services,
  timeEntries,
  users,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  await db().delete(auditEvents);
  await db().delete(timeEntries);
  await db().delete(services);
  await db().delete(companies);
  await db().delete(requests);
});

async function createRequest(overrides: Record<string, unknown> = {}) {
  const res = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: `Request ${Math.random()}`,
      description: "Work",
      location: "Tallinn",
      trade: "electrical",
      startDate: "2026-11-02",
      crewSize: 2,
      ...overrides,
    }),
  });
  return (await res.json()) as { id: string };
}

async function transition(id: string, to: string) {
  await SELF.fetch(`https://example.com/api/requests/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to }),
  });
}

async function overview() {
  const res = await SELF.fetch("https://example.com/api/dashboard/overview", {
    headers: authHeaders,
  });
  return (await res.json()) as {
    eligibleRequests: number;
    numerator: { qualifiedWithin24h: number; booked: number };
    denominators: { successRate: number; conversion: number };
    successRate: number | null;
    conversion: number | null;
  };
}

describe("funnel dashboard", () => {
  it("computes eligible requests and success rate with numerators and denominators", async () => {
    const r1 = await createRequest();
    await transition(r1.id, "approved");

    const m = await overview();
    expect(m.eligibleRequests).toBe(1);
    expect(m.denominators.successRate).toBe(1);
    expect(m.numerator.qualifiedWithin24h).toBe(0);
    expect(m.successRate).toBe(0);
  });

  it("customer-cancelled requests excluded from success denominator but counted in volume", async () => {
    const r1 = await createRequest();
    await transition(r1.id, "approved");
    await transition(r1.id, "matched");
    await transition(r1.id, "in_outreach");
    await SELF.fetch(`https://example.com/api/requests/${r1.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "project dropped" }),
    });

    const m = await overview();
    // approved -> eligible volume 1, but cancelled-by-customer excluded from denominator
    expect(m.eligibleRequests).toBe(1);
    expect(m.denominators.successRate).toBe(0);
  });

  it("open requests excluded from conversion denominator", async () => {
    const r1 = await createRequest();
    await transition(r1.id, "approved");

    const m = await overview();
    expect(m.denominators.conversion).toBe(0);
    expect(m.conversion).toBeNull();
  });

  it("counts conversion from booked/closed requests", async () => {
    const r1 = await createRequest();
    await transition(r1.id, "approved");
    await db().update(requests).set({ status: "booked" }).where(eq(requests.id, r1.id));
    await db().insert(auditEvents).values({
      actorUserId: "seed",
      actorEmail: "seed",
      entity: "request",
      entityId: r1.id,
      action: "booking_confirmed",
      channel: "manual",
      occurredAt: new Date().toISOString(),
    });

    const m = await overview();
    expect(m.denominators.conversion).toBe(1);
    expect(m.numerator.booked).toBe(1);
    expect(m.conversion).toBe(1);
  });

  it("qualified response within 24h counts toward success rate", async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "Spark OÜ",
        registrationIdentifier: `sp-${Math.random()}`,
        contactEmail: "spark@example.com",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };

    const r1 = await createRequest();
    await transition(r1.id, "approved");
    await transition(r1.id, "matched");
    await SELF.fetch(`https://example.com/api/requests/${r1.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        companyId: provider.id,
        type: "interest",
        workersCount: 2,
        availableFrom: "2026-11-02",
      }),
    });

    const m = await overview();
    expect(m.numerator.qualifiedWithin24h).toBe(1);
    expect(m.successRate).toBe(1);
  });

  it("supply view marks per-trade minimums met/unmet", async () => {
    // 7 electrical providers (min 6 -> met), 1 flooring (min 4 -> unmet)
    for (let i = 0; i < 7; i++) {
      const p = (await (
        await SELF.fetch("https://example.com/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            legalName: `El ${i}`,
            registrationIdentifier: `el-${Math.random()}`,
            contactEmail: `el${i}@example.com`,
          }),
        }).then((r) => r.json())
      )) as { id: string };
      await SELF.fetch(`https://example.com/api/providers/${p.id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
      });
    }
    const f = (await (
      await SELF.fetch("https://example.com/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          legalName: "Floor OÜ",
          registrationIdentifier: `fl-${Math.random()}`,
          contactEmail: "fl@example.com",
        }),
      }).then((r) => r.json())
    )) as { id: string };
    await SELF.fetch(`https://example.com/api/providers/${f.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "flooring", serviceArea: "Tartu", pricingModel: "m2" }),
    });

    const res = await SELF.fetch("https://example.com/api/dashboard/supply", {
      headers: authHeaders,
    });
    const supply = (await res.json()) as {
      trade: string;
      minimum: number;
      activeProviders: number;
      met: boolean;
    }[];
    const electrical = supply.find((s) => s.trade === "electrical")!;
    const flooring = supply.find((s) => s.trade === "flooring")!;
    expect(electrical).toEqual({ trade: "electrical", minimum: 6, activeProviders: 7, met: true });
    expect(flooring).toEqual({ trade: "flooring", minimum: 4, activeProviders: 1, met: false });
  });

  it("effort view: minutes + interventions per request and weekly trend", async () => {
    const r1 = await createRequest();
    await SELF.fetch(`https://example.com/api/requests/${r1.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ minutes: 45 }),
    });
    await transition(r1.id, "approved");

    const res = await SELF.fetch("https://example.com/api/dashboard/effort", {
      headers: authHeaders,
    });
    const effort = (await res.json()) as {
      perRequest: { id: string; totalMinutes: number; manualEvents: number }[];
      weekly: { week: string; minutes: number; interventions: number }[];
    };
    const row = effort.perRequest.find((r) => r.id === r1.id)!;
    expect(row.totalMinutes).toBe(45);
    expect(row.manualEvents).toBeGreaterThanOrEqual(2);
    expect(effort.weekly.length).toBeGreaterThan(0);
    expect(effort.weekly[0]!.interventions).toBeGreaterThan(0);
  });
});

describe("per-provider email delivery metrics (SUBC-011)", () => {
  beforeEach(async () => {
    // Provision the staff user (requireStaff upserts on first auth) — storage
    // is isolated per test in vitest-pool-workers.
    await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
    await db().delete(auditEvents);
    await db().delete(emailTokens);
    await db().delete(emailSuppressions);
    await db().delete(outreachEntries);
  });

  async function staffUserId(): Promise<string> {
    const user = (
      await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
    )[0];
    if (!user) throw new Error("staff user not provisioned");
    return user.id;
  }

  let deliveryRegCounter = 0;

  async function createProvider() {
    const res = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: `OÜ Delivery ${++deliveryRegCounter}`,
        registrationIdentifier: `reg-delivery-${deliveryRegCounter}-${Math.random()}`,
        contactEmail: `delivery${deliveryRegCounter}-${Math.random()}@example.com`,
      }),
    });
    return (await res.json()) as { id: string; contactEmail: string; legalName: string };
  }

  async function createMatchedRequest() {
    const reqRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: `Delivery request ${Math.random()}`,
        description: "Work",
        location: "Tallinn",
        trade: "electrical",
        startDate: "2026-11-10",
        crewSize: 2,
      }),
    });
    const request = (await reqRes.json()) as { id: string };
    for (const to of ["approved", "matched"]) {
      await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    return request.id;
  }

  async function emailDelivery(query = "") {
    const res = await SELF.fetch(`https://example.com/api/dashboard/email-delivery${query}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      providers: {
        companyId: string;
        legalName: string;
        contactEmail: string;
        sent: number;
        delivered: number;
        opened: number;
        bounced: number;
        skipped: number;
        bounceRate: number | null;
        suppressed: boolean;
      }[];
      totals: {
        sent: number;
        delivered: number;
        opened: number;
        bounced: number;
        skipped: number;
        bounceRate: number | null;
      };
    };
  }

  it("returns zeroed rows for an empty database", async () => {
    const data = await emailDelivery();
    expect(data.providers).toEqual([]);
    expect(data.totals).toEqual({
      sent: 0,
      delivered: 0,
      opened: 0,
      bounced: 0,
      skipped: 0,
      bounceRate: null,
    });
  });

  it("computes per-provider counts, bounce rate, suppression, and totals", async () => {
    const staffId = await staffUserId();

    // Provider A: one sent email that hard-bounced → suppression row.
    const a = await createProvider();
    const requestA = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId: requestA,
      providerIds: [a.id],
      staffUserId: staffId,
      staffEmail: "staff@example.com",
    });
    await applyEmailLifecycleEvent(drizzle(env.DB), {
      kind: "bounced",
      to: a.contactEmail,
      permanent: true,
      source: "webhook",
    });

    // Provider B: two sends — one delivered, one opened.
    const b = await createProvider();
    for (const status of ["delivered", "opened"]) {
      const requestId = await createMatchedRequest();
      await sendOutreachWithStub({
        requestId,
        providerIds: [b.id],
        staffUserId: staffId,
        staffEmail: "staff@example.com",
      });
      const entry = (
        await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
      )[0]!;
      await db()
        .update(outreachEntries)
        .set({ emailStatus: status })
        .where(eq(outreachEntries.id, entry.id));
    }

    // Provider C: one skipped entry only (suppressed address, never sent).
    const c = await createProvider();
    await db().insert(outreachEntries).values({
      id: crypto.randomUUID(),
      requestId: (await createMatchedRequest()) as string,
      companyId: c.id,
      batchNumber: `E-skip-${Math.random()}`,
      contactedBy: staffId,
      channel: "email",
      emailStatus: "skipped",
      emailSkippedReason: "email_suppressed",
      sentAt: new Date().toISOString(),
    });

    const data = await emailDelivery();
    const rowA = data.providers.find((p) => p.companyId === a.id)!;
    const rowB = data.providers.find((p) => p.companyId === b.id)!;
    const rowC = data.providers.find((p) => p.companyId === c.id)!;

    expect(rowA).toMatchObject({
      sent: 1,
      delivered: 0,
      opened: 0,
      bounced: 1,
      skipped: 0,
      bounceRate: 1,
      suppressed: true,
    });
    expect(rowB).toMatchObject({
      sent: 2,
      delivered: 2,
      opened: 1,
      bounced: 0,
      skipped: 0,
      bounceRate: 0,
      suppressed: false,
    });
    // Skipped-only provider: nothing dispatched → no denominator, no rate.
    expect(rowC).toMatchObject({
      sent: 0,
      delivered: 0,
      opened: 0,
      bounced: 0,
      skipped: 1,
      bounceRate: null,
      suppressed: false,
    });

    // Rows ordered by bounced DESC, sent DESC.
    expect(data.providers.map((p) => p.companyId)).toEqual([a.id, b.id, c.id]);

    // Totals: skipped excluded from the sent denominator.
    expect(data.totals).toEqual({
      sent: 3,
      delivered: 2,
      opened: 1,
      bounced: 1,
      skipped: 1,
      bounceRate: 1 / 3,
    });
  });

  it("filters rows by from/to on sentAt", async () => {
    const staffId = await staffUserId();
    const a = await createProvider();
    const requestA = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId: requestA,
      providerIds: [a.id],
      staffUserId: staffId,
      staffEmail: "staff@example.com",
    });
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestA))
    )[0]!;
    // Backdate A's entry into January.
    await db()
      .update(outreachEntries)
      .set({ sentAt: "2026-01-15T10:00:00.000Z" })
      .where(eq(outreachEntries.id, entry.id));

    const b = await createProvider();
    const requestB = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId: requestB,
      providerIds: [b.id],
      staffUserId: staffId,
      staffEmail: "staff@example.com",
    });

    const all = await emailDelivery();
    expect(all.providers).toHaveLength(2);

    const recent = await emailDelivery("?from=2026-06-01");
    expect(recent.providers.map((p) => p.companyId)).toEqual([b.id]);

    const oldOnly = await emailDelivery("?from=2026-01-01&to=2026-02-01");
    expect(oldOnly.providers.map((p) => p.companyId)).toEqual([a.id]);
  });
});

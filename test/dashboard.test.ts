import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, companies, requests, services, timeEntries } from "../src/worker/db/schema";
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

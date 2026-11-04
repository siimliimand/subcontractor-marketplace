import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { availabilityDeclarations, auditEvents, companies } from "../src/worker/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { freshness, summariseDeclarations } from "../src/worker/availability";

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
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(companies);
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: "OÜ Kapasiteet",
      registrationIdentifier: `reg-avail-${Math.random()}`,
      contactEmail: "info@kapasiteet.ee",
      ...overrides,
    }),
  });
  return (await res.json()) as { id: string };
}

function postAvailability(companyId: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://example.com/api/providers/${companyId}/availability`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
}

describe("availability freshness helper", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("classifies boundary ages: <7 current, 7-14 aging, 14-30 stale, >30 expired", () => {
    expect(freshness("2026-10-20T11:59:00Z", now)).toBe("current");
    expect(freshness("2026-10-13T12:01:00Z", now)).toBe("current"); // 7d minus 1min
    expect(freshness("2026-10-13T11:59:00Z", now)).toBe("aging"); // 7d plus 1min
    expect(freshness("2026-10-06T12:01:00Z", now)).toBe("aging"); // 14d minus 1min
    expect(freshness("2026-10-06T11:59:00Z", now)).toBe("stale"); // 14d plus 1min
    expect(freshness("2026-09-20T13:00:00Z", now)).toBe("stale"); // 30d minus 1h
    expect(freshness("2026-09-20T11:00:00Z", now)).toBe("expired"); // 30d plus 1h
    expect(freshness("2026-08-01T00:00:00Z", now)).toBe("expired");
  });
});

describe("availability declarations routes", () => {
  it("records a declaration with confirmation timestamp and lists it with freshness", async () => {
    const provider = await createProvider();
    const res = await postAvailability(provider.id, {
      trade: "electrical",
      workersCount: 3,
      dateFrom: "2026-11-02",
      dateTo: "2026-11-20",
      channel: "booking_system",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      workersCount: number;
      lastConfirmedAt: string;
      freshness: string;
    };
    expect(body.workersCount).toBe(3);
    expect(body.freshness).toBe("current");
    expect(body.lastConfirmedAt).toBeTruthy();

    const list = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/availability`,
      { headers: authHeaders },
    );
    const listBody = (await list.json()) as { declarations: unknown[]; summary: { confirmedWorkers: number } };
    expect(listBody.declarations).toHaveLength(1);
    expect(listBody.summary.confirmedWorkers).toBe(3);
  });

  it("validates workers count and date range", async () => {
    const provider = await createProvider();
    const badWorkers = await postAvailability(provider.id, {
      trade: "electrical",
      workersCount: 0,
      dateFrom: "2026-11-02",
      dateTo: "2026-11-20",
    });
    expect(badWorkers.status).toBe(400);

    const badRange = await postAvailability(provider.id, {
      trade: "electrical",
      workersCount: 2,
      dateFrom: "2026-11-20",
      dateTo: "2026-11-02",
    });
    expect(badRange.status).toBe(400);

    const badTrade = await postAvailability(provider.id, {
      trade: "welding",
      workersCount: 2,
      dateFrom: "2026-11-02",
      dateTo: "2026-11-20",
    });
    expect(badTrade.status).toBe(400);
  });

  it("summary treats expired declarations as no confirmed capacity", async () => {
    const provider = await createProvider();
    await db().insert(availabilityDeclarations).values({
      companyId: provider.id,
      trade: "electrical",
      workersCount: 4,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      channel: "booking_system",
      lastConfirmedAt: "2026-09-01T00:00:00Z", // ~49 days old: expired
      createdBy: userId,
    });
    const list = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/availability`,
      { headers: authHeaders },
    );
    const body = (await list.json()) as {
      summary: { confirmedWorkers: number; hasFreshDeclarations: boolean };
    };
    expect(body.summary.confirmedWorkers).toBe(0);
    expect(body.summary.hasFreshDeclarations).toBe(false);
  });

  it("summary counts fresh declarations that overlap the requested range only", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const mk = (
      workersCount: number,
      dateFrom: string,
      dateTo: string,
      lastConfirmedAt = "2026-10-18T00:00:00Z",
    ) => ({
      id: `d-${Math.random()}`,
      companyId: "c1",
      trade: "electrical",
      workersCount,
      dateFrom,
      dateTo,
      channel: "booking_system" as const,
      lastConfirmedAt,
      notes: null,
      createdBy: null,
      createdAt: lastConfirmedAt,
    });
    // fresh declaration covering week 48, fresh declaration for week 50
    const summary = summariseDeclarations(
      [mk(3, "2026-11-23", "2026-11-27"), mk(2, "2026-12-07", "2026-12-11")],
      { dateFrom: "2026-11-24", dateTo: "2026-11-28", now },
    );
    expect(summary.confirmedWorkers).toBe(3);
    expect(summary.hasFreshDeclarations).toBe(true);
    expect(summary.states.current).toBe(2);
  });
});

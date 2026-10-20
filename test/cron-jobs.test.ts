import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  companies,
  emailTokens,
  holds,
  outreachEntries,
  requests,
  responses,
  services,
  users,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { widenTimedOutRequests } from "../src/worker/cron/widening";
import { purgeExpiredArtifacts } from "../src/worker/cron/retention";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(emailTokens);
  await db().delete(auditEvents);
  await db().delete(holds);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Provider + request walked to `in_outreach` with a matching batch whose
 * entries are backdated `ageHours` old. `widenSuffix` pre-marks the batch as
 * widened; `withResponse` adds a qualified response.
 */
async function seedOutreachRequest(opts: {
  ageHours: number;
  widenSuffix?: boolean;
  withResponse?: boolean;
  status?: string;
}) {
  const staff = (await db().select().from(users).limit(1)).at(0)!;

  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Cron ${++regCounter}`,
      registrationIdentifier: `reg-cron-${regCounter}`,
      contactEmail: `cron${regCounter}@x.ee`,
    }),
  });
  const provider = (await providerRes.json()) as { id: string };
  // A second candidate so widening has someone new to contact.
  const provider2Res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Cron B ${regCounter}`,
      registrationIdentifier: `reg-cron-b-${regCounter}`,
      contactEmail: `cronb${regCounter}@x.ee`,
    }),
  });
  const provider2 = (await provider2Res.json()) as { id: string };
  for (const p of [provider, provider2]) {
    await SELF.fetch(`https://example.com/api/providers/${p.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
    });
  }

  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Cron widening job",
      description: "d",
      location: "Tallinn",
      trades: ["electrical"],
      startDate: "2026-11-02",
      crewSize: 3,
    }),
  });
  const request = (await requestRes.json()) as { id: string };
  for (const to of ["approved", "matched"]) {
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to }),
    });
  }

  const createdAt = new Date(Date.now() - opts.ageHours * HOUR_MS).toISOString();
  await db().insert(outreachEntries).values({
    requestId: request.id,
    companyId: provider.id,
    batchNumber: `M-test-00001${opts.widenSuffix ? "-w" : ""}`,
    contactedBy: staff.id,
    channel: "matching",
    trade: "electrical",
    matchScore: 0.8,
    matchFactorsJson: "{}",
    sentAt: createdAt,
  });

  if (opts.withResponse) {
    await db().insert(responses).values({
      requestId: request.id,
      companyId: provider.id,
      type: "interest",
      workersCount: 3,
      availableFrom: "2026-11-02",
      createdBy: staff.id,
    });
  }

  await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to: opts.status ?? "in_outreach" }),
  });

  return { request, provider, provider2 };
}

const entries = (requestId: string) =>
  db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId));

describe("timeout-triggered widening (cron)", () => {
  it("widens a silent request past the timeout once, with an automated matched event", async () => {
    const { request, provider2 } = await seedOutreachRequest({ ageHours: 10 });

    const outcomes = await widenTimedOutRequests(db(), {
      now: new Date(),
      timeoutHours: 8,
      actor: null,
    });

    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.requestId).toBe(request.id);
    expect(outcomes[0]!.created).toBeGreaterThanOrEqual(1);

    const rows = await entries(request.id);
    const widened = rows.filter((e) => e.batchNumber.endsWith("-w"));
    expect(widened.length).toBeGreaterThanOrEqual(1);
    expect(widened.map((e) => e.companyId)).toContain(provider2.id);

    const events = await db().select().from(auditEvents);
    const matched = events.filter((e) => e.action === "matched" && e.entityId === request.id);
    const auto = matched.find((e) => e.channel === "automated");
    expect(auto).toBeDefined();
    expect(JSON.parse(auto!.payloadJson ?? "{}").reason).toBe("widening_timeout");
    expect(auto!.actorEmail).toBeNull();

    // Second run: already widened — no-op.
    const again = await widenTimedOutRequests(db(), {
      now: new Date(),
      timeoutHours: 8,
      actor: null,
    });
    expect(again.length).toBe(0);
    expect((await entries(request.id)).length).toBe(rows.length);
  });

  it("skips requests inside the timeout window", async () => {
    await seedOutreachRequest({ ageHours: 2 });
    const outcomes = await widenTimedOutRequests(db(), {
      now: new Date(),
      timeoutHours: 8,
      actor: null,
    });
    expect(outcomes.length).toBe(0);
  });

  it("never widens when a qualified response already arrived", async () => {
    const { request } = await seedOutreachRequest({ ageHours: 10, withResponse: true });
    const outcomes = await widenTimedOutRequests(db(), {
      now: new Date(),
      timeoutHours: 8,
      actor: null,
    });
    expect(outcomes.length).toBe(0);
    expect((await entries(request.id)).filter((e) => e.batchNumber.endsWith("-w")).length).toBe(0);
  });

  it("never widens an already-widened request", async () => {
    const { request } = await seedOutreachRequest({ ageHours: 10, widenSuffix: true });
    const outcomes = await widenTimedOutRequests(db(), {
      now: new Date(),
      timeoutHours: 8,
      actor: null,
    });
    expect(outcomes.length).toBe(0);
    expect((await entries(request.id)).length).toBe(1);
  });
});

describe("retention purge (cron)", () => {
  it("purges expired tokens and terminal holds, keeps fresh or active ones", async () => {
    const staff = (await db().select().from(users).limit(1)).at(0)!;
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: `OÜ Retention ${++regCounter}`,
        registrationIdentifier: `reg-ret-${regCounter}`,
        contactEmail: `ret${regCounter}@x.ee`,
      }),
    });
    const provider = (await providerRes.json()) as { id: string };
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Retention fixtures",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    const request = (await requestRes.json()) as { id: string };

    const entry = await db()
      .insert(outreachEntries)
      .values({
        requestId: request.id,
        companyId: provider.id,
        batchNumber: "M-ret-1",
        contactedBy: staff.id,
        channel: "manual",
        trade: "electrical",
      })
      .returning()
      .then((r) => r[0]!);

    const now = Date.now();
    await db().insert(emailTokens).values([
      // expired 40 days ago → purge (default window 30)
      { jti: `jti-old-${regCounter}`, outreachEntryId: entry.id, purpose: "accept", expiresAt: new Date(now - 40 * 24 * HOUR_MS).toISOString() },
      // expires in 7 days → keep
      { jti: `jti-fresh-${regCounter}`, outreachEntryId: entry.id, purpose: "accept", expiresAt: new Date(now + 7 * 24 * HOUR_MS).toISOString() },
    ]);

    await db().insert(holds).values([
      // released 100 days ago → purge (default window 90)
      {
        requestId: request.id,
        companyId: provider.id,
        trade: "electrical",
        startDate: "2026-11-02",
        endDate: "2026-11-10",
        workersCount: 2,
        state: "released",
        releasedReason: "test",
        expiresAt: new Date(now - 100 * 24 * HOUR_MS).toISOString(),
        createdBy: staff.id,
        createdAt: new Date(now - 100 * 24 * HOUR_MS).toISOString(),
        updatedAt: new Date(now - 100 * 24 * HOUR_MS).toISOString(),
      },
      // active hold, old → keep (active is never purged)
      {
        requestId: request.id,
        companyId: provider.id,
        trade: "electrical",
        startDate: "2026-11-12",
        endDate: "2026-11-20",
        workersCount: 2,
        state: "active",
        expiresAt: new Date(now + 24 * HOUR_MS).toISOString(),
        createdBy: staff.id,
        createdAt: new Date(now - 100 * 24 * HOUR_MS).toISOString(),
        updatedAt: new Date(now - 100 * 24 * HOUR_MS).toISOString(),
      },
    ]);

    const result = await purgeExpiredArtifacts(db(), {
      now: new Date(),
      tokenRetentionDays: 30,
      holdRetentionDays: 90,
    });

    expect(result.tokensDeleted).toBe(1);
    expect(result.holdsDeleted).toBe(1);
    const tokens = await db().select().from(emailTokens);
    expect(tokens.map((t) => t.jti)).toEqual([`jti-fresh-${regCounter}`]);
    const remainingHolds = await db().select().from(holds);
    expect(remainingHolds.map((h) => h.state)).toEqual(["active"]);
  });
});

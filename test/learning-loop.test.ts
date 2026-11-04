import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  bookings,
  companies,
  outreachEntries,
  requests,
  responses,
  services,
  users,
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
  await db().delete(auditEvents);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;
let bookCounter = 0;

async function createProvider(trade = "electrical") {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Loop ${++regCounter}`,
      registrationIdentifier: `reg-loop-${regCounter}`,
      contactEmail: `loop${regCounter}@x.ee`,
    }),
  });
  const provider = (await res.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ trade, serviceArea: "Tallinn", pricingModel: "hour", skills: "general" }),
  });
  return provider;
}

async function createRequest() {
  const res = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: `Learning request ${regCounter}`,
      description: "d",
      location: "Tallinn",
      trades: ["electrical"],
      startDate: "2026-11-02",
      crewSize: 2,
    }),
  });
  const request = (await res.json()) as { id: string };
  for (const to of ["approved"]) {
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to }),
    });
  }
  return request;
}

/** Seed history: `n` bookings for the provider with the given outcome/attribution. */
async function seedBookingHistory(
  providerId: string,
  entries: { outcome: string | null; cancelledBy?: string }[],
) {
  const staff = (await db().select().from(users).limit(1))[0]!;
  for (const spec of entries) {
    const request = await db()
      .insert(requests)
      .values({
        title: `history-${++bookCounter}`,
        description: "d",
        location: "Tallinn",
        trade: "electrical",
        startDate: "2026-10-01",
        crewSize: 1,
        status: "closed",
        createdBy: staff.id,
      })
      .returning()
      .then((r) => r[0]!);
    const response = await db()
      .insert(responses)
      .values({
        requestId: request.id,
        companyId: providerId,
        type: "interest",
        workersCount: 1,
        availableFrom: "2026-10-01",
        createdBy: staff.id,
      })
      .returning()
      .then((r) => r[0]!);
    await db().insert(bookings).values({
      requestId: request.id,
      responseId: response.id,
      companyId: providerId,
      trade: "electrical",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      workersCount: 1,
      outcome: spec.outcome,
      cancelledBy: spec.cancelledBy ?? null,
      createdBy: staff.id,
    });
  }
}

type Factors = Record<string, { value: number; weighted: number; missing: boolean; inputs: Record<string, unknown> }>;

async function matchAndGetFactors(requestId: string) {
  const res = await SELF.fetch(`https://example.com/api/requests/${requestId}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: "{}",
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    runs: { candidates: { companyId: string; factors: Factors }[] }[];
  };
  return body.runs[0]!.candidates;
}

async function widenAndGetFactors(requestId: string) {
  const res = await SELF.fetch(`https://example.com/api/requests/${requestId}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ widen: true }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    runs: { candidates: { companyId: string; factors: Factors }[] }[];
  };
  return body.runs[0]!.candidates;
}

describe("outcome-driven factors (learning loop)", () => {
  it("reliability reflects completions, failures and provider-attributed cancellations", async () => {
    const veteran = await createProvider();
    await seedBookingHistory(veteran.id, [
      { outcome: "completion_confirmed" },
      { outcome: "completion_confirmed" },
      { outcome: "accepted_but_not_delivered" },
      { outcome: "cancelled", cancelledBy: "provider" },
    ]);
    const customerCancelled = await createProvider();
    // Phase 4: reliability scores only above the details/05 minimum sample
    // (3 finished outcomes) — three completions + one customer-caused
    // cancellation keeps the invariant observable (3/3 = 1.0, no penalty).
    await seedBookingHistory(customerCancelled.id, [
      { outcome: "completion_confirmed" },
      { outcome: "completion_confirmed" },
      { outcome: "completion_confirmed" },
      { outcome: "cancelled", cancelledBy: "customer" },
    ]);
    const newbie = await createProvider();
    await seedBookingHistory(newbie.id, [{ outcome: "completion_confirmed" }]);
    // The batch caps at 2 per specialisation; tie-break is legalName, so name
    // the newbie ahead of the others to keep it inside the batch.
    await SELF.fetch(`https://example.com/api/providers/${newbie.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ legalName: "OÜ A Newbie" }),
    });

    const request = await createRequest();
    // Initial batch (diversity-capped) + one widen round — together they
    // surface all three providers' factor breakdowns.
    const candidates = await matchAndGetFactors(request.id);
    const widened = await widenAndGetFactors(request.id);
    const byId = new Map([...candidates, ...widened].map((c) => [c.companyId, c]));

    const veteranReliability = byId.get(veteran.id)!.factors.reliability!;
    expect(veteranReliability.missing).toBe(false);
    // 2 completed - 1 failed - 1 provider-cancelled over 4 + 1 = 0/5
    expect(veteranReliability.value).toBe(0);
    expect(veteranReliability.inputs.providerCancellations).toBe(1);

    // Customer-attributed cancellation does NOT count against the provider:
    // 3 completed / 3 finished outcomes = 1.0 (the customer cancellation is
    // excluded entirely).
    const customerRel = byId.get(customerCancelled.id)!.factors.reliability!;
    expect(customerRel.missing).toBe(false);
    expect(customerRel.value).toBe(1);
    expect(customerRel.inputs.providerCancellations).toBe(0);

    // Phase 4: a provider below the minimum sample is neutral (missing), not
    // scored — history absence is never a negative signal.
    const newbieRel = byId.get(newbie.id)!.factors.reliability!;
    expect(newbieRel.missing).toBe(true);
    expect(newbieRel.value).toBe(0);
    expect(newbieRel.weighted).toBe(0);
  });

  it("scores providers without history as missing (zero contribution), never defaulted", async () => {
    const newcomer = await createProvider();
    const request = await createRequest();
    const candidates = await matchAndGetFactors(request.id);
    const c = candidates.find((x) => x.companyId === newcomer.id)!;
    expect(c.factors.responseHistory?.missing).toBe(true);
    expect(c.factors.responseHistory?.weighted).toBe(0);
    expect(c.factors.reliability?.missing).toBe(true);
    expect(c.factors.reliability?.weighted).toBe(0);
  });
});

describe("runtime weights", () => {
  it("returns defaults, accepts a reasoned override, and uses it in subsequent matches", async () => {
    // Defaults
    const get1 = await SELF.fetch("https://example.com/api/matching/weights", { headers: authHeaders });
    const body1 = (await get1.json()) as { weights: Record<string, number>; defaults: Record<string, number> };
    expect(body1.defaults.confirmedCapacity).toBe(0.25);
    expect(body1.weights.confirmedCapacity).toBe(0.25);

    // Validation
    const noReason = await SELF.fetch("https://example.com/api/matching/weights", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ factor: "reliability", weight: 0.4 }),
    });
    expect(noReason.status).toBe(400);
    const badFactor = await SELF.fetch("https://example.com/api/matching/weights", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ factor: "payment", weight: 0.4, reason: "nope" }),
    });
    expect(badFactor.status).toBe(400);
    const badWeight = await SELF.fetch("https://example.com/api/matching/weights", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ factor: "reliability", weight: 1.5, reason: "too much" }),
    });
    expect(badWeight.status).toBe(400);

    // Effective override
    const put = await SELF.fetch("https://example.com/api/matching/weights", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ factor: "responseHistory", weight: 0.5, reason: "pilot tuning: responses predict conversion" }),
    });
    expect(put.status).toBe(200);
    const get2 = (await (
      await SELF.fetch("https://example.com/api/matching/weights", { headers: authHeaders })
    ).json()) as { weights: Record<string, number>; overrides: Record<string, number> };
    expect(get2.weights.responseHistory).toBe(0.5);
    expect(get2.overrides.responseHistory).toBe(0.5);

    // A subsequent match snapshots the overridden weights
    const provider = await createProvider();
    const request = await createRequest();
    await matchAndGetFactors(request.id);
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, request.id))
    )[0]!;
    const stored = JSON.parse(entry.matchFactorsJson ?? "{}") as {
      factors: Factors;
      weights: Record<string, number>;
    };
    expect(stored.weights.responseHistory).toBe(0.5);
    expect(Object.keys(stored.factors).length).toBe(7);
    void provider;
  });
});

describe("post-hoc explainability data", () => {
  it("stores the full factor breakdown readable from the outreach entry", async () => {
    await createProvider();
    const request = await createRequest();
    await matchAndGetFactors(request.id);

    const detail = (await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}`, { headers: authHeaders })
    ).json()) as {
      outreach: { entry: { channel: string; matchFactorsJson: string | null; matchScore: number | null } }[];
    };
    const entry = detail.outreach[0]!.entry;
    expect(entry.channel).toBe("matching");
    expect(entry.matchScore).not.toBeNull();
    const stored = JSON.parse(entry.matchFactorsJson!) as {
      factors: Record<string, { missing: boolean; inputs: Record<string, unknown> }>;
      weights: Record<string, number>;
    };
    expect(stored.factors.confirmedCapacity?.missing).toBeDefined();
    expect(typeof stored.factors.confirmedCapacity?.missing).toBe("boolean");
    expect(stored.weights.proximity).toBe(0.1);
  });
});

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
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;
let userId: string;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  const me = await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  userId = ((await me.json()) as { id: string }).id;
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

let counter = 0;

async function createProviderWithService(trade: string, opts: { noService?: boolean } = {}) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Compare ${trade} ${++counter}`,
      registrationIdentifier: `reg-cmp-${counter}`,
      contactEmail: `cmp${counter}@x.ee`,
    }),
  });
  const provider = (await res.json()) as { id: string };
  if (!opts.noService) {
    await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade, serviceArea: "Tallinn", pricingModel: "hour" }),
    });
  }
  return provider;
}

async function createTwoTradeRequestWithResponses() {
  const electricalProvider = await createProviderWithService("electrical");
  const drywallProvider = await createProviderWithService("drywall");
  const outsider = await createProviderWithService("painting");

  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Two trade refit",
      description: "Floors and lights",
      location: "Tallinn",
      trades: ["electrical", "drywall"],
      startDate: "2026-11-02",
      crewSize: 4,
    }),
  });
  const request = (await requestRes.json()) as { id: string };

  // fresh booking_system declaration → confirmed; none → unconfirmed
  await db().insert(availabilityDeclarations).values({
    companyId: electricalProvider.id,
    trade: "electrical",
    workersCount: 3,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-30",
    channel: "booking_system",
    lastConfirmedAt: new Date().toISOString(),
    createdBy: userId,
  });
  await db().insert(availabilityDeclarations).values({
    companyId: drywallProvider.id,
    trade: "drywall",
    workersCount: 2,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-30",
    channel: "email_only",
    lastConfirmedAt: new Date().toISOString(),
    createdBy: userId,
  });

  for (const [provider, type] of [
    [electricalProvider, "quote"],
    [drywallProvider, "interest"],
    [outsider, "interest"],
  ] as const) {
    await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type,
        companyId: provider.id,
        workersCount: 2,
        availableFrom: "2026-11-03",
        reason: type === "quote" ? "9000 EUR" : undefined,
      }),
    });
  }
  // matching-generated entry attributes the drywall provider explicitly
  await db().insert(outreachEntries).values({
    requestId: request.id,
    companyId: drywallProvider.id,
    batchNumber: "M-test",
    contactedBy: userId,
    channel: "matching",
    trade: "drywall",
    matchScore: 0.42,
  });

  return { request, electricalProvider, drywallProvider, outsider };
}

describe("response comparison grouped by trade", () => {
  it("groups responses per required trade with availability freshness; email-only and undeclared are Unconfirmed", async () => {
    const { request, electricalProvider, drywallProvider, outsider } =
      await createTwoTradeRequestWithResponses();

    const detail = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    const body = (await detail.json()) as {
      comparison: {
        trade: string;
        isPrimary: boolean;
        entries: {
          companyId: string;
          availability: { label: string; confirmedWorkers: number };
        }[];
      }[];
    };

    const electrical = body.comparison.find((g) => g.trade === "electrical");
    const drywall = body.comparison.find((g) => g.trade === "drywall");
    const ungrouped = body.comparison.find((g) => g.trade === "ungrouped");

    expect(electrical?.isPrimary).toBe(true);
    expect(electrical?.entries.map((e) => e.companyId)).toEqual([electricalProvider.id]);
    // API returns the freshness state; UI renders "Confirmed" for current
    expect(electrical?.entries[0]!.availability).toEqual({ label: "current", confirmedWorkers: 3 });

    expect(drywall?.entries.map((e) => e.companyId)).toEqual([drywallProvider.id]);
    // email_only declarations are never confirmed capacity
    expect(drywall?.entries[0]!.availability.label).toBe("unconfirmed");
    expect(drywall?.entries[0]!.availability.confirmedWorkers).toBe(0);

    // painter responds to an electrical+drywall request → ungrouped
    expect(ungrouped?.entries.map((e) => e.companyId)).toEqual([outsider.id]);
  });
});

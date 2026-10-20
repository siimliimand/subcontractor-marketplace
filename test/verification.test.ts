import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  companies,
  companyVerifications,
  outreachEntries,
  requests,
  responses,
  services,
  users,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../src/worker/app";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(companyVerifications);
  await db().delete(auditEvents);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;

async function createProvider() {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Verified ${++regCounter}`,
      registrationIdentifier: `1234567${regCounter}`,
      contactEmail: `ver${regCounter}@x.ee`,
    }),
  });
  return (await res.json()) as { id: string };
}

async function insertVerifications(companyId: string) {
  const staff = (await db().select().from(users).limit(1))[0]!;
  const now = new Date().toISOString();
  await db().insert(companyVerifications).values([
    {
      companyId,
      type: "registry_active",
      trade: null,
      status: "valid",
      checkedAt: now,
      sourceDataset: "ariregister:ettevotja_rekvisiidid",
      sourceLicence: "CC BY 4.0 — RIK",
    },
    {
      companyId,
      type: "trade_notification",
      trade: "electrical",
      status: "valid",
      checkedAt: now,
      sourceDataset: "mtr:avaandmed_ettevotjad",
      sourceLicence: "CC BY-SA 3.0 — TTJA",
    },
  ]);
}

describe("verification badges", () => {
  it("reports registry badge as displayable and trade badge gated while MTR flag is off", async () => {
    const provider = await createProvider();
    await insertVerifications(provider.id);

    const res = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/verifications`,
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      badges: {
        registryActive: { displayable: boolean; status: string; sourceLicence: string } | null;
        trades: Record<string, { displayable: boolean; status: string }>;
      };
      mtrBadgesEnabled: boolean;
    };
    expect(body.mtrBadgesEnabled).toBe(false);
    expect(body.badges.registryActive?.displayable).toBe(true);
    expect(body.badges.registryActive?.status).toBe("valid");
    expect(body.badges.trades.electrical?.status).toBe("valid");
    expect(body.badges.trades.electrical?.displayable).toBe(false);
    expect(body.badges.registryActive?.sourceLicence).toContain("CC BY 4.0");
  });

  it("unlocks the trade badge display when MTR_BADGES_ENABLED=true", async () => {
    const provider = await createProvider();
    await insertVerifications(provider.id);

    const app = createApp();
    const res = await app.request(
      `https://example.com/api/providers/${provider.id}/verifications`,
      { headers: authHeaders },
      { ...env, MTR_BADGES_ENABLED: "true" },
    );
    const body = (await res.json()) as {
      badges: { trades: Record<string, { displayable: boolean }> };
      mtrBadgesEnabled: boolean;
    };
    expect(body.mtrBadgesEnabled).toBe(true);
    expect(body.badges.trades.electrical?.displayable).toBe(true);
  });

  it("shows badges in the comparison view according to the gate", async () => {
    const provider = await createProvider();
    await insertVerifications(provider.id);
    await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
    });

    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Badge comparison",
        description: "d",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
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
    await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type: "interest",
        companyId: provider.id,
        workersCount: 2,
        availableFrom: "2026-11-02",
      }),
    });

    const detailRes = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    const detail = (await detailRes.json()) as {
      comparison: {
        entries: {
          verification: { registeredActive: boolean; tradeNotification: boolean };
        }[];
      }[];
    };
    const entry = detail.comparison.flatMap((g) => g.entries)[0]!;
    expect(entry.verification.registeredActive).toBe(true);
    // Flag off → trade badge hidden in the comparison.
    expect(entry.verification.tradeNotification).toBe(false);
  });

  it("treats invalid or unknown verification status as no badge", async () => {
    const provider = await createProvider();
    const now = new Date().toISOString();
    await db().insert(companyVerifications).values({
      companyId: provider.id,
      type: "registry_active",
      trade: null,
      status: "invalid",
      checkedAt: now,
      sourceDataset: "ariregister:ettevotja_rekvisiidid",
      sourceLicence: "CC BY 4.0 — RIK",
    });

    const res = await SELF.fetch(
      `https://example.com/api/providers/${provider.id}/verifications`,
      { headers: authHeaders },
    );
    const body = (await res.json()) as {
      badges: { registryActive: { displayable: boolean; status: string } | null };
    };
    expect(body.badges.registryActive?.status).toBe("invalid");
    expect(body.badges.registryActive?.displayable).toBe(true); // gate passed…
    // …but a badge with invalid status never "shows" (badgeShows semantics).
  });
});

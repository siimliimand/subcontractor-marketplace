import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, companies, outreachEntries, requests } from "../src/worker/db/schema";
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
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(companies);
});

async function setupRequestInMatched(providerCount = 2) {
  const providerIds: string[] = [];
  for (let i = 0; i < providerCount; i++) {
    const res = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: `Provider ${i}`,
        registrationIdentifier: `reg-${Date.now()}-${i}`,
        contactEmail: `p${i}@example.com`,
      }),
    });
    providerIds.push(((await res.json()) as { id: string }).id);
  }
  const reqRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Bathroom plumbing",
      description: "Install pipework",
      location: "Tartu",
      trade: "plumbing",
      startDate: "2026-11-10",
      crewSize: 2,
    }),
  });
  const request = (await reqRes.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to: "approved" }),
  });
  await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to: "matched" }),
  });
  return { requestId: request.id, providerIds };
}

async function logOutreach(requestId: string, providerIds: string[]) {
  return SELF.fetch(`https://example.com/api/requests/${requestId}/outreach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ providerIds }),
  });
}

describe("outreach log", () => {
  it("logs a batch: shared batch number, per-provider entries, outreach_sent events", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(3);
    const res = await logOutreach(requestId, providerIds);
    expect(res.status).toBe(201);
    const result = (await res.json()) as {
      batchNumber: string;
      accepted: string[];
      requestStatus: string;
    };
    expect(result.accepted).toHaveLength(3);
    expect(result.requestStatus).toBe("in_outreach");

    const entries = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, requestId));
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.batchNumber))).toEqual(
      new Set([result.batchNumber]),
    );
    expect(new Set(entries.map((e) => e.channel))).toEqual(new Set(["manual"]));

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "outreach_sent"));
    expect(events).toHaveLength(3);
  });

  it("rejects duplicate provider-request pairs and names the existing batch", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(2);
    await logOutreach(requestId, [providerIds[0]!]);

    const second = await logOutreach(requestId, [providerIds[0]!, providerIds[1]!]);
    expect(second.status).toBe(201);
    const result = (await second.json()) as {
      accepted: string[];
      rejected: { companyId: string; reason: string }[];
    };
    expect(result.accepted).toEqual([providerIds[1]]);
    expect(result.rejected[0]!.companyId).toBe(providerIds[0]);
    expect(result.rejected[0]!.reason).toContain("duplicate_outreach");
    expect(result.rejected[0]!.reason).toMatch(/batch B-/);
  });

  it("rejects opted-out providers, showing the opt-out reason; others unaffected", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(2);
    await SELF.fetch(`https://example.com/api/providers/${providerIds[0]}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ status: "opted_out", reason: "blacklisted by crew" }),
    });

    const res = await logOutreach(requestId, providerIds);
    expect(res.status).toBe(201);
    const result = (await res.json()) as {
      accepted: string[];
      rejected: { companyId: string; reason: string }[];
    };
    expect(result.accepted).toEqual([providerIds[1]]);
    expect(result.rejected[0]!.reason).toContain("provider_opted_out");
    expect(result.rejected[0]!.reason).toContain("blacklisted by crew");

    const entries = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, requestId));
    expect(entries.map((e) => e.companyId)).toEqual([providerIds[1]]);
  });

  it("rejects outreach after booked or cancelled", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    await logOutreach(requestId, [providerIds[0]!]);
    await SELF.fetch(`https://example.com/api/requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "postponed" }),
    });

    const res = await logOutreach(requestId, [providerIds[0]!]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("closed for outreach");
  });
});

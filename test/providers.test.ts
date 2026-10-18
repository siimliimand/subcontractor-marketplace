import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, companies, users } from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

const accessKey = () => (globalThis as any).__testAccessKey;
let authHeaders: Record<string, string>;

beforeEach(async () => {
  authHeaders = accessHeaders(
    await makeAccessToken(accessKey().privateKey, { email: "staff@example.com" }),
  );
});

afterEach(async () => {
  await db().delete(auditEvents);
  await db().delete(companies);
  await db().delete(users).where(eq(users.email, "staff@example.com"));
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  return SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: "OÜ Elektrimees",
      registrationIdentifier: "12345678",
      contactEmail: "info@elektrimees.ee",
      ...overrides,
    }),
  });
}

describe("provider administration", () => {
  it("creates a provider and records provider_created event", async () => {
    const res = await createProvider();
    expect(res.status).toBe(201);
    const provider = (await res.json()) as { id: string; status: string };
    expect(provider.status).toBe("active");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "provider_created"));
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(provider.id);
    expect(events[0]!.channel).toBe("manual");
  });

  it("rejects missing contact email", async () => {
    const res = await createProvider({ contactEmail: undefined });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("contact_email_required");
    const rows = await db().select().from(companies);
    expect(rows).toHaveLength(0);
  });

  it("rejects duplicate registration identifier and names existing provider", async () => {
    await createProvider();
    const res = await createProvider({ legalName: "Teine OÜ" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("registration_identifier_exists");
    const rows = await db().select().from(companies);
    expect(rows).toHaveLength(1);
  });

  it("filters providers by trade and status", async () => {
    const p1 = await (await createProvider()).json() as { id: string };
    const p2 = await (await createProvider({ legalName: "OÜ Veehatt", registrationIdentifier: "87654321" })).json() as { id: string };
    await SELF.fetch(`https://example.com/api/providers/${p1.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "m2" }),
    });
    await SELF.fetch(`https://example.com/api/providers/${p2.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "plumbing", serviceArea: "Tartu", pricingModel: "hour" }),
    });

    const res = await SELF.fetch("https://example.com/api/providers?trade=plumbing&status=active", {
      headers: authHeaders,
    });
    const list = (await res.json()) as { company: { id: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.company.id).toBe(p2.id);
  });

  it("adds a valid service; rejects invalid trade and pricing model naming allowed values", async () => {
    const provider = (await (await createProvider()).json()) as { id: string };

    const ok = await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "m2" }),
    });
    expect(ok.status).toBe(201);

    const badTrade = await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "welding", serviceArea: "Tallinn", pricingModel: "m2" }),
    });
    expect(badTrade.status).toBe(400);
    expect(((await badTrade.json()) as { error: string }).error).toContain("electrical");

    const badModel = await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "day" }),
    });
    expect(badModel.status).toBe(400);
    expect(((await badModel.json()) as { error: string }).error).toContain("hour, m2, project");
  });

  it("opt-out requires reason and blocks future outreach candidate selection", async () => {
    const provider = (await (await createProvider()).json()) as { id: string };

    const noReason = await SELF.fetch(`https://example.com/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ status: "opted_out" }),
    });
    expect(noReason.status).toBe(400);

    const ok = await SELF.fetch(`https://example.com/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ status: "opted_out", reason: "no capacity for pilot" }),
    });
    expect(ok.status).toBe(200);
    const updated = (await ok.json()) as { status: string; statusReason: string };
    expect(updated.status).toBe("opted_out");
    expect(updated.statusReason).toBe("no capacity for pilot");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "provider_updated"));
    expect(events).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  companies,
  outreachEntries,
  regions,
  requests,
  requestTrades,
  responses,
  serviceRegions,
  services,
  trades,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { resetCatalogCache } from "../src/worker/catalog";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(serviceRegions);
  await db().delete(auditEvents);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(requestTrades);
  await db().delete(services);
  await db().delete(companies);
  await db().delete(trades).where(eq(trades.slug, "demolition"));
  await db().delete(regions);
  resetCatalogCache();
});

describe("trade catalog", () => {
  it("serves the seeded pilot trades without deploy", async () => {
    const res = await SELF.fetch("https://example.com/api/catalog", { headers: authHeaders });
    const body = (await res.json()) as { trades: { slug: string }[] };
    const slugs = body.trades.map((t) => t.slug);
    expect(slugs).toContain("electrical");
    expect(slugs).toContain("painting");
  });

  it("adding a trade enables it for new requests immediately (no deploy)", async () => {
    const added = await SELF.fetch("https://example.com/api/catalog/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "demolition", label: "Demolition", pilotMinimum: 4 }),
    });
    expect(added.status).toBe(201);
    resetCatalogCache();

    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Tear down wall",
        description: "Demolition",
        location: "Tallinn",
        trades: ["demolition"],
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    expect(requestRes.status).toBe(201);
  });

  it("duplicate trade is rejected; deactivation preserves history but blocks new selection", async () => {
    const dupe = await SELF.fetch("https://example.com/api/catalog/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "electrical", label: "Electrical" }),
    });
    expect(dupe.status).toBe(409);

    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Wiring",
        description: "Rewiring",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    const request = (await requestRes.json()) as { id: string };

    const deactivated = await SELF.fetch("https://example.com/api/catalog/trades/electrical/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "pilot ends for this trade" }),
    });
    expect(deactivated.status).toBe(200);
    resetCatalogCache();

    // New selection blocked…
    const newRequest = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "More wiring",
        description: "Rewiring",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    expect(newRequest.status).toBe(400);

    // …but history is intact and the in-flight request still viewable.
    const view = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    expect(view.status).toBe(200);
    expect(((await view.json()) as { request: { trade: string } }).request.trade).toBe("electrical");

    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "trade"));
    // Migration seeds carry no audit event; the deactivation does.
    expect(events.map((e) => e.action)).toContain("trade_deactivated");

    // Reactivation works via the add endpoint.
    const reactivated = await SELF.fetch("https://example.com/api/catalog/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "electrical", label: "Electrical" }),
    });
    expect(reactivated.status).toBe(200);
    expect(((await reactivated.json()) as { reactivated: boolean }).reactivated).toBe(true);
  });
});

describe("region catalog and provider coverage", () => {
  it("validates request region against the catalog; omits cleanly", async () => {
    await SELF.fetch("https://example.com/api/catalog/regions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "harju", name: "Harju maakond" }),
    });
    resetCatalogCache();

    const bad = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "R",
        description: "D",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
        region: "nowhere",
      }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("invalid_region");

    const good = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "R2",
        description: "D",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
        region: "harju",
      }),
    });
    expect(good.status).toBe(201);
    const created = (await good.json()) as { region: string | null };
    expect(created.region).toBe("harju");

    // Region-absent requests stay valid.
    const none = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "R3",
        description: "D",
        location: "Tartu",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    expect(none.status).toBe(201);
    expect(((await none.json()) as { region: string | null }).region).toBeNull();
  });

  it("provider coverage set/replace is validated and stored", async () => {
    for (const slug of ["harju", "tartu"]) {
      await SELF.fetch("https://example.com/api/catalog/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ slug, name: slug }),
      });
    }
    resetCatalogCache();
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ Regional",
        registrationIdentifier: `reg-region-${Date.now()}`,
        contactEmail: "regional@x.ee",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };

    const bad = await SELF.fetch(`https://example.com/api/providers/${provider.id}/regions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ regions: ["harju", "nowhere"] }),
    });
    expect(bad.status).toBe(400);

    const set = await SELF.fetch(`https://example.com/api/providers/${provider.id}/regions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ regions: ["harju", "tartu"] }),
    });
    expect(set.status).toBe(200);
    const read = await SELF.fetch(`https://example.com/api/providers/${provider.id}/regions`, {
      headers: authHeaders,
    });
    const body = (await read.json()) as { regions: string[] };
    expect(body.regions.sort()).toEqual(["harju", "tartu"]);
  });
});

describe("region-aware matching", () => {
  it("restricts candidates to covering or coverage-optional providers and names the filter", async () => {
    await SELF.fetch("https://example.com/api/catalog/regions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "harju", name: "Harju" }),
    });
    await SELF.fetch("https://example.com/api/catalog/regions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ slug: "tartu", name: "Tartu" }),
    });
    resetCatalogCache();

    // Provider A covers harju; provider B declared only tartu; provider C declares nothing.
    const mkProvider = async (name: string, reg: string, regionsToSet: string[]) => {
      const res = await SELF.fetch("https://example.com/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ legalName: name, registrationIdentifier: reg, contactEmail: `${reg}@x.ee` }),
      });
      const provider = (await res.json()) as { id: string };
      await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
      });
      if (regionsToSet.length) {
        await SELF.fetch(`https://example.com/api/providers/${provider.id}/regions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ regions: regionsToSet }),
        });
      }
      return provider;
    };
    const a = await mkProvider("OÜ A", `reg-ra-${Date.now()}`, ["harju"]);
    const b = await mkProvider("OÜ B", `reg-rb-${Date.now()}`, ["tartu"]);
    const c = await mkProvider("OÜ C", `reg-rc-${Date.now()}`, []);

    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Regional request",
        description: "Work in Harju",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 2,
        region: "harju",
      }),
    });
    const request = (await requestRes.json()) as { id: string };
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to: "approved" }),
    });

    const matchRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    expect(matchRes.status).toBe(201);
    const body = (await matchRes.json()) as {
      runs: {
        regionFilter: string | null;
        candidates: { companyId: string }[];
        excluded: { companyId: string; reason: string }[];
      }[];
    };
    const run = body.runs[0]!;
    expect(run.regionFilter).toBe("harju");
    const picked = run.candidates.map((x) => x.companyId);
    expect(picked).toContain(a.id); // covers harju
    expect(picked).toContain(c.id); // coverage-optional stays eligible
    expect(picked).not.toContain(b.id); // tartu-only excluded
    expect(
      run.excluded.find((e) => e.companyId === b.id)?.reason,
    ).toBe("region_not_covered: harju");
  });
});

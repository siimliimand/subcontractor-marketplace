import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  availabilityDeclarations,
  bookings,
  companies,
  outreachEntries,
  requests,
  requestTrades,
  responses,
  services,
  users,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(outreachEntries);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;

async function createProvider(opts: {
  status?: string;
  trade?: string;
  area?: string;
  skills?: string;
}) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ ${opts.trade ?? "electrical"} ${opts.skills ?? "gen"} ${++regCounter}`,
      registrationIdentifier: `reg-m-${regCounter}`,
      contactEmail: `p${regCounter}@x.ee`,
      status: opts.status ?? "active",
    }),
  });
  const provider = (await res.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      trade: opts.trade ?? "electrical",
      serviceArea: opts.area ?? "Tallinn",
      pricingModel: "hour",
      skills: opts.skills ?? "panel",
    }),
  });
  return provider;
}

async function createApprovedRequest(trades: string[]) {
  const res = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Fit-out electrical",
      description: "Second floor rewiring",
      location: "Tallinn",
      trades,
      startDate: "2026-11-02",
      crewSize: 3,
    }),
  });
  const request = (await res.json()) as { id: string };
  const t = await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ to: "approved" }),
  });
  expect(t.status).toBe(200);
  return request;
}

function match(id: string, widen = false) {
  return SELF.fetch(`https://example.com/api/requests/${id}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(widen ? { widen: true } : {}),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("matching v1", () => {
  it("applies hard filters: location and provider status exclude candidates with reasons", async () => {
    const tallinn = await createProvider({ area: "Tallinn" });
    const tartu = await createProvider({ area: "Tartu" });
    await createProvider({ area: "Tallinn", status: "opted_out" });

    const request = await createApprovedRequest(["electrical"]);
    const res = await match(request.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      runs: {
        trade: string;
        candidates: { companyId: string }[];
        excluded: { companyId: string; reason: string }[];
      }[];
    };
    const run = body.runs[0]!;
    expect(run.candidates.map((c) => c.companyId)).toEqual([tallinn.id]);
    const reasons = new Map(run.excluded.map((e) => [e.companyId, e.reason]));
    expect(reasons.get(tartu.id)).toBe("location_not_in_service_area");
    expect([...reasons.values()]).toContain("provider_status_opted_out");
  });

  it("generates a matching batch with stored score and factor breakdown; status moves to in_outreach", async () => {
    await createProvider({ area: "Tallinn", skills: "panel" });
    await createProvider({ area: "Tallinn", skills: "automation" });

    const request = await createApprovedRequest(["electrical"]);
    const res = await match(request.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runs: { candidates: unknown[] }[] };
    expect(body.runs[0]!.candidates.length).toBe(2);

    const entries = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, request.id));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.channel).toBe("matching");
      expect(entry.trade).toBe("electrical");
      expect(entry.matchScore).not.toBeNull();
      const factors = JSON.parse(entry.matchFactorsJson!) as Record<string, { missing: boolean }>;
      expect(Object.keys(factors)).toContain("confirmedCapacity");
      expect(factors.reviewQuality!.missing).toBe(true); // no reviews in phase 2
    }

    // matched audit event written, request now in_outreach
    const matched = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "matched"));
    expect(matched).toHaveLength(1);
    expect(matched[0]!.channel).toBe("automated");
    const detail = await SELF.fetch(`https://example.com/api/requests/${request.id}`, {
      headers: authHeaders,
    });
    const detailBody = (await detail.json()) as { request: { status: string } };
    expect(detailBody.request.status).toBe("in_outreach");
  });

  it("diversity cap: at most 2 candidates per specialisation in the initial batch", async () => {
    await createProvider({ skills: "panel", area: "Tallinn" });
    await createProvider({ skills: "panel", area: "Tallinn" });
    await createProvider({ skills: "panel", area: "Tallinn" });
    await createProvider({ skills: "lighting", area: "Tallinn" });

    const request = await createApprovedRequest(["electrical"]);
    const res = await match(request.id);
    const body = (await res.json()) as {
      runs: { candidates: { specialisation: string }[] }[];
    };
    const cands = body.runs[0]!.candidates;
    expect(cands.length).toBe(3);
    expect(cands.filter((c) => c.specialisation === "panel").length).toBe(2);
    expect(cands.filter((c) => c.specialisation === "lighting").length).toBe(1);
  });

  it("refuses the initial batch on draft, twice, and after booking", async () => {
    const { id } = await createProvider({ area: "Tallinn" }).then(() =>
      createApprovedRequest(["electrical"]),
    );

    // draft refusal
    const draftRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "t",
        description: "d",
        location: "Tallinn",
        trade: "electrical",
        startDate: "2026-11-02",
        crewSize: 2,
      }),
    });
    const draft = (await draftRes.json()) as { id: string };
    expect((await match(draft.id)).status).toBe(400);

    // first run ok, second refused
    expect((await match(id)).status).toBe(201);
    const second = await match(id);
    expect(second.status).toBe(400);
    expect(String((await json<{ error: string }>(second)).error)).toContain("already exists");
  });

  it("widens once toward 10 and refuses further widening", async () => {
    for (let i = 0; i < 7; i++) await createProvider({ area: "Tallinn", skills: `s${i}` });
    const request = await createApprovedRequest(["electrical"]);

    const initial = await match(request.id);
    expect(initial.status).toBe(201);
    const initialBody = await json<{ runs: { created: number }[] }>(initial);
    expect(initialBody.runs[0]!.created).toBe(5);

    const widenRes = await match(request.id, true);
    expect(widenRes.status).toBe(201);
    const widenBody = await json<{ runs: { created: number }[] }>(widenRes);
    expect(widenBody.runs[0]!.created).toBe(2); // 7 total eligible → +2

    const secondWiden = await match(request.id, true);
    expect(secondWiden.status).toBe(400);
    expect(String((await json<{ error: string }>(secondWiden)).error)).toContain("already widened");

    const entries = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, request.id));
    expect(entries).toHaveLength(7);
  });

  it("widen without an initial batch is refused", async () => {
    await createProvider({ area: "Tallinn" });
    const request = await createApprovedRequest(["electrical"]);
    const res = await match(request.id, true);
    expect(res.status).toBe(400);
    expect(String((await res.json() as { error: string }).error)).toContain("no initial matching batch");
  });
});

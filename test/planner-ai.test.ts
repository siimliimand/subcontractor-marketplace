import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  bookingRequests,
  bookings,
  companies,
  outreachEntries,
  requests,
  requestTrades,
  responses,
  services,
  holds,
  availabilityDeclarations,
  projectPlans,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../src/worker/app";
import { draftPlanFromGrounding, type GroundingStats } from "../src/worker/planner";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

const plannerApp = createApp();
async function plannerFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return plannerApp.request(
    `https://example.com${path}`,
    {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    { ...env, PLANNER_AI_ENABLED: "true", AI: fakeAi.binding } as typeof env,
  );
}

// Stub AI binding (phase-3 practice: the real binding never enters the test
// runtime; the module receives it via env and is exercised with a stub).
const fakeAi = {
  binding: {
    async run(model: string, inputs: unknown) {
      return { response: `Sequencing draft by ${model}: ${JSON.stringify(inputs).slice(0, 40)}…` };
    },
  },
};

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(projectPlans);
  await db().delete(availabilityDeclarations);
  await db().delete(auditEvents);
  await db().delete(bookingRequests);
  await db().delete(holds);
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(requestTrades);
  await db().delete(services);
  await db().delete(companies);
});

/** Real funnel booking, marked completion_confirmed — grounding seed data. */
async function seedCompletedBooking(trade = "electrical", workers = 3): Promise<void> {
  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Planner ${Math.random().toString(36).slice(2, 7)}`,
      registrationIdentifier: `reg-pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contactEmail: `pl${Math.random().toString(36).slice(2, 5)}@x.ee`,
    }),
  });
  const provider = (await providerRes.json()) as { id: string };
  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Seed booking",
      description: "Done work",
      location: "Tallinn",
      trades: [trade],
      startDate: "2026-09-01",
      crewSize: workers,
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
  const responseRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ type: "interest", companyId: provider.id, workersCount: workers, availableFrom: "2026-09-01" }),
  });
  const { response } = (await responseRes.json()) as { response: { id: string } };
  const brRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      responseId: response.id,
      trade,
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      workersCount: workers,
    }),
  });
  const br = (await brRes.json()) as { id: string };
  await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ bookingRequestId: br.id }),
  });
  await db()
    .update(bookings)
    .set({ outcome: "completion_confirmed", outcomeAt: new Date().toISOString() })
    .where(eq(bookings.requestId, request.id));
}

const emptyStats: GroundingStats = { requestCount: 0, trades: {} };

describe("deterministic planner core", () => {
  it("grounds suggestions in per-trade medians when history exists", () => {
    const stats: GroundingStats = {
      requestCount: 7,
      trades: {
        electrical: { bookings: 4, medianWorkers: 3, medianDays: 2 },
        drywall: { bookings: 3, medianWorkers: 2, medianDays: 5 },
      },
    };
    const plan = draftPlanFromGrounding(
      { id: "r1", title: "Fit-out", crewSize: 6, startDate: "2026-11-02", duration: null },
      ["electrical", "drywall"],
      stats,
    );
    expect(plan.label).toBe("draft");
    expect(plan.trades[0]).toMatchObject({ trade: "electrical", suggestedWorkers: 3, suggestedDays: 2 });
    expect(plan.trades[0]!.basis).toContain("4 completed");
    expect(plan.notes[0]).toContain("not a booking");
  });

  it("falls back to requested crew size with an explicit note when a trade has no history", () => {
    const plan = draftPlanFromGrounding(
      { id: "r1", title: "Fit-out", crewSize: 4, startDate: "2026-11-02", duration: null },
      ["electrical"],
      emptyStats,
    );
    expect(plan.trades[0]!.suggestedWorkers).toBe(4);
    expect(plan.trades[0]!.basis).toContain("no grounding data");
    expect(plan.notes.join(" ")).toContain("no completed electrical bookings");
  });
});

describe("planner routes", () => {
  it("flag off rejects generation outright", async () => {
    const res = await SELF.fetch("https://example.com/api/requests/nope/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("planner_disabled");
  });

  it("flag on: approved-only, explicit insufficient-grounding error, draft labelled, never acts", async () => {
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Grounded fit-out",
        description: "Work",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 3,
      }),
    });
    const request = (await requestRes.json()) as { id: string; status: string };

    // Draft status → refused.
    const draftAttempt = await plannerFetch(`/api/requests/${request.id}/plan`, { method: "POST", body: {} });
    expect(draftAttempt.status).toBe(400);
    expect(((await draftAttempt.json()) as { error: string }).error).toContain("approved");

    // Approve → no grounding data yet → explicit insufficiency, no fabrication.
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to: "approved" }),
    });
    const empty = await plannerFetch(`/api/requests/${request.id}/plan`, { method: "POST", body: {} });
    expect(empty.status).toBe(409);
    expect(((await empty.json()) as { error: string }).error).toContain("insufficient_grounding");

    // Grounding data exists (a completed booking) → draft generated.
    await seedCompletedBooking("electrical", 3);

    const generated = await plannerFetch(`/api/requests/${request.id}/plan`, { method: "POST", body: {} });
    expect(generated.status).toBe(201);
    const body = (await generated.json()) as {
      label: string;
      plan: { trades: { trade: string; suggestedWorkers: number; basis: string }[]; notes: string[] };
      model: string;
      disclaimer: string;
    };
    expect(body.label).toBe("draft");
    expect(body.disclaimer).toContain("not a booking");
    expect(body.plan.trades[0]!.suggestedWorkers).toBe(3);
    expect(body.plan.trades[0]!.basis).toContain("1 completed");
    expect(body.model).toContain("llama");

    // Generation produced no bookings/holds/outreach side effects.
    expect(await db().select().from(bookings)).toHaveLength(1);
    expect(await db().select().from(holds)).toHaveLength(0);
    expect(await db().select().from(outreachEntries)).toHaveLength(0);

    // Audit trail records the generation.
    const events = await db().select().from(auditEvents).where(eq(auditEvents.action, "planner_generated"));
    expect(events).toHaveLength(1);
  });

  it("feedback is stored with the plan and counted in the evaluation dataset", async () => {
    const requestRes = await SELF.fetch("https://example.com/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        title: "Feedback fit-out",
        description: "Work",
        location: "Tallinn",
        trades: ["electrical"],
        startDate: "2026-11-02",
        crewSize: 3,
      }),
    });
    const request = (await requestRes.json()) as { id: string };
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to: "approved" }),
    });
    await seedCompletedBooking("electrical", 2);

    const generated = (await (
      await plannerFetch(`/api/requests/${request.id}/plan`, { method: "POST", body: {} })
    ).json()) as { id: string };

    const feedback = await plannerFetch(`/api/plans/${generated.id}/feedback`, {
      method: "POST",
      body: { useful: false, comment: "team size too high" },
    });
    expect(feedback.status).toBe(200);

    const noBool = await plannerFetch(`/api/plans/${generated.id}/feedback`, {
      method: "POST",
      body: { comment: "no flag" },
    });
    expect(noBool.status).toBe(400);

    const dataset = await plannerFetch("/api/pilot/planner-feedback");
    const dsBody = (await dataset.json()) as { generated: number; notUseful: number; comments: string[] };
    expect(dsBody.generated).toBe(1);
    expect(dsBody.notUseful).toBe(1);
    expect(dsBody.comments).toContain("team size too high");
  });
});

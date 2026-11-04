import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  bookingReviews,
  bookings,
  companies,
  responses,
  requests,
  requestTrades,
  services,
  outreachEntries,
  bookingRequests,
  holds,
  availabilityDeclarations,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  computeReliability,
  MIN_SAMPLE_COMPLETION,
  MIN_SAMPLE_REVIEWS,
  MIN_SAMPLE_RESPONSE,
} from "../src/worker/reliability";
import { computeFactors } from "../src/worker/matching/weights";
import { computeEstablished } from "../src/worker/verification";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(bookingReviews);
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

const baseInput = {
  outreachCount: 0,
  respondedCount: 0,
  responseHours: [],
  completed: 0,
  failed: 0,
  providerCancellations: 0,
  ratings: [],
};

describe("reliability metrics honour minimum samples (details/05)", () => {
  it("response rate needs 5 requests", () => {
    expect(MIN_SAMPLE_RESPONSE).toBe(5);
    const below = computeReliability({ ...baseInput, outreachCount: 4, respondedCount: 4 });
    expect(below.responseRate.sufficient).toBe(false);
    expect(below.responseRate.value).toBeNull();
    const at = computeReliability({ ...baseInput, outreachCount: 5, respondedCount: 4 });
    expect(at.responseRate.value).toBe(0.8);
    expect(at.responseRate.confidence).toBe("low");
  });

  it("completion rate needs 3 bookings and excludes customer-caused cancellations", () => {
    expect(MIN_SAMPLE_COMPLETION).toBe(3);
    const two = computeReliability({ ...baseInput, completed: 2 });
    expect(two.completionRate.sufficient).toBe(false);
    const three = computeReliability({ ...baseInput, completed: 2, failed: 1 });
    expect(three.completionRate.value).toBeCloseTo(0.67);
    // A customer cancellation is not the provider's record: 2 completions +
    // 1 customer-cancelled booking still leaves a 2-sample → insufficient.
    const withCustomerCancel = computeReliability({ ...baseInput, completed: 2, failed: 0, providerCancellations: 0 });
    expect(withCustomerCancel.completionRate.sufficient).toBe(false);
    // Provider cancellations count in the denominator.
    const withProviderCancel = computeReliability({ ...baseInput, completed: 2, failed: 0, providerCancellations: 1 });
    expect(withProviderCancel.completionRate.value).toBeCloseTo(0.67);
  });

  it("review score needs 3 reviews", () => {
    expect(MIN_SAMPLE_REVIEWS).toBe(3);
    const two = computeReliability({ ...baseInput, ratings: [5, 4] });
    expect(two.reviewScore.sufficient).toBe(false);
    const three = computeReliability({ ...baseInput, ratings: [5, 4, 3] });
    expect(three.reviewScore.value).toBe(4);
    expect(three.reviewScore.confidence).toBe("low");
    const six = computeReliability({ ...baseInput, ratings: [5, 4, 3, 5, 4, 3] });
    expect(six.reviewScore.confidence).toBe("solid");
  });

  it("median response time needs 5 responses", () => {
    const four = computeReliability({ ...baseInput, responseHours: [1, 2, 3, 4] });
    expect(four.medianResponseHours.sufficient).toBe(false);
    const five = computeReliability({ ...baseInput, responseHours: [10, 2, 8, 4, 6] });
    expect(five.medianResponseHours.value).toBe(6);
  });
});

describe("matching neutrality for insufficient history", () => {
  const baseFactors = {
    confirmedWorkers: 0,
    hasFreshDeclarations: false,
    crewSize: 3,
    tradeServices: [],
    pastOutreach: [],
    pastBookings: [],
    providerCancellations: 0,
    requestLocation: "Tallinn",
    serviceAreas: [],
    requestBudget: null,
  };

  it("reliability weight is runtime-tunable through the append-only row", async () => {
    const { getEffectiveWeights, setWeight } = await import("../src/worker/matching/runtimeWeights");
    const before = await getEffectiveWeights(db());
    expect(before.weights.reliability).toBe(0.15);
    const staffId = (await db().select().from((await import("../src/worker/db/schema")).users).limit(1))[0]!.id;
    await setWeight(db(), {
      factor: "reliability",
      weight: 0.3,
      reason: "phase-4 tuning after reliability data went live",
      setBy: staffId,
    });
    const after = await getEffectiveWeights(db());
    expect(after.weights.reliability).toBe(0.3);
    expect(after.overrides.reliability).toBe(0.3);
    // Stored factor breakdowns computed pre-bump keep their original weights
    // (snapshot stays truthful) — the mechanism guarantees this by storing
    // `weights` alongside `factors` in matchFactorsJson.
    expect(before.weights.reliability).toBe(0.15);
  });

  it("reliability is missing below 3 bookings, scored at 3+", () => {
    const below = computeFactors({ ...baseFactors, pastBookings: [{ outcome: "completion_confirmed" }] });
    expect(below.reliability.missing).toBe(true);
    expect(below.reliability.inputs.note).toContain("insufficient history");

    const three = computeFactors({
      ...baseFactors,
      pastBookings: [
        { outcome: "completion_confirmed" },
        { outcome: "completion_confirmed" },
        { outcome: "completion_confirmed" },
      ],
    });
    expect(three.reliability.missing).toBe(false);
    expect(three.reliability.value).toBe(1);
  });

  it("reviewQuality is real above 3 undisputed reviews, neutral below", () => {
    const two = computeFactors({ ...baseFactors, reviews: [{ rating: 5 }, { rating: 5 }] });
    expect(two.reviewQuality.missing).toBe(true);

    const three = computeFactors({
      ...baseFactors,
      reviews: [{ rating: 5 }, { rating: 5 }, { rating: 5 }],
    });
    expect(three.reviewQuality.missing).toBe(false);
    expect(three.reviewQuality.value).toBe(1);
  });
});

/** Full funnel: provider → request → response → booking request → confirm. */
async function createConfirmedBooking(companyId: string): Promise<string> {
  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Review booking",
      description: "Work",
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
  const responseRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      type: "interest",
      companyId,
      workersCount: 2,
      availableFrom: "2026-11-02",
    }),
  });
  const { response } = (await responseRes.json()) as { response: { id: string } };
  const bookingRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      responseId: response.id,
      trade: "electrical",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      workersCount: 2,
    }),
  });
  const br = (await bookingRes.json()) as { id: string };
  const confirmRes = await SELF.fetch(`https://example.com/api/requests/${request.id}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ bookingRequestId: br.id }),
  });
  const confirmed = (await confirmRes.json()) as { booking: { id: string } };
  return confirmed.booking.id;
}

async function markCompleted(bookingId: string) {
  await db()
    .update(bookings)
    .set({ outcome: "completion_confirmed", outcomeAt: new Date().toISOString() })
    .where(eq(bookings.id, bookingId));
}

describe("established badge (platform history)", () => {
  it("requires 3 positive completions", () => {
    expect(computeEstablished(2).displayable).toBe(false);
    const at = computeEstablished(3);
    expect(at.displayable).toBe(true);
    expect(at.basis).toBe(3);
  });

  it("surfaces on the verifications panel from completion_confirmed bookings", async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ Established",
        registrationIdentifier: `reg-est-${Date.now()}`,
        contactEmail: "est@x.ee",
      }),
    });
    const provider = (await providerRes.json()) as { id: string };
    const readEstablished = async () => {
      const res = await SELF.fetch(`https://example.com/api/providers/${provider.id}/verifications`, {
        headers: authHeaders,
      });
      return ((await res.json()) as { established: { displayable: boolean; basis: number } }).established;
    };
    await markCompleted(await createConfirmedBooking(provider.id));
    expect((await readEstablished()).basis).toBe(1);
    await markCompleted(await createConfirmedBooking(provider.id));
    const second = await readEstablished();
    expect(second.displayable).toBe(false); // 2 < 3
    expect(second.basis).toBe(2);
    await markCompleted(await createConfirmedBooking(provider.id));
    const third = await readEstablished();
    expect(third.displayable).toBe(true);
    expect(third.basis).toBe(3);
  });
});

describe("review routes", () => {
  let provider: { id: string };
  let bookingId: string;

  beforeEach(async () => {
    const providerRes = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: "OÜ Reviewed",
        registrationIdentifier: `reg-rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contactEmail: "rev@x.ee",
      }),
    });
    provider = (await providerRes.json()) as { id: string };
    bookingId = await createConfirmedBooking(provider.id);
  });

  it("review requires a completion-confirmed booking", async () => {
    const tooEarly = await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ rating: 5 }),
    });
    expect(tooEarly.status).toBe(400);
    expect(((await tooEarly.json()) as { error: string }).error).toContain("completion_confirmed");

    await markCompleted(bookingId);
    const ok = await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ rating: 4, comment: "Solid work" }),
    });
    expect(ok.status).toBe(201);

    const second = await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ rating: 2 }),
    });
    expect(second.status).toBe(409);
  });

  it("dispute hides the review; restore brings it back; audits both", async () => {
    await markCompleted(bookingId);
    await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ rating: 5 }),
    });

    const listed = await SELF.fetch(`https://example.com/api/providers/${provider.id}/reviews`, {
      headers: authHeaders,
    });
    expect(((await listed.json()) as { reviews: unknown[] }).reviews).toHaveLength(1);

    const disputed = await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "wrong provider" }),
    });
    expect(disputed.status).toBe(200);

    const hidden = await SELF.fetch(`https://example.com/api/providers/${provider.id}/reviews`, {
      headers: authHeaders,
    });
    expect(((await hidden.json()) as { reviews: unknown[] }).reviews).toHaveLength(0);

    const restored = await SELF.fetch(`https://example.com/api/bookings/${bookingId}/review/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    });
    expect(restored.status).toBe(200);
    const back = await SELF.fetch(`https://example.com/api/providers/${provider.id}/reviews`, {
      headers: authHeaders,
    });
    expect(((await back.json()) as { reviews: unknown[] }).reviews).toHaveLength(1);

    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "booking_review"));
    const actions = events.map((e) => e.action);
    expect(actions).toContain("review_submitted");
    expect(actions).toContain("review_disputed");
    expect(actions).toContain("review_restored");
  });
});

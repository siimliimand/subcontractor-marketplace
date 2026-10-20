import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  availabilityDeclarations,
  companies,
  outreachEntries,
  requests,
  responses,
  services,
  timeEntries,
  users,
} from "../src/worker/db/schema";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(auditEvents);
  await db().delete(timeEntries);
  await db().delete(availabilityDeclarations);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(services);
  await db().delete(companies);
  await db().delete(requests);
});

const staff = () => staffUserId();

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

/** Insert a request with explicit timestamps + optional response/booking/outreach. */
async function seedRequest(opts: {
  createdAt: string;
  pmName?: string;
  approved?: boolean;
  customerCancelled?: boolean;
  qualifiedWithin24h?: boolean;
  booked?: boolean;
  status?: string;
  outreachCount?: number;
}) {
  const createdBy = await staff();
  const request = await db()
    .insert(requests)
    .values({
      title: `w-${Math.random()}`,
      description: "d",
      location: "Tallinn",
      trade: "electrical",
      startDate: "2026-11-02",
      crewSize: 2,
      status: opts.status ?? (opts.booked ? "booked" : opts.approved ? "in_outreach" : "draft"),
      pmName: opts.pmName ?? null,
      cancelledBy: opts.customerCancelled ? "customer" : null,
      cancelReason: opts.customerCancelled ? "customer changed mind" : null,
      createdBy,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    })
    .returning()
    .then((r) => r[0]!);

  const events: (typeof auditEvents.$inferInsert)[] = [];
  if (opts.approved) {
    events.push({
      actorUserId: createdBy,
      actorEmail: "staff@example.com",
      entity: "request",
      entityId: request.id,
      action: "request_approved",
      occurredAt: opts.createdAt,
      channel: "manual",
    });
    if (opts.qualifiedWithin24h) {
      const at = new Date(new Date(opts.createdAt).getTime() + 2 * 3_600_000).toISOString();
      events.push({
        actorUserId: createdBy,
        actorEmail: "staff@example.com",
        entity: "request",
        entityId: request.id,
        action: "qualified_response",
        occurredAt: at,
        channel: "manual",
      });
    }
    if (opts.booked) {
      const at = new Date(new Date(opts.createdAt).getTime() + 48 * 3_600_000).toISOString();
      events.push({
        actorUserId: createdBy,
        actorEmail: "staff@example.com",
        entity: "request",
        entityId: request.id,
        action: "booking_confirmed",
        occurredAt: at,
        channel: "manual",
      });
    }
  }
  if (opts.customerCancelled) {
    events.push({
      actorUserId: createdBy,
      actorEmail: "staff@example.com",
      entity: "request",
      entityId: request.id,
      action: "request_cancelled",
      occurredAt: opts.createdAt,
      channel: "manual",
    });
  }
  if (events.length > 0) await db().insert(auditEvents).values(events);
  return request;
}

const weekly = async (query = "") => {
  const res = await SELF.fetch(`https://example.com/api/dashboard/weekly${query}`, {
    headers: authHeaders,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { weeks: Record<string, unknown>[] }).weeks;
};

const W1 = "2026-10-05T10:00:00.000Z"; // Monday
const W2 = "2026-10-12T10:00:00.000Z"; // next Monday

describe("weekly dashboard", () => {
  it("computes cohort success/conversion and null when the denominator is empty", async () => {
    // Week 1: one approved request WITH a fast qualified response and a booking.
    await seedRequest({
      createdAt: W1,
      pmName: "Mari",
      approved: true,
      qualifiedWithin24h: true,
      booked: true,
    });
    // Week 2: an approved request with NO response (denominator 1, numerator 0).
    await seedRequest({ createdAt: W2, pmName: "Jaan", approved: true });

    const weeks = await weekly("?from=2026-10-01&to=2026-10-31");
    const w1 = weeks.find((w) => w.week === "2026-10-05") as Record<string, number | null>;
    const w2 = weeks.find((w) => w.week === "2026-10-12") as Record<string, number | null>;

    expect(w1.newRequests).toBe(1);
    expect(w1.successRate).toBe(1);
    expect(w1.bookingConversion).toBe(1); // cohort decided (booked)
    expect(w1.completedRequests).toBe(1);

    // Week 2: success denominator present (0%)…
    expect(w2.successRate).toBe(0);
    // …but nothing decided yet → conversion has no denominator → null, never 0.
    expect(w2.bookingConversion).toBeNull();
  });

  it("excludes customer-cancelled requests from the success denominator", async () => {
    await seedRequest({
      createdAt: W1,
      approved: true,
      customerCancelled: true,
      status: "cancelled",
    });
    const weeks = await weekly("?from=2026-10-01&to=2026-10-31");
    const w1 = weeks.find((w) => w.week === "2026-10-05") as Record<string, number | null>;
    // The only approved request was customer-cancelled → empty denominator.
    expect(w1.successRate).toBeNull();
  });

  it("computes availability confirmation, contact-per-request, repeat usage, adoption share and effort", async () => {
    const createdBy = await staff();

    // Provider supply: 2 active, 1 with a booking_system declaration.
    const p1 = await db()
      .insert(companies)
      .values({
        legalName: "A OÜ",
        registrationIdentifier: `reg-a-${Math.random()}`,
        contactEmail: `a-${Math.random()}@x.ee`,
      })
      .returning()
      .then((r) => r[0]!);
    const p2 = await db()
      .insert(companies)
      .values({
        legalName: "B OÜ",
        registrationIdentifier: `reg-b-${Math.random()}`,
        contactEmail: `b-${Math.random()}@x.ee`,
      })
      .returning()
      .then((r) => r[0]!);
    await db().insert(availabilityDeclarations).values({
      companyId: p1.id,
      trade: "electrical",
      workersCount: 2,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      channel: "booking_system",
      lastConfirmedAt: W1,
      createdBy,
    });
    await db().insert(availabilityDeclarations).values({
      companyId: p2.id,
      trade: "electrical",
      workersCount: 2,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      channel: "email_only",
      lastConfirmedAt: W1,
      createdBy,
    });

    // Two requests from the same PM → repeat usage 1.0; contact both.
    const r1 = await seedRequest({ createdAt: W1, pmName: "Mari", approved: true });
    const r2 = await seedRequest({ createdAt: W1, pmName: "Mari", approved: true });
    void r1;
    void r2;
    await db().insert(outreachEntries).values([
      {
        requestId: r1.id,
        companyId: p1.id,
        batchNumber: "M-w1",
        contactedBy: createdBy,
        channel: "matching",
        trade: "electrical",
        sentAt: W1,
      },
      {
        requestId: r2.id,
        companyId: p2.id,
        batchNumber: "M-w1b",
        contactedBy: createdBy,
        channel: "matching",
        trade: "electrical",
        sentAt: W1,
      },
    ]);

    // Responses: one with capacity (confirms), one decline (excluded from denominator).
    await db().insert(responses).values([
      {
        requestId: r1.id,
        companyId: p1.id,
        type: "interest",
        workersCount: 2,
        availableFrom: "2026-11-02",
        receivedAt: W1,
        createdBy,
      },
      {
        requestId: r2.id,
        companyId: p2.id,
        type: "decline",
        reason: "no capacity",
        receivedAt: W1,
        createdBy,
      },
    ]);

    await db().insert(timeEntries).values({
      requestId: r1.id,
      userId: createdBy,
      minutes: 45,
      createdAt: W1,
    });

    const weeks = await weekly("?from=2026-10-01&to=2026-10-31");
    const w1 = weeks.find((w) => w.week === "2026-10-05") as Record<string, number | null>;

    expect(w1.providersContacted).toBe(2);
    expect(w1.providersContactedPerRequest).toBe(1);
    // Denominator excludes the provider decline: 1 confirming / 1 = 100%.
    expect(w1.availabilityConfirmationRate).toBe(1);
    expect(w1.repeatUsage).toBe(1); // Mari has 2 requests
    expect(w1.manualMinutes).toBe(45);
    // Adoption: 1 of 2 active providers on the booking system.
    expect(w1.adoptionShare).toBe(0.5);
  });

  it("renders 'no data' (null) for a week with no activity rather than zeros", async () => {
    await seedRequest({ createdAt: W1, pmName: "Mari", approved: true });
    const weeks = await weekly("?from=2026-10-01&to=2026-10-31");
    const emptyWeek = weeks.find((w) => w.week === "2026-10-19") as Record<string, number | null> | undefined;
    if (emptyWeek) {
      // A week with no requests at all: no fabricated zero percentages.
      expect(emptyWeek.successRate).toBeNull();
      expect(emptyWeek.bookingConversion).toBeNull();
      expect(emptyWeek.providersContactedPerRequest).toBeNull();
    }
  });
});

describe("CSV export", () => {
  it("exports one row per week with header and empty cells for no-data", async () => {
    await seedRequest({
      createdAt: W1,
      pmName: "Mari",
      approved: true,
      qualifiedWithin24h: true,
      booked: true,
    });
    const res = await SELF.fetch(
      "https://example.com/api/dashboard/export.csv?from=2026-10-01&to=2026-10-31",
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    const headerCols = lines[0]!.split(",");
    for (const label of ["week", "new_pms", "new_requests", "booking_conversion", "adoption_share"]) {
      expect(headerCols).toContain(label);
    }
    const w1 = lines.find((l) => l.startsWith("2026-10-05"))!;
    expect(w1).toContain(",1,"); // new_pms = 1
    expect(w1).toContain("1"); // some 1 values present
    // A week with no decisions has an empty conversion cell, not 0.
    const other = lines.find((l) => l.startsWith("2026-10-12") || l.startsWith("2026-10-19"));
    if (other) {
      const cols = other.split(",");
      const conversionIdx = lines[0]!.split(",").indexOf("booking_conversion");
      expect(cols[conversionIdx]).toBe("");
    }
  });
});

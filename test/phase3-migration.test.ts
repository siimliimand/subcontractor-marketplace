import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  bookings,
  companies,
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
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(bookings);
  await db().delete(responses);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

let regCounter = 0;

/** Insert two live bookings for the same provider+trade on disjoint windows. */
async function seedTwoBookings() {
  const staff = (await db().select().from(users).limit(1)).at(0)!;
  const company = await db()
    .insert(companies)
    .values({
      legalName: `OÜ Trigger ${++regCounter}`,
      registrationIdentifier: `reg-trig-${regCounter}`,
      contactEmail: `trig${regCounter}@x.ee`,
    })
    .returning()
    .then((r) => r[0]!);
  const mkRequest = async (title: string, start: string, end: string) => {
    const request = await db()
      .insert(requests)
      .values({
        title,
        description: "d",
        location: "Tallinn",
        trade: "electrical",
        startDate: start,
        crewSize: 2,
        status: "booked",
        createdBy: staff.id,
      })
      .returning()
      .then((r) => r[0]!);
    const response = await db()
      .insert(responses)
      .values({
        requestId: request.id,
        companyId: company.id,
        type: "interest",
        workersCount: 2,
        availableFrom: start,
        createdBy: staff.id,
      })
      .returning()
      .then((r) => r[0]!);
    const booking = await db()
      .insert(bookings)
      .values({
        requestId: request.id,
        responseId: response.id,
        companyId: company.id,
        trade: "electrical",
        startDate: start,
        endDate: end,
        workersCount: 2,
        createdBy: staff.id,
      })
      .returning()
      .then((r) => r[0]!);
    return { request, booking };
  };
  // Disjoint windows: Nov 02–10 and Nov 20–28.
  const first = await mkRequest("First job", "2026-11-02", "2026-11-10");
  const second = await mkRequest("Second job", "2026-11-20", "2026-11-28");
  return { company, first, second };
}

describe("phase 3 migration 0006", () => {
  it("UPDATE trigger blocks a reschedule into an occupied window", async () => {
    const { first: _first, second } = await seedTwoBookings();
    // Move the second booking back onto the first booking's window.
    await expect(
      env.DB.prepare("UPDATE bookings SET startDate = ?, endDate = ? WHERE id = ?")
        .bind("2026-11-05", "2026-11-12", second.booking.id)
        .run(),
    ).rejects.toThrow(/capacity_conflict/);
    // The row is unchanged.
    const row = await db().select().from(bookings).where(eq(bookings.id, second.booking.id));
    expect(row[0]!.startDate).toBe("2026-11-20");
  });

  it("UPDATE trigger allows moving to a free window and ignores the row itself", async () => {
    const { second } = await seedTwoBookings();
    // Shift within a range that overlaps its own old dates only.
    const ok = await env.DB.prepare(
      "UPDATE bookings SET startDate = ?, endDate = ? WHERE id = ?",
    )
      .bind("2026-11-22", "2026-11-30", second.booking.id)
      .run();
    expect(ok.success).toBe(true);
    const row = await db().select().from(bookings).where(eq(bookings.id, second.booking.id));
    expect(row[0]!.endDate).toBe("2026-11-30");
  });

  it("UPDATE trigger ignores cancelled (outcome-set) bookings", async () => {
    const { first, second } = await seedTwoBookings();
    await db().update(bookings).set({ outcome: "cancelled" }).where(eq(bookings.id, first.booking.id));
    const ok = await env.DB.prepare(
      "UPDATE bookings SET startDate = ?, endDate = ? WHERE id = ?",
    )
      .bind("2026-11-05", "2026-11-12", second.booking.id)
      .run();
    expect(ok.success).toBe(true);
  });

  it("booking-level cancellation columns exist", async () => {
    const { second } = await seedTwoBookings();
    await db()
      .update(bookings)
      .set({
        outcome: "cancelled",
        cancelledBy: "provider",
        cancelReason: "Crew reassigned",
        cancelledAt: new Date().toISOString(),
      })
      .where(eq(bookings.id, second.booking.id));
    const row = await db().select().from(bookings).where(eq(bookings.id, second.booking.id));
    expect(row[0]!.cancelledBy).toBe("provider");
    expect(row[0]!.cancelReason).toBe("Crew reassigned");
  });
});

import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEvents, pilotAgreements, requests } from "./db/schema";

/**
 * Phase 4 monetization pilot (details/09): the fixed rule — listing and
 * matching are free, the booking interface is the paid part. Pilot
 * agreements are hand-billed records (no payment processing); gating is
 * behind the master flag so "off" means byte-identical behaviour.
 */

export function monetizationEnabled(env: { MONETIZATION_PILOT_ENABLED?: string }): boolean {
  return env.MONETIZATION_PILOT_ENABLED === "true";
}

/** An agreement is active when its row says so and now falls in its window. */
export async function hasActiveAgreement(
  db: DrizzleD1Database,
  partnerId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(pilotAgreements)
    .where(and(eq(pilotAgreements.partnerId, partnerId), eq(pilotAgreements.status, "active")));
  const nowIso = now.toISOString();
  return rows.some(
    (a) =>
      a.startsAt <= nowIso &&
      (a.endsAt === null || a.endsAt > nowIso),
  );
}

/**
 * The gate check for a booking-flow action on a request: no partner on the
 * request means no agreement → gated (when the pilot is on). Returns null
 * when the action may proceed.
 */
export async function gateBookingAction(
  db: DrizzleD1Database,
  request: { partnerId: string | null },
  now: Date,
): Promise<{ gated: boolean; partnerId: string | null }> {
  if (!request.partnerId) return { gated: true, partnerId: null };
  const active = await hasActiveAgreement(db, request.partnerId, now);
  return { gated: !active, partnerId: request.partnerId };
}

export async function countGatedViews(
  db: DrizzleD1Database,
  partnerId: string,
): Promise<number> {
  const rows = (await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM audit_events
    WHERE action = 'pilot_gate_blocked' AND entityId = ${partnerId}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export type PartnerPilotUsage = {
  partnerId: string;
  partnerName: string;
  agreements: number;
  activeAgreement: boolean;
  requests: number;
  bookings: number;
  gatedViews: number;
};

/** Weekly readout (details/09): judge the hypothesis on recorded behaviour. */
export async function pilotUsage(
  db: DrizzleD1Database,
  opts: { now: Date },
): Promise<PartnerPilotUsage[]> {
  const rows = (await db.all<{
    partnerId: string;
    partnerName: string;
    agreements: number;
    activeAgreements: number;
    requestCount: number;
    bookingCount: number;
  }>(sql`
    SELECT p.id AS partnerId,
           p.name AS partnerName,
           (SELECT COUNT(*) FROM pilot_agreements pa WHERE pa.partnerId = p.id) AS agreements,
           (SELECT COUNT(*) FROM pilot_agreements pa
             WHERE pa.partnerId = p.id AND pa.status = 'active'
               AND pa.startsAt <= ${opts.now.toISOString()}
               AND (pa.endsAt IS NULL OR pa.endsAt > ${opts.now.toISOString()})) AS activeAgreements,
           (SELECT COUNT(*) FROM requests r WHERE r.partnerId = p.id) AS requestCount,
           (SELECT COUNT(*) FROM bookings b JOIN requests r ON b.requestId = r.id WHERE r.partnerId = p.id) AS bookingCount
    FROM partners p
    ORDER BY p.name
  `)) as unknown as Array<{
    partnerId: string;
    partnerName: string;
    agreements: number;
    activeAgreements: number;
    requestCount: number;
    bookingCount: number;
  }>;

  const gatedRows = (await db.all<{ entityId: string | null; n: number }>(sql`
    SELECT entityId, COUNT(*) AS n FROM audit_events
    WHERE action = 'pilot_gate_blocked' GROUP BY entityId
  `)) as unknown as Array<{ entityId: string | null; n: number }>;
  const gatedByPartner = new Map(gatedRows.map((r) => [r.entityId ?? "", r.n]));

  return rows.map((r) => ({
    partnerId: r.partnerId,
    partnerName: r.partnerName,
    agreements: r.agreements,
    activeAgreement: r.activeAgreements > 0,
    requests: r.requestCount,
    bookings: r.bookingCount,
    gatedViews: gatedByPartner.get(r.partnerId) ?? 0,
  }));
}

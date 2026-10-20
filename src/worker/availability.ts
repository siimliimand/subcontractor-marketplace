import { and, eq } from "drizzle-orm";
import { availabilityDeclarations } from "./db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Capacity freshness (details/03): an empty or old declaration is never
 * presented as confirmed capacity. States key off the declaration's
 * confirmation timestamp:
 *   <7 days    current — confirmed availability
 *   7–14 days  aging   — likely current; reconfirmation recommended
 *   14–30 days stale   — uncertain; reconfirmation required
 *   >30 days   expired — unknown; must be reconfirmed
 */
export const FRESHNESS_STATES = ["current", "aging", "stale", "expired"] as const;

export type FreshnessState = (typeof FRESHNESS_STATES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function freshness(lastConfirmedAt: string, now: Date = new Date()): FreshnessState {
  const ageDays = (now.getTime() - new Date(lastConfirmedAt).getTime()) / DAY_MS;
  if (ageDays < 7) return "current";
  if (ageDays < 14) return "aging";
  if (ageDays < 30) return "stale";
  return "expired";
}

export type AvailabilityDeclaration = typeof availabilityDeclarations.$inferSelect;

export type DeclarationWithFreshness = AvailabilityDeclaration & {
  freshness: FreshnessState;
};

export type AvailabilitySummary = {
  /** Sum of workers on fresh (non-expired) declarations for the period. */
  confirmedWorkers: number;
  /** True when at least one fresh booking_system declaration exists. */
  hasFreshDeclarations: boolean;
  states: Record<FreshnessState, number>;
};

/**
 * Summarise declarations for a provider+trade against a requested date range.
 * Declarations count toward confirmed capacity when they are fresh (not
 * expired), their date range intersects the request, and the channel is
 * `booking_system` (email_only availability is by definition unconfirmed).
 */
export function summariseDeclarations(
  declarations: AvailabilityDeclaration[],
  options: { dateFrom?: string; dateTo?: string; now?: Date } = {},
): AvailabilitySummary {
  const now = options.now ?? new Date();
  const states: Record<FreshnessState, number> = { current: 0, aging: 0, stale: 0, expired: 0 };
  let confirmedWorkers = 0;
  let hasFreshDeclarations = false;
  for (const d of declarations) {
    const state = freshness(d.lastConfirmedAt, now);
    states[state] += 1;
    if (state === "expired") continue;
    if (d.channel !== "booking_system") continue;
    if (options.dateFrom && options.dateTo) {
      // Inclusive overlap: declaration covers part of the requested range.
      const overlaps = d.dateFrom <= options.dateTo && d.dateTo >= options.dateFrom;
      if (!overlaps) continue;
    }
    hasFreshDeclarations = true;
    confirmedWorkers += d.workersCount;
  }
  return { confirmedWorkers, hasFreshDeclarations, states };
}

export async function declarationsForCompany(
  db: DrizzleD1Database,
  companyId: string,
  trade?: string,
): Promise<DeclarationWithFreshness[]> {
  const rows = await db
    .select()
    .from(availabilityDeclarations)
    .where(
      trade
        ? and(eq(availabilityDeclarations.companyId, companyId), eq(availabilityDeclarations.trade, trade))
        : eq(availabilityDeclarations.companyId, companyId),
    );
  const now = new Date();
  return rows.map((r) => ({ ...r, freshness: freshness(r.lastConfirmedAt, now) }));
}

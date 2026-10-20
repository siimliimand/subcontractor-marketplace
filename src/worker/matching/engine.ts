import { and, eq, inArray, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  availabilityDeclarations,
  bookings,
  companies,
  outreachEntries,
  responses,
  services,
  type requests as requestsTable,
} from "../db/schema";
import { summariseDeclarations } from "../availability";
import {
  computeFactors,
  totalScore,
  type FactorBreakdown,
  type FactorInputs,
} from "./weights";
import type { Trade } from "../config";

export const INITIAL_BATCH_SIZE = 5;
export const WIDENED_BATCH_SIZE = 10;
export const MAX_PER_SPECIALISATION = 2;

type RequestRow = typeof requestsTable.$inferSelect;

export type Candidate = {
  companyId: string;
  legalName: string;
  trade: Trade;
  score: number;
  specialisation: string;
  factors: FactorBreakdown;
};

export type ExcludedCandidate = {
  companyId: string;
  legalName: string;
  reason: string;
};

export type MatchRunResult = {
  trade: Trade;
  candidates: Candidate[];
  excluded: ExcludedCandidate[];
};

/**
 * Hard filters (details/04 step 1): active provider, offers the required
 * trade, service area covers the request location. Availability-unknown
 * providers stay eligible (capacity factor scores zero) — an empty
 * declaration history is never a proof of disqualification either.
 */
export async function selectCandidates(
  db: DrizzleD1Database,
  request: RequestRow,
  trade: Trade,
): Promise<MatchRunResult> {
  const rows = await db
    .select({ company: companies, service: services })
    .from(services)
    .innerJoin(companies, eq(companies.id, services.companyId))
    .where(and(eq(services.trade, trade), ne(services.status, "inactive")));

  const now = new Date();
  const candidates: Candidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const seen = new Set<string>();

  for (const { company, service } of rows) {
    if (seen.has(company.id)) continue; // same provider may offer the trade via several services
    if (company.status !== "active") {
      excluded.push({ companyId: company.id, legalName: company.legalName, reason: `provider_status_${company.status}` });
      continue;
    }
    const location = request.location.trim().toLowerCase();
    const area = service.serviceArea.trim().toLowerCase();
    const locationCovered = location && area && (area.includes(location) || location.includes(area));
    if (!locationCovered) {
      excluded.push({ companyId: company.id, legalName: company.legalName, reason: "location_not_in_service_area" });
      continue;
    }
    seen.add(company.id);

    const declarations = await db
      .select()
      .from(availabilityDeclarations)
      .where(
        and(
          eq(availabilityDeclarations.companyId, company.id),
          eq(availabilityDeclarations.trade, trade),
        ),
      );
    const summary = summariseDeclarations(declarations, {
      dateFrom: request.startDate,
      // requested end date is not modelled on requests; use start date window
      dateTo: request.startDate,
      now,
    });

    const [pastOutreach, companyResponses, companyBookings] = await Promise.all([
      db.select().from(outreachEntries).where(eq(outreachEntries.companyId, company.id)),
      db.select().from(responses).where(eq(responses.companyId, company.id)),
      db.select().from(bookings).where(eq(bookings.companyId, company.id)),
    ]);
    const responseByEntry = new Map<string, { hours: number }>();
    for (const entry of pastOutreach) {
      const first = companyResponses
        .filter((r) => r.requestId === entry.requestId && r.receivedAt !== null)
        .map(
          (r) =>
            (new Date(r.receivedAt!).getTime() - new Date(entry.sentAt ?? new Date().toISOString()).getTime()) /
            3_600_000,
        )
        .sort((a, b) => a - b)[0];
      if (first !== undefined) responseByEntry.set(entry.id, { hours: first });
    }
    const pastOutreachInput = pastOutreach.map((entry) => {
      const hit = responseByEntry.get(entry.id);
      return { responded: !!hit, responseHours: hit?.hours ?? null };
    });
    const providerCancellations = companyBookings.filter(
      (b) => b.outcome === "cancelled",
    ).length;

    const inputs: FactorInputs = {
      confirmedWorkers: summary.confirmedWorkers,
      hasFreshDeclarations: summary.hasFreshDeclarations,
      crewSize: request.crewSize,
      tradeServices: [
        {
          skills: service.skills,
          isPrimaryTrade: false, // services table has no primary flag; depth comes from skills
          pricingApproach: service.pricingApproach,
        },
      ],
      pastOutreach: pastOutreachInput,
      pastBookings: companyBookings
        .filter((b) => b.outcome === "completion_confirmed" || b.outcome === "accepted_but_not_delivered")
        .map((b) => ({ outcome: b.outcome })),
      providerCancellations,
      requestLocation: request.location,
      serviceAreas: [service.serviceArea],
      requestBudget: request.budget,
    };
    const factors = computeFactors(inputs);
    const firstSkill = (service.skills ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0];
    candidates.push({
      companyId: company.id,
      legalName: company.legalName,
      trade,
      score: totalScore(factors),
      specialisation: firstSkill ?? "general",
      factors,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.legalName.localeCompare(b.legalName));
  return { trade, candidates, excluded };
}

/**
 * Diversity rule (details/04 step 3): at most 2 candidates per specialisation
 * in an initial batch; freed slots go to the next-ranked candidates.
 */
export function applyDiversityCap(
  ranked: Candidate[],
  batchSize: number,
  maxPerSpecialisation: number = MAX_PER_SPECIALISATION,
): { batch: Candidate[]; reserves: Candidate[] } {
  const counts = new Map<string, number>();
  const batch: Candidate[] = [];
  const reserves: Candidate[] = [];
  for (const candidate of ranked) {
    const used = counts.get(candidate.specialisation) ?? 0;
    if (batch.length < batchSize && used < maxPerSpecialisation) {
      counts.set(candidate.specialisation, used + 1);
      batch.push(candidate);
    } else {
      reserves.push(candidate);
    }
  }
  return { batch, reserves };
}

/**
 * Widen set: next-ranked candidates after the initial batch, ignoring the
 * diversity cap (details/04: widen toward 10 on timeout).
 */
export function widenCandidates(ranked: Candidate[], alreadyContacted: Set<string>): Candidate[] {
  return ranked.filter((c) => !alreadyContacted.has(c.companyId)).slice(0, WIDENED_BATCH_SIZE);
}

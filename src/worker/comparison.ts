import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  availabilityDeclarations,
  companies,
  outreachEntries,
  responses,
  services,
} from "./db/schema";
import { freshness, summariseDeclarations } from "./availability";

/**
 * Response comparison (phase 2, P1): all responses to a request, grouped by
 * required trade, with price/interest, declared capacity and the freshness
 * state of the provider's availability. Grouping is derived from data that
 * exists: the trade of the matching-generated outreach entry that contacted
 * the provider, else the provider's own services for the required trades.
 * Responses that cannot be attributed to a trade land in "ungrouped".
 * Email-only, missing or expired availability is "Unconfirmed" — an empty or
 * unknown state is never presented as confirmed.
 */

export type ComparisonEntry = {
  responseId: string;
  companyId: string;
  legalName: string;
  type: string;
  workersCount: number | null;
  availableFrom: string | null;
  reason: string | null;
  receivedAt: string | null;
  availability: {
    label: "confirmed" | "aging" | "stale" | "unconfirmed";
    confirmedWorkers: number;
  };
};

export type ComparisonGroup = {
  trade: string | "ungrouped";
  isPrimary: boolean;
  entries: ComparisonEntry[];
};

export async function buildComparison(
  db: DrizzleD1Database,
  requestId: string,
  requiredTrades: { trade: string; isPrimary: boolean }[],
  requestStartDate?: string,
): Promise<ComparisonGroup[]> {
  const responseRows = await db
    .select({ response: responses, provider: companies })
    .from(responses)
    .leftJoin(companies, eq(companies.id, responses.companyId))
    .where(eq(responses.requestId, requestId));
  if (responseRows.length === 0) return [];

  const companyIds = [...new Set(responseRows.map((r) => r.response.companyId))];
  const [outreachRows, serviceRows, declarationRows] = await Promise.all([
    db
      .select()
      .from(outreachEntries)
      .where(
        and(eq(outreachEntries.requestId, requestId), inArray(outreachEntries.companyId, companyIds)),
      ),
    db.select().from(services).where(inArray(services.companyId, companyIds)),
    db
      .select()
      .from(availabilityDeclarations)
      .where(inArray(availabilityDeclarations.companyId, companyIds)),
  ]);

  // trade attributed per company: matching-entry trade first, else a service trade
  const companyTrade = new Map<string, string>();
  for (const entry of outreachRows) {
    if (entry.trade && !companyTrade.has(entry.companyId)) {
      companyTrade.set(entry.companyId, entry.trade);
    }
  }
  for (const service of serviceRows) {
    if (!companyTrade.has(service.companyId)) companyTrade.set(service.companyId, service.trade);
  }

  const requiredSet = new Set(requiredTrades.map((t) => t.trade));
  const now = new Date();
  const groups: ComparisonGroup[] = [
    ...requiredTrades.map((t) => ({ trade: t.trade, isPrimary: t.isPrimary, entries: [] as ComparisonEntry[] })),
    { trade: "ungrouped", isPrimary: false, entries: [] as ComparisonEntry[] },
  ];
  const byTrade = new Map(groups.map((g) => [g.trade, g]));

  for (const { response, provider } of responseRows) {
    const decls = declarationRows.filter(
      (d) => d.companyId === response.companyId && d.trade === (companyTrade.get(response.companyId) ?? ""),
    );
    const summary = summariseDeclarations(decls, { now });
    const freshest = decls
      .filter((d) => d.channel === "booking_system" && freshness(d.lastConfirmedAt, now) !== "expired")
      .map((d) => freshness(d.lastConfirmedAt, now))
      .sort((a, b) => ["current", "aging", "stale"].indexOf(a) - ["current", "aging", "stale"].indexOf(b))[0];
    let label: ComparisonEntry["availability"]["label"] = "unconfirmed";
    if (summary.hasFreshDeclarations && freshest) {
      label = freshest as ComparisonEntry["availability"]["label"];
    }
    const entry: ComparisonEntry = {
      responseId: response.id,
      companyId: response.companyId,
      legalName: provider?.legalName ?? response.companyId,
      type: response.type,
      workersCount: response.workersCount,
      availableFrom: response.availableFrom,
      reason: response.reason,
      receivedAt: response.receivedAt,
      availability: { label, confirmedWorkers: summary.confirmedWorkers },
    };
    const trade = companyTrade.get(response.companyId);
    const group = trade && requiredSet.has(trade) ? byTrade.get(trade) : byTrade.get("ungrouped");
    (group ?? byTrade.get("ungrouped")!).entries.push(entry);
  }

  return groups.filter((g) => g.trade !== "ungrouped" || g.entries.length > 0);
}

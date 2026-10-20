import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Phase 4 subcontractor planner (details/04, flag-gated): a DRAFT trade/
 * staffing plan for an approved request, grounded in the platform's own
 * historical booking data. Never books, holds, or messages anyone — output
 * is labelled a draft and stored with generation metadata so the evaluate-
 * before-expanding gate (plan §Phase 4.5) can judge it on evidence.
 */

export const PLANNER_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export type GroundingStats = {
  requestCount: number;
  /** Per-trade medians from real bookings. */
  trades: Record<string, { bookings: number; medianWorkers: number; medianDays: number }>;
};

export type DraftPlan = {
  label: "draft";
  requestId: string;
  trades: Array<{ trade: string; suggestedWorkers: number; suggestedDays: number; basis: string }>;
  notes: string[];
};

type AiBinding = { run(model: string, inputs: unknown): Promise<unknown> };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * Grounding: per-trade team-size and duration stats from confirmed bookings
 * (the only completed-work signal in the platform). No personal data leaves
 * the aggregates — the model sees numbers, never names.
 */
export async function groundingStats(db: DrizzleD1Database): Promise<GroundingStats> {
  const rows = (await db.all<{ trade: string; workersCount: number; days: number }>(sql`
    SELECT trade, workersCount,
           CAST(julianday(endDate) - julianday(startDate) + 1 AS INTEGER) AS days
    FROM bookings
    WHERE outcome = 'completion_confirmed' AND trade != ''
  `)) as unknown as Array<{ trade: string; workersCount: number; days: number }>;

  const byTrade = new Map<string, { workers: number[]; days: number[] }>();
  for (const row of rows) {
    const entry = byTrade.get(row.trade) ?? { workers: [], days: [] };
    entry.workers.push(row.workersCount);
    entry.days.push(row.days);
    byTrade.set(row.trade, entry);
  }
  const trades: GroundingStats["trades"] = {};
  for (const [trade, entry] of byTrade) {
    trades[trade] = {
      bookings: entry.workers.length,
      medianWorkers: median(entry.workers),
      medianDays: Math.max(1, median(entry.days)),
    };
  }
  return { requestCount: rows.length, trades };
}

/** The deterministic core: suggested trades/team sizes from request + history. */
export function draftPlanFromGrounding(
  request: { id: string; title: string; crewSize: number; startDate: string; duration: string | null },
  requiredTrades: string[],
  stats: GroundingStats,
): DraftPlan {
  const notes: string[] = [];
  const trades = requiredTrades.map((trade) => {
    const hist = stats.trades[trade];
    if (!hist) {
      notes.push(`no completed ${trade} bookings yet — suggestion falls back to the requested crew size`);
      return {
        trade,
        suggestedWorkers: Math.max(1, request.crewSize),
        suggestedDays: request.duration ? Number(request.duration.replace(/\D/g, "")) || 1 : 1,
        basis: "requested crew size (no grounding data)",
      };
    }
    return {
      trade,
      suggestedWorkers: Math.max(1, hist.medianWorkers),
      suggestedDays: hist.medianDays,
      basis: `${hist.bookings} completed ${trade} booking(s): median ${hist.medianWorkers} workers / ${hist.medianDays} day(s)`,
    };
  });
  return {
    label: "draft",
    requestId: request.id,
    trades,
    notes: [
      "Draft plan — not a quote, not a booking. Nothing is scheduled or sent.",
      ...notes,
    ],
  };
}

/**
 * The AI pass refines the deterministic draft (wording, sequencing hints).
 * It receives ONLY the aggregate numbers and request facts — no provider or
 * personal data. Any model failure degrades to the deterministic draft (the
 * caller passes `ai: null` or catches).
 */
export async function refineWithAi(
  ai: AiBinding | null,
  request: { title: string; crewSize: number; startDate: string },
  plan: DraftPlan,
): Promise<string | null> {
  if (!ai) return null;
  try {
    const result = (await ai.run(PLANNER_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a construction staffing assistant. Given a draft plan and historical medians, write a 3-sentence sequencing recommendation. Never invent providers, prices, or commitments. This is a draft.",
        },
        {
          role: "user",
          content: JSON.stringify({ request: { title: request.title, crewSize: request.crewSize, startDate: request.startDate }, plan }),
        },
      ],
    })) as { response?: string };
    return typeof result?.response === "string" ? result.response : null;
  } catch {
    return null;
  }
}

export function promptHash(input: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  return Array.from(new Uint8Array(bytes))
    .reduce((acc, b) => (acc * 31 + b) >>> 0, 7)
    .toString(16);
}

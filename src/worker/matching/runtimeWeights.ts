import { desc, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { matchWeights } from "../db/schema";
import {
  DEFAULT_WEIGHTS,
  isMatchFactorKey,
  type EffectiveWeights,
  type MatchFactorKey,
} from "./weights";

/**
 * Phase 3 learning loop: ranking weights are runtime-tunable. The effective
 * weight per factor is the latest `match_weights` row; defaults fill gaps.
 * Every change is append-only with actor + reason, and each match snapshots
 * the weights it used so post-hoc explainability stays truthful.
 */
export async function getEffectiveWeights(
  db: DrizzleD1Database,
): Promise<{ weights: EffectiveWeights; overrides: Partial<EffectiveWeights> }> {
  const rows = (await db.all<{ factor: string; weight: number }>(sql`
    SELECT factor, weight FROM match_weights m
    WHERE createdAt = (
      SELECT MAX(m2.createdAt) FROM match_weights m2 WHERE m2.factor = m.factor
    )
  `)) as unknown as Array<{ factor: string; weight: number }>;

  const overrides: Partial<EffectiveWeights> = {};
  for (const row of rows) {
    if (isMatchFactorKey(row.factor)) {
      overrides[row.factor as MatchFactorKey] = row.weight;
    }
  }
  return { weights: { ...DEFAULT_WEIGHTS, ...overrides }, overrides };
}

export async function listWeightHistory(db: DrizzleD1Database, limit = 50) {
  return db
    .select()
    .from(matchWeights)
    .orderBy(desc(matchWeights.createdAt))
    .limit(limit);
}

export async function setWeight(
  db: DrizzleD1Database,
  input: { factor: MatchFactorKey; weight: number; reason: string; setBy: string },
) {
  await db.insert(matchWeights).values({
    factor: input.factor,
    weight: input.weight,
    reason: input.reason,
    setBy: input.setBy,
  });
}

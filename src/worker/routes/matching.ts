import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import { outreachEntries, requestTrades, requests, users } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { listTrades } from "../catalog";
import type { Trade } from "../config";
import {
  applyDiversityCap,
  INITIAL_BATCH_SIZE,
  selectCandidates,
  WIDENED_BATCH_SIZE,
} from "../matching/engine";
import {
  DEFAULT_WEIGHTS,
  isMatchFactorKey,
} from "../matching/weights";
import {
  getEffectiveWeights,
  listWeightHistory,
  setWeight,
} from "../matching/runtimeWeights";

export const matchingRouter = new Hono<AppEnv>();

/**
 * Phase 3 learning loop: runtime-tunable ranking weights. GET returns the
 * effective weights (defaults + latest overrides) with history; PUT appends
 * an override row (reason required) so pilot tuning never needs a redeploy
 * and stays auditable. Payment is not a factor and cannot become one.
 */
matchingRouter.get("/matching/weights", async (c) => {
  const db = drizzle(c.env.DB);
  const { weights, overrides } = await getEffectiveWeights(db);
  const history = await listWeightHistory(db);
  return c.json({
    weights,
    defaults: DEFAULT_WEIGHTS,
    overrides,
    history,
  });
});

matchingRouter.put("/matching/weights", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const factor = typeof b.factor === "string" ? b.factor : "";
  if (!isMatchFactorKey(factor)) {
    return c.json(
      { error: "invalid_factor: allowed factors confirmedCapacity, specialisationDepth, responseHistory, reliability, proximity, reviewQuality, priceFit" },
      400,
    );
  }
  const weight = b.weight;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    return c.json({ error: "invalid_weight: must be a number between 0 and 1" }, 400);
  }
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason) return c.json({ error: "reason_required" }, 400);

  await setWeight(db, { factor, weight, reason, setBy: user.id });
  const { weights } = await getEffectiveWeights(db);
  return c.json({ ok: true, factor, weight, weights }, 200);
});

function matchBatchNumber(suffix = ""): string {
  return `M-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}${suffix}`;
}

/**
 * Matching v1 (phase 2): per required trade, rank eligible providers and
 * generate a `matching`-channel outreach batch carrying each candidate's
 * match score and factor breakdown (explainability).
 *
 * Body: {} for the initial batch, { "widen": true } to widen once toward 10.
 */
matchingRouter.post("/requests/:id/match", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const b = (body ?? {}) as Record<string, unknown>;
  const widen = b.widen === true;

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);

  // Stop conditions: matching requires an approved request and stops on
  // booking or cancellation.
  if (["draft", "booked", "cancelled", "closed"].includes(request.status)) {
    return c.json(
      { error: `matching_refused: request is ${request.status}` },
      400,
    );
  }

  const tradeRows = await db
    .select()
    .from(requestTrades)
    .where(eq(requestTrades.requestId, id));
  // Phase 4: the catalog is the trade vocabulary. Known-but-deactivated
  // trades still match (in-flight requests keep working); unknown slugs
  // cannot be matched at all.
  const catalog = await listTrades(db);
  const catalogSlugs = new Set(catalog.map((t) => t.slug));
  const trades = tradeRows.map((t) => t.trade).filter((t) => catalogSlugs.has(t)) as Trade[];
  if (trades.length === 0) return c.json({ error: "matching_refused: no required trades" }, 400);

  const contacted = await db
    .select()
    .from(outreachEntries)
    .where(eq(outreachEntries.requestId, id));
  const contactedIds = new Set(contacted.map((e) => e.companyId));
  const alreadyWidened = contacted.some(
    (e) => e.channel === "matching" && e.batchNumber.endsWith("-w"),
  );

  if (widen && alreadyWidened) {
    return c.json({ error: "widen_refused: outreach already widened once" }, 400);
  }

  const staffUsers = await db.select().from(users).limit(1);
  const contactedBy = staffUsers[0]?.id ?? user.id;

  const results: unknown[] = [];
  const statements: unknown[] = [];
  const events: unknown[] = [];

  for (const trade of trades) {
    const run = await selectCandidates(db, request, trade);
    const priorMatching = contacted.filter(
      (e) => e.channel === "matching" && e.trade === trade,
    );

    let picks;
    let batchNumber: string;
    if (widen) {
      if (priorMatching.length === 0) {
        return c.json(
          { error: "widen_refused: no initial matching batch for this request" },
          400,
        );
      }
      if (priorMatching.length >= WIDENED_BATCH_SIZE) {
        return c.json({ error: "widen_refused: batch already at widened size" }, 400);
      }
      picks = run.candidates.filter((cand) => !contactedIds.has(cand.companyId));
      picks = picks.slice(0, WIDENED_BATCH_SIZE - priorMatching.length);
      batchNumber = matchBatchNumber("-w");
    } else {
      if (priorMatching.length > 0) {
        return c.json(
          { error: "matching_refused: a matching batch already exists for this request" },
          400,
        );
      }
      picks = applyDiversityCap(run.candidates, INITIAL_BATCH_SIZE).batch;
      batchNumber = matchBatchNumber();
    }

    if (picks.length === 0) {
      results.push({ trade, batchNumber: null, created: 0, excluded: run.excluded });
      continue;
    }

    for (const cand of picks) {
      if (contactedIds.has(cand.companyId)) continue; // unique per request+provider
      contactedIds.add(cand.companyId);
      statements.push(
        db.insert(outreachEntries).values({
          requestId: id,
          companyId: cand.companyId,
          batchNumber,
          contactedBy,
          channel: "matching",
          trade: cand.trade,
          matchScore: cand.score,
          matchFactorsJson: JSON.stringify({ factors: cand.factors, weights: run.weights }),
        }),
      );
    }
    events.push(
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: user.email,
        entity: "request",
        entityId: id,
        action: "matched",
        payload: {
          trade,
          batchNumber,
          widen,
          ranked: picks.map((cand) => ({
            companyId: cand.companyId,
            score: cand.score,
            specialisation: cand.specialisation,
            missingFactors: Object.entries(cand.factors)
              .filter(([, f]) => f.missing)
              .map(([k]) => k),
          })),
        },
        channel: "automated",
      }),
    );
    results.push({
      trade,
      batchNumber,
      created: picks.length,
      regionFilter: run.regionFilter,
      candidates: picks.map((cand) => ({
        companyId: cand.companyId,
        legalName: cand.legalName,
        rank: picks.indexOf(cand) + 1,
        score: cand.score,
        specialisation: cand.specialisation,
        factors: cand.factors,
      })),
      excluded: run.excluded,
    });
  }

  const batch = [...statements, ...events] as unknown as [
    BatchItem<"sqlite">,
    ...BatchItem<"sqlite">[],
  ];
  if (batch.length > 0) await db.batch(batch);

  // Matching implies outreach is starting: step the lifecycle forward.
  if (["approved", "matched"].includes(request.status)) {
    await db
      .update(requests)
      .set({ status: "in_outreach", updatedAt: new Date().toISOString() })
      .where(and(eq(requests.id, id)));
  }

  return c.json({ requestId: id, widen, runs: results }, 201);
});

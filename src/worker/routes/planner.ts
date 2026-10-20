import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { projectPlans, requestTrades, requests } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import {
  PLANNER_MODEL,
  draftPlanFromGrounding,
  groundingStats,
  promptHash,
  refineWithAi,
} from "../planner";

export const plannerRouter = new Hono<AppEnv>();

/**
 * Phase 4 planner AI — flag-gated (PLANNER_AI_ENABLED, default off; the plan
 * gates this track on real project data existing). Only approved requests
 * are accepted. Generation is labelled a draft, never acts on its own, and
 * is audit-logged. Staff feedback (useful / not useful + comment) builds the
 * evaluation dataset for the plan's expand/no-expand decision.
 */

function plannerEnabled(env: AppEnv["Bindings"]): boolean {
  return env.PLANNER_AI_ENABLED === "true";
}

plannerRouter.post("/requests/:id/plan", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  if (!plannerEnabled(c.env))
    return c.json({ error: "planner_disabled: PLANNER_AI_ENABLED is off" }, 403);

  const id = c.req.param("id");
  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (request.status !== "approved")
    return c.json({ error: `planner_requires_approved_request: request is ${request.status}` }, 400);

  const tradeRows = await db.select().from(requestTrades).where(eq(requestTrades.requestId, id));
  const requiredTrades = [...new Set(tradeRows.map((t) => t.trade))];
  if (requiredTrades.length === 0) return c.json({ error: "no_required_trades" }, 400);

  const stats = await groundingStats(db);
  if (stats.requestCount === 0) {
    return c.json(
      {
        error: "insufficient_grounding: no completed bookings exist to ground a plan yet",
        hint: "the planner stays off until the platform has real project data (plan §Phase 4.5)",
      },
      409,
    );
  }

  const plan = draftPlanFromGrounding(
    {
      id: request.id,
      title: request.title,
      crewSize: request.crewSize,
      startDate: request.startDate,
      duration: request.duration,
    },
    requiredTrades,
    stats,
  );
  const narrative = await refineWithAi(c.env.AI ?? null, request, plan);

  const inserted = await db
    .insert(projectPlans)
    .values({
      requestId: id,
      planJson: JSON.stringify({ ...plan, narrative }),
      model: narrative ? PLANNER_MODEL : "deterministic-only",
      promptHash: promptHash({ request: request.id, requiredTrades }),
      grounding: JSON.stringify({ requestCount: stats.requestCount }),
      createdBy: user.id,
    })
    .returning();
  const stored = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "project_plan",
      entityId: stored.id,
      action: "planner_generated",
      payload: { requestId: id, model: stored.model, groundedOn: stats.requestCount },
    }),
  ]);
  return c.json(
    {
      id: stored.id,
      plan: { ...plan, narrative },
      model: stored.model,
      label: "draft",
      disclaimer: "Draft plan — not a quote, not a booking.",
    },
    201,
  );
});

plannerRouter.post("/plans/:id/feedback", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const plan = (await db.select().from(projectPlans).where(eq(projectPlans.id, id)).limit(1))[0];
  if (!plan) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  const feedback = b.useful === true ? "useful" : b.useful === false ? "not_useful" : "";
  if (!feedback) return c.json({ error: "useful_boolean_required" }, 400);
  const comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim() : null;

  await db.batch([
    db
      .update(projectPlans)
      .set({ feedback, feedbackComment: comment, feedbackAt: new Date().toISOString() })
      .where(eq(projectPlans.id, id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "project_plan",
      entityId: id,
      action: "planner_feedback",
      payload: { requestId: plan.requestId, feedback, comment },
    }),
  ]);
  return c.json({ ok: true, id, feedback });
});

plannerRouter.get("/requests/:id/plans", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(projectPlans)
    .where(eq(projectPlans.requestId, id))
    .orderBy(desc(projectPlans.createdAt));
  return c.json({
    plans: rows.map((p) => ({
      id: p.id,
      plan: JSON.parse(p.planJson),
      model: p.model,
      feedback: p.feedback,
      feedbackComment: p.feedbackComment,
      createdAt: p.createdAt,
    })),
  });
});

/** Evaluation dataset for the expand/no-expand gate. */
plannerRouter.get("/pilot/planner-feedback", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(projectPlans);
  const useful = rows.filter((r) => r.feedback === "useful").length;
  const notUseful = rows.filter((r) => r.feedback === "not_useful").length;
  return c.json({
    generated: rows.length,
    feedbackGiven: useful + notUseful,
    useful,
    notUseful,
    comments: rows.filter((r) => r.feedbackComment).map((r) => r.feedbackComment),
  });
});

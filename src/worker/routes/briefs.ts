import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { briefProposals } from "../db/schema";
import type { BriefDraft } from "../ai/brief";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { BRIEF_MODEL, draftBrief, validateBrief } from "../ai/brief";

export const briefsRouter = new Hono<AppEnv>();

/**
 * AI brief builder routes. A drafted brief is inert until staff approve:
 * approval records `brief_approved` and returns the sanitised final values
 * for pre-filling the request form. It never auto-creates a request.
 */
briefsRouter.post("/briefs/draft", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const sourceText = (body as Record<string, unknown>).sourceText;
  if (typeof sourceText !== "string" || sourceText.trim().length < 10)
    return c.json({ error: "source_text_required: describe the job in a sentence or more" }, 400);

  if (!c.env.AI) {
    return c.json(
      { error: "brief_unavailable: AI binding not configured — use the manual request form" },
      502,
    );
  }
  const result = await draftBrief(c.env.AI, sourceText.trim());
  if (!result.ok) {
    return c.json(
      {
        error: `brief_draft_failed: ${result.reason} — use the manual request form`,
      },
      502,
    );
  }

  const inserted = await db
    .insert(briefProposals)
    .values({
      sourceText: sourceText.trim(),
      proposedJson: JSON.stringify(result.proposal.draft),
      missingFields: JSON.stringify(result.proposal.missing),
      model: BRIEF_MODEL,
      createdBy: user.id,
    })
    .returning();
  const proposal = inserted[0]!;
  return c.json(
    {
      id: proposal.id,
      draft: result.proposal.draft,
      missing: result.proposal.missing,
      state: proposal.state,
    },
    201,
  );
});

briefsRouter.post("/briefs/:id/approve", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const proposal = (
    await db.select().from(briefProposals).where(eq(briefProposals.id, id)).limit(1)
  )[0];
  if (!proposal) return c.json({ error: "not_found" }, 404);
  if (proposal.state === "approved")
    return c.json({ error: "already_approved" }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const finalRaw = (body as Record<string, unknown>).final;
  // Staff-edited values go through the same sanitisation as the draft.
  const { draft: final, missing } = validateBrief(finalRaw);

  const updated = await db
    .update(briefProposals)
    .set({
      finalJson: JSON.stringify(final),
      missingFields: JSON.stringify(missing),
      state: "approved",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(briefProposals.id, id))
    .returning();

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "brief",
      entityId: id,
      action: "brief_approved",
      payload: {
        sourceTextLength: proposal.sourceText.length,
        finalTrades: final.trades,
        finalLocation: final.location,
        missing,
      },
    }),
  ]);

  return c.json({
    id,
    final,
    missing,
    proposed: JSON.parse(proposal.proposedJson) as BriefDraft,
    state: "approved",
  });
});

briefsRouter.get("/briefs/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const proposal = (
    await db.select().from(briefProposals).where(eq(briefProposals.id, id)).limit(1)
  )[0];
  if (!proposal) return c.json({ error: "not_found" }, 404);
  return c.json({
    id: proposal.id,
    sourceText: proposal.sourceText,
    proposed: JSON.parse(proposal.proposedJson),
    missing: proposal.missingFields ? JSON.parse(proposal.missingFields) : [],
    final: proposal.finalJson ? JSON.parse(proposal.finalJson) : null,
    state: proposal.state,
  });
});

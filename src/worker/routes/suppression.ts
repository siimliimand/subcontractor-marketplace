import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { emailSuppressions } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";

export const suppressionRouter = new Hono<AppEnv>();

/**
 * Phase 3 data governance: manual suppression-list management. Bounce-driven
 * suppressions (from email lifecycle events) and manual additions live in the
 * same table and behave identically in every send path; this router adds the
 * deliberate staff controls — list with origin, add with reason, remove with
 * reason. Every change is audit-logged (`suppression_added` /
 * `suppression_removed`) with the acting staff user.
 */

suppressionRouter.get("/suppressions", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(emailSuppressions)
    .orderBy(desc(emailSuppressions.createdAt));
  return c.json({ suppressions: rows });
});

suppressionRouter.post("/suppressions", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) return c.json({ error: "invalid_email" }, 400);
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason) return c.json({ error: "reason_required" }, 400);

  const existing = (
    await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email)).limit(1)
  )[0];
  if (existing) return c.json({ error: "already_suppressed", suppression: existing }, 409);

  await db.batch([
    db.insert(emailSuppressions).values({ email, reason: `${reason} (manual)` }),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "email_suppression",
      entityId: email,
      action: "suppression_added",
      payload: { email, reason },
    }),
  ]);
  return c.json({ ok: true, email, reason }, 201);
});

suppressionRouter.delete("/suppressions/:email", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return c.json({ error: "reason_required" }, 400);

  const existing = (
    await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email)).limit(1)
  )[0];
  if (!existing) return c.json({ error: "not_found" }, 404);

  await db.batch([
    db.delete(emailSuppressions).where(eq(emailSuppressions.email, email)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "email_suppression",
      entityId: email,
      action: "suppression_removed",
      payload: { email, reason, previousReason: existing.reason },
    }),
  ]);
  return c.json({ ok: true, email, reason });
});

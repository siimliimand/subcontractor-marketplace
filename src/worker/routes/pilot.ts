import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { partners, pilotAgreements, requests } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { monetizationEnabled, pilotUsage } from "../monetization";

export const pilotRouter = new Hono<AppEnv>();

/**
 * Phase 4 monetization pilot: hand-billed agreements per design partner and
 * the experiment metrics. No payment processing — an agreement is a record
 * of a commercial arrangement, and every change is audit-logged.
 */

pilotRouter.get("/pilot/agreements", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(pilotAgreements);
  const partnerRows = await db.select().from(partners);
  const byId = new Map(partnerRows.map((p) => [p.id, p]));
  return c.json({
    monetizationEnabled: monetizationEnabled(c.env),
    agreements: rows.map((a) => ({
      ...a,
      partnerName: byId.get(a.partnerId)?.name ?? null,
    })),
  });
});

pilotRouter.post("/pilot/agreements", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  let partnerId = typeof b.partnerId === "string" ? b.partnerId : "";
  if (!partnerId) {
    // Allow creating the agreement against a new partner name in one call.
    const name = typeof b.partnerName === "string" ? b.partnerName.trim() : "";
    if (!name) return c.json({ error: "partner_required" }, 400);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const existing = await db.select().from(partners).where(eq(partners.slug, slug)).limit(1);
    if (existing.length > 0) partnerId = existing[0]!.id;
    else {
      const inserted = await db.insert(partners).values({ name, slug }).returning();
      partnerId = inserted[0]!.id;
    }
  } else {
    const partner = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
    if (partner.length === 0) return c.json({ error: "partner_not_found" }, 400);
  }

  const startsAt = typeof b.startsAt === "string" && b.startsAt ? b.startsAt : new Date().toISOString();
  if (Number.isNaN(new Date(startsAt).getTime())) return c.json({ error: "invalid_startsAt" }, 400);
  const endsAt = typeof b.endsAt === "string" && b.endsAt ? b.endsAt : null;
  if (endsAt && Number.isNaN(new Date(endsAt).getTime())) return c.json({ error: "invalid_endsAt" }, 400);
  const monthlyEur = typeof b.monthlyEur === "number" && Number.isFinite(b.monthlyEur) ? b.monthlyEur : null;

  const inserted = await db
    .insert(pilotAgreements)
    .values({
      partnerId,
      plan: "booking_pilot",
      monthlyEur,
      startsAt,
      endsAt,
      notes: typeof b.notes === "string" ? b.notes : null,
      createdBy: user.id,
    })
    .returning();
  const agreement = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "pilot_agreement",
      entityId: agreement.id,
      action: "pilot_agreement_added",
      payload: { partnerId, monthlyEur, startsAt, endsAt },
    }),
  ]);
  return c.json(agreement, 201);
});

pilotRouter.post("/pilot/agreements/:id/end", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const agreement = (await db.select().from(pilotAgreements).where(eq(pilotAgreements.id, id)).limit(1))[0];
  if (!agreement) return c.json({ error: "not_found" }, 404);
  if (agreement.status !== "active") return c.json({ error: `agreement_is_${agreement.status}` }, 400);

  const now = new Date().toISOString();
  await db.batch([
    db
      .update(pilotAgreements)
      .set({ status: "ended", endsAt: now, updatedAt: now })
      .where(eq(pilotAgreements.id, id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "pilot_agreement",
      entityId: id,
      action: "pilot_agreement_ended",
      payload: { partnerId: agreement.partnerId },
    }),
  ]);
  return c.json({ ok: true, id, status: "ended" });
});

/** Experiment readout: per-partner booking usage, gated views, agreement state. */
pilotRouter.get("/pilot/metrics", async (c) => {
  const db = drizzle(c.env.DB);
  const usage = await pilotUsage(db, { now: new Date() });
  const onAgreements = usage.filter((u) => u.activeAgreement).length;
  return c.json({
    monetizationEnabled: monetizationEnabled(c.env),
    partners: usage.length,
    onAgreements,
    shareOnAgreements: usage.length === 0 ? 0 : Math.round((onAgreements / usage.length) * 100) / 100,
    usage,
  });
});

/** Request→partner attachment helper used by the cockpit when the pilot is
 * being set up (requests may also carry partnerId directly on creation). */
pilotRouter.post("/requests/:id/partner", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const partnerId = typeof (body as Record<string, unknown>)?.partnerId === "string"
    ? ((body as Record<string, unknown>).partnerId as string)
    : "";
  if (!partnerId) return c.json({ error: "partner_id_required" }, 400);
  const partner = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (partner.length === 0) return c.json({ error: "partner_not_found" }, 400);
  const updated = await db
    .update(requests)
    .set({ partnerId, updatedAt: new Date().toISOString() })
    .where(eq(requests.id, id))
    .returning();
  if (updated.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, requestId: id, partnerId });
});

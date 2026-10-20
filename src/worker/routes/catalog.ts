import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { partners, trades as tradesTable, regions as regionsTable } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { listTrades, listRegions, resetCatalogCache } from "../catalog";

export const catalogRouter = new Hono<AppEnv>();

/**
 * Phase 4 trade/region catalog: staff CRUD so adding a trade or region never
 * needs a deploy. Deactivation preserves all historical data — the trade just
 * stops appearing for new records. Catalog writes reset the TTL cache.
 */

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

catalogRouter.get("/catalog", async (c) => {
  const db = drizzle(c.env.DB);
  return c.json({ trades: await listTrades(db), regions: await listRegions(db) });
});

catalogRouter.post("/catalog/trades", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label) return c.json({ error: "label_required" }, 400);
  const slug = typeof b.slug === "string" && b.slug.trim() ? slugify(b.slug) : slugify(label);
  if (!slug) return c.json({ error: "slug_required" }, 400);
  const pilotMinimum = typeof b.pilotMinimum === "number" && Number.isInteger(b.pilotMinimum) && b.pilotMinimum > 0
    ? b.pilotMinimum
    : 4;

  const existing = await db.select().from(tradesTable).where(eq(tradesTable.slug, slug)).limit(1);
  if (existing.length > 0) {
    if (existing[0]!.active === 1) return c.json({ error: "trade_exists" }, 409);
    // Re-activating a deactivated trade is a data change too.
    await db.update(tradesTable).set({ active: 1, label, pilotMinimum }).where(eq(tradesTable.slug, slug));
    resetCatalogCache();
    return c.json({ ok: true, slug, reactivated: true }, 200);
  }

  await db.batch([
    db.insert(tradesTable).values({ slug, label, pilotMinimum, active: 1 }),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "trade",
      entityId: slug,
      action: "trade_added",
      payload: { slug, label, pilotMinimum },
    }),
  ]);
  resetCatalogCache();
  return c.json({ ok: true, slug }, 201);
});

catalogRouter.post("/catalog/trades/:slug/deactivate", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return c.json({ error: "reason_required" }, 400);

  const row = (await db.select().from(tradesTable).where(eq(tradesTable.slug, slug)).limit(1))[0];
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.active === 0) return c.json({ ok: true, slug, alreadyInactive: true });

  await db.batch([
    db.update(tradesTable).set({ active: 0 }).where(eq(tradesTable.slug, slug)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "trade",
      entityId: slug,
      action: "trade_deactivated",
      payload: { slug, reason },
    }),
  ]);
  resetCatalogCache();
  return c.json({ ok: true, slug });
});

catalogRouter.post("/catalog/regions", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const slug = typeof b.slug === "string" && b.slug.trim() ? slugify(b.slug) : slugify(name);
  if (!slug) return c.json({ error: "slug_required" }, 400);

  const existing = await db.select().from(regionsTable).where(eq(regionsTable.slug, slug)).limit(1);
  if (existing.length > 0) return c.json({ error: "region_exists" }, 409);

  await db.batch([
    db.insert(regionsTable).values({ slug, name, active: 1 }),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "region",
      entityId: slug,
      action: "region_added",
      payload: { slug, name },
    }),
  ]);
  resetCatalogCache();
  return c.json({ ok: true, slug }, 201);
});

// --- Partners (monetization) ---

catalogRouter.get("/partners", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(partners);
  return c.json({ partners: rows });
});

catalogRouter.post("/partners", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const slug = typeof b.slug === "string" && b.slug.trim() ? slugify(b.slug) : slugify(name);
  const existing = await db.select().from(partners).where(eq(partners.slug, slug)).limit(1);
  if (existing.length > 0) return c.json({ error: "partner_exists" }, 409);
  const inserted = await db
    .insert(partners)
    .values({ name, slug, notes: typeof b.notes === "string" ? b.notes : null })
    .returning();
  return c.json(inserted[0], 201);
});

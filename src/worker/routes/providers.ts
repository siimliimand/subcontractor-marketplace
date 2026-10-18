import { Hono } from "hono";
import { and, asc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { companies, services } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { isPricingModel, isProviderStatus, isTrade } from "../config";

type Env = AppEnv;

function providerMessage(error: string) {
  return { error };
}

export const providersRouter = new Hono<Env>();

providersRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const { trade, status, serviceArea, q } = c.req.query();

  const conditions = [];
  if (trade) conditions.push(eq(services.trade, trade));
  if (status) conditions.push(eq(companies.status, status));
  if (serviceArea) conditions.push(like(services.serviceArea, `%${serviceArea}%`));
  if (q) conditions.push(like(companies.legalName, `%${q}%`));

  const rows = await db
    .selectDistinct({ company: companies, service: services })
    .from(companies)
    .leftJoin(services, eq(services.companyId, companies.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(companies.legalName));

  const byId = new Map<string, { company: typeof companies.$inferSelect; services: unknown[] }>();
  for (const row of rows) {
    const entry = byId.get(row.company.id) ?? { company: row.company, services: [] };
    if (row.service) entry.services.push(row.service);
    byId.set(row.company.id, entry);
  }
  return c.json([...byId.values()]);
});

providersRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);

  const { legalName, registrationIdentifier, contactEmail, contactPhone, status } =
    body as Record<string, unknown>;

  if (typeof legalName !== "string" || !legalName.trim())
    return c.json(providerMessage("legal_name_required"), 400);
  if (typeof registrationIdentifier !== "string" || !registrationIdentifier.trim())
    return c.json(providerMessage("registration_identifier_required"), 400);
  if (typeof contactEmail !== "string" || !contactEmail.includes("@"))
    return c.json(providerMessage("contact_email_required"), 400);
  if (status !== undefined && (typeof status !== "string" || !isProviderStatus(status)))
    return c.json(
      providerMessage("invalid_status: allowed values active, inactive, opted_out"),
      400,
    );

  const existing = await db
    .select()
    .from(companies)
    .where(eq(companies.registrationIdentifier, registrationIdentifier))
    .limit(1);
  if (existing.length > 0) {
    return c.json(providerMessage("registration_identifier_exists"), 409);
  }

  const inserted = await db
    .insert(companies)
    .values({
      legalName: legalName.trim(),
      registrationIdentifier: registrationIdentifier.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: typeof contactPhone === "string" ? contactPhone : null,
      status: (status as string) ?? "active",
    })
    .returning();
  const company = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: company.id,
      action: "provider_created",
      payload: { legalName: company.legalName, status: company.status },
    }),
  ]);
  return c.json(company, 201);
});

providersRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (
    await db.select().from(companies).where(eq(companies.id, id)).limit(1)
  )[0];
  if (!company) return c.json(providerMessage("not_found"), 404);
  const providerServices = await db
    .select()
    .from(services)
    .where(eq(services.companyId, id))
    .orderBy(asc(services.createdAt));
  return c.json({ ...company, services: providerServices });
});

providersRouter.patch("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);

  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const patch: Partial<typeof companies.$inferInsert> = { updatedAt: new Date().toISOString() };
  const b = body as Record<string, unknown>;

  if (b.legalName !== undefined) {
    if (typeof b.legalName !== "string" || !b.legalName.trim())
      return c.json(providerMessage("legal_name_required"), 400);
    patch.legalName = b.legalName.trim();
  }
  if (b.contactEmail !== undefined) {
    if (typeof b.contactEmail !== "string" || !b.contactEmail.includes("@"))
      return c.json(providerMessage("contact_email_required"), 400);
    patch.contactEmail = b.contactEmail.trim();
  }
  if (b.contactPhone !== undefined) {
    patch.contactPhone = typeof b.contactPhone === "string" ? b.contactPhone : null;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !isProviderStatus(b.status))
      return c.json(
        providerMessage("invalid_status: allowed values active, inactive, opted_out"),
        400,
      );
    if (b.status !== company.status) {
      const reason = typeof b.reason === "string" ? b.reason : null;
      if (!reason || !reason.trim())
        return c.json(providerMessage("status_change_requires_reason"), 400);
      patch.status = b.status;
      patch.statusReason = reason;
      patch.statusChangedAt = new Date().toISOString();
    }
  }

  const updated = await db
    .update(companies)
    .set(patch)
    .where(eq(companies.id, id))
    .returning();
  const next = updated[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: id,
      action: "provider_updated",
      payload: {
        fields: Object.keys(patch).filter((k) => k !== "updatedAt"),
        status: next.status,
      },
    }),
  ]);
  return c.json(next);
});

providersRouter.post("/:id/services", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const companyId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);

  const company = (
    await db.select().from(companies).where(eq(companies.id, companyId)).limit(1)
  )[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const { trade, skills, serviceArea, pricingApproach, pricingModel } =
    body as Record<string, unknown>;

  if (typeof trade !== "string" || !isTrade(trade))
    return c.json(
      providerMessage("invalid_trade: allowed trades electrical, plumbing, hvac, drywall, flooring, painting"),
      400,
    );
  if (typeof serviceArea !== "string" || !serviceArea.trim())
    return c.json(providerMessage("service_area_required"), 400);
  if (typeof pricingModel !== "string" || !isPricingModel(pricingModel))
    return c.json(
      providerMessage("invalid_pricing_model: allowed values hour, m2, project"),
      400,
    );

  const inserted = await db
    .insert(services)
    .values({
      companyId,
      trade,
      skills: typeof skills === "string" ? skills : null,
      serviceArea: serviceArea.trim(),
      pricingApproach: typeof pricingApproach === "string" ? pricingApproach : null,
      pricingModel,
    })
    .returning();
  const service = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: companyId,
      action: "provider_updated",
      payload: { serviceAdded: { id: service.id, trade, pricingModel } },
    }),
  ]);
  return c.json(service, 201);
});

providersRouter.patch("/:id/services/:serviceId", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const companyId = c.req.param("id");
  const serviceId = c.req.param("serviceId");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);

  const service = (
    await db.select().from(services).where(eq(services.id, serviceId)).limit(1)
  )[0];
  if (!service || service.companyId !== companyId)
    return c.json(providerMessage("not_found"), 404);

  const patch: Partial<typeof services.$inferInsert> = { updatedAt: new Date().toISOString() };
  const b = body as Record<string, unknown>;

  if (b.trade !== undefined) {
    if (typeof b.trade !== "string" || !isTrade(b.trade))
      return c.json(
        providerMessage("invalid_trade: allowed trades electrical, plumbing, hvac, drywall, flooring, painting"),
        400,
      );
    patch.trade = b.trade;
  }
  if (b.serviceArea !== undefined) {
    if (typeof b.serviceArea !== "string" || !b.serviceArea.trim())
      return c.json(providerMessage("service_area_required"), 400);
    patch.serviceArea = b.serviceArea.trim();
  }
  if (b.pricingModel !== undefined) {
    if (typeof b.pricingModel !== "string" || !isPricingModel(b.pricingModel))
      return c.json(
        providerMessage("invalid_pricing_model: allowed values hour, m2, project"),
        400,
      );
    patch.pricingModel = b.pricingModel;
  }
  if (b.skills !== undefined) {
    patch.skills = typeof b.skills === "string" ? b.skills : null;
  }
  if (b.pricingApproach !== undefined) {
    patch.pricingApproach = typeof b.pricingApproach === "string" ? b.pricingApproach : null;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !isProviderStatus(b.status))
      return c.json(
        providerMessage("invalid_status: allowed values active, inactive, opted_out"),
        400,
      );
    if (b.status !== service.status) {
      const reason = typeof b.reason === "string" ? b.reason : null;
      if (!reason || !reason.trim())
        return c.json(providerMessage("status_change_requires_reason"), 400);
      patch.status = b.status;
      patch.statusReason = reason;
      patch.statusChangedAt = new Date().toISOString();
    }
  }

  const updated = await db
    .update(services)
    .set(patch)
    .where(eq(services.id, serviceId))
    .returning();
  const next = updated[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: companyId,
      action: "provider_updated",
      payload: { serviceUpdated: { id: serviceId, fields: Object.keys(patch).filter((k) => k !== "updatedAt") } },
    }),
  ]);
  return c.json(next);
});

import { Hono } from "hono";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  availabilityDeclarations,
  bookingReviews,
  bookings,
  calendarFeeds,
  companies,
  companyVerifications,
  emailSuppressions,
  providerUsers,
  serviceRegions,
  services,
  AVAILABILITY_CHANNELS,
  type AvailabilityChannel,
} from "../db/schema";
import { issueProviderToken } from "../providerAuth";
import { computeBadges, computeEstablished } from "../verification";
import { isCatalogRegion } from "../catalog";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { isCatalogTrade, isKnownCatalogTrade } from "../catalog";
import { isPricingModel, isProviderStatus } from "../config";
import {
  declarationsForCompany,
  freshness,
  summariseDeclarations,
} from "../availability";

export function isAvailabilityChannel(value: string): value is AvailabilityChannel {
  return (AVAILABILITY_CHANNELS as readonly string[]).includes(value);
}

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

  if (typeof trade !== "string" || !(await isCatalogTrade(db, trade)))
    return c.json(
      providerMessage("invalid_trade: trade is not in the active catalog"),
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
    if (typeof b.trade !== "string" || !(await isCatalogTrade(db, b.trade)))
      return c.json(
        providerMessage("invalid_trade: trade is not in the active catalog"),
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

// --- Availability declarations (phase 2 booking core) ---

providersRouter.get("/:id/availability", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const { trade, dateFrom, dateTo } = c.req.query();
  const declarations = await declarationsForCompany(db, id, trade || undefined);
  const summary = summariseDeclarations(declarations, {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  return c.json({ declarations, summary });
});

providersRouter.post("/:id/availability", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);
  const b = body as Record<string, unknown>;

  const trade = typeof b.trade === "string" ? b.trade : "";
  if (!(await isCatalogTrade(db, trade)))
    return c.json(
      providerMessage("invalid_trade: trade is not in the active catalog"),
      400,
    );
  const workersCount = typeof b.workersCount === "number" ? b.workersCount : 0;
  if (!Number.isInteger(workersCount) || workersCount < 1)
    return c.json(providerMessage("workers_count_must_be_positive_integer"), 400);
  const dateFrom = typeof b.dateFrom === "string" ? b.dateFrom : "";
  const dateTo = typeof b.dateTo === "string" ? b.dateTo : "";
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(dateFrom) || !dateRe.test(dateTo) || dateFrom > dateTo)
    return c.json(providerMessage("invalid_date_range: need dateFrom <= dateTo as YYYY-MM-DD"), 400);
  const channel = typeof b.channel === "string" && b.channel ? b.channel : "booking_system";
  if (!isAvailabilityChannel(channel))
    return c.json(
      providerMessage("invalid_channel: allowed values booking_system, email_only"),
      400,
    );

  const lastConfirmedAt = new Date().toISOString();
  const inserted = await db
    .insert(availabilityDeclarations)
    .values({
      companyId: id,
      trade,
      workersCount,
      dateFrom,
      dateTo,
      channel,
      lastConfirmedAt,
      notes: typeof b.notes === "string" ? b.notes : null,
      createdBy: user.id,
    })
    .returning();
  const declaration = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: id,
      action: "provider_updated",
      payload: {
        availabilityDeclared: {
          declarationId: declaration.id,
          trade,
          workersCount,
          dateFrom,
          dateTo,
          channel,
        },
      },
    }),
  ]);
  return c.json({ ...declaration, freshness: freshness(lastConfirmedAt) }, 201);
});

/**
 * Phase 3: one-click reconfirmation (details/03 — required when availability
 * data goes stale or the work date changes materially). Clones the latest
 * declaration covering the given window with a fresh confirmation timestamp
 * so freshness recomputes to `current`; the concierge records the provider's
 * verbal confirmation. Accepts either a bookingId (derives company, trade and
 * window from the booking) or an explicit trade + date range.
 */
providersRouter.post("/:id/availability/reconfirm", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);
  const b = body as Record<string, unknown>;

  let trade = "";
  let dateFrom = "";
  let dateTo = "";
  let source = "explicit";
  if (typeof b.bookingId === "string" && b.bookingId) {
    const booking = (await db.select().from(bookings).where(eq(bookings.id, b.bookingId)).limit(1))[0];
    if (!booking || booking.companyId !== id)
      return c.json(providerMessage("booking_not_found_for_provider"), 404);
    trade = booking.trade;
    dateFrom = booking.startDate;
    dateTo = booking.endDate;
    source = "booking";
  } else {
    trade = typeof b.trade === "string" ? b.trade : "";
    dateFrom = typeof b.dateFrom === "string" ? b.dateFrom : "";
    dateTo = typeof b.dateTo === "string" ? b.dateTo : "";
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(dateFrom) || !dateRe.test(dateTo) || dateFrom > dateTo)
      return c.json(providerMessage("invalid_date_range: need dateFrom <= dateTo as YYYY-MM-DD"), 400);
  }
  if (!(await isKnownCatalogTrade(db, trade))) return c.json(providerMessage("invalid_trade"), 400);

  // Latest declaration for the provider+trade whose range covers the window.
  const latest = (
    await db
      .select()
      .from(availabilityDeclarations)
      .where(and(eq(availabilityDeclarations.companyId, id), eq(availabilityDeclarations.trade, trade)))
      .orderBy(desc(availabilityDeclarations.lastConfirmedAt))
  ).find((d) => d.dateFrom <= dateTo && d.dateTo >= dateFrom);

  const lastConfirmedAt = new Date().toISOString();
  const inserted = await db
    .insert(availabilityDeclarations)
    .values({
      companyId: id,
      trade,
      workersCount: latest?.workersCount ?? 1,
      dateFrom: latest?.dateFrom ?? dateFrom,
      dateTo: latest?.dateTo ?? dateTo,
      channel: latest?.channel ?? "booking_system",
      lastConfirmedAt,
      notes: `reconfirmation (${source})`,
      createdBy: user.id,
    })
    .returning();
  const declaration = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: id,
      action: "availability_reconfirmed",
      payload: {
        declarationId: declaration.id,
        trade,
        source,
        clonedFrom: latest?.id ?? null,
        dateFrom: declaration.dateFrom,
        dateTo: declaration.dateTo,
        workersCount: declaration.workersCount,
      },
    }),
  ]);
  return c.json({ ...declaration, freshness: freshness(lastConfirmedAt) }, 201);
});

/**
 * Phase 3 data governance: company data erasure (GDPR art. 17 spirit at
 * pilot scale). Anonymises the company's contact/personal fields, opts it
 * out (excluded from matching + sending), and redacts its contact email from
 * the audit trail (payloads + actor emails) with SQL replace. Funnel history
 * is preserved — events remain, attributed to anonymised participants.
 * Reason required; the erasure itself is audited WITHOUT embedding the
 * erased email.
 */
providersRouter.post("/:id/erase", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return c.json(providerMessage("reason_required"), 400);

  const now = new Date().toISOString();
  const placeholder = `Erased company ${id.slice(0, 8)}`;
  const contactEmail = company.contactEmail;

  // Phase 4: gather every new personal-data artifact before the batch —
  // provider user emails go through the same audit redaction as the contact
  // email; reviews keep their row but lose their text and their metric
  // contribution (disputed reviews are excluded everywhere).
  const companyProviderUsers = await db
    .select()
    .from(providerUsers)
    .where(eq(providerUsers.companyId, id));
  const companyReviews = await db.select().from(bookingReviews).where(eq(bookingReviews.companyId, id));

  await db.batch([
    db
      .update(companies)
      .set({
        legalName: placeholder,
        // contactEmail is NOT NULL (existing schema) — anonymise to a
        // non-identifying constant; opted_out status keeps it out of every
        // matching and send path.
        contactEmail: "erased-contact",
        contactPhone: null,
        status: "opted_out",
        statusReason: `erased: ${reason}`,
        statusChangedAt: now,
      })
      .where(eq(companies.id, id)),
    // Phase 4: calendar feeds + their intervals (cascade) and provider
    // users (+ their tokens, cascade) are purged with the company.
    db.delete(calendarFeeds).where(eq(calendarFeeds.companyId, id)),
    db.delete(providerUsers).where(eq(providerUsers.companyId, id)),
    ...companyReviews.map((r) =>
      db
        .update(bookingReviews)
        .set({
          comment: null,
          disputedAt: now,
          disputeReason: "company erased",
          updatedAt: now,
        })
        .where(eq(bookingReviews.id, r.id)),
    ),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "company",
      entityId: id,
      action: "company_erased",
      payload: { companyId: id, reason, anonymisedAs: placeholder },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);

  // Audit-trail redaction (raw SQL, run after the batch — both are idempotent
  // and the erasure event above never contains the erased address): every
  // occurrence of the contact email in payloads/actors becomes a neutral
  // marker. Events and their structure survive; the identifier does not.
  if (contactEmail) {
    await db.run(
      sql`UPDATE audit_events SET payloadJson = replace(payloadJson, ${contactEmail}, 'erased-contact') WHERE payloadJson LIKE ${"%" + contactEmail + "%"}`,
    );
    await db.run(
      sql`UPDATE audit_events SET actorEmail = 'erased-contact' WHERE actorEmail = ${contactEmail}`,
    );
  }
  // Provider user emails redact the same way.
  for (const pu of companyProviderUsers) {
    await db.run(
      sql`UPDATE audit_events SET payloadJson = replace(payloadJson, ${pu.email}, 'erased-contact') WHERE payloadJson LIKE ${"%" + pu.email + "%"}`,
    );
    await db.run(
      sql`UPDATE audit_events SET actorEmail = 'erased-contact' WHERE actorEmail = ${pu.email}`,
    );
  }

  return c.json({
    ok: true,
    companyId: id,
    anonymisedAs: placeholder,
    purged: {
      calendarFeeds: true,
      providerUsers: companyProviderUsers.length,
      reviewsDisputed: companyReviews.length,
    },
  }, 200);
});

/**
 * Phase 4: verification badge panel. Rows come exclusively from the offline
 * register imports; the trade-notification badge reports `displayable: false`
 * while MTR_BADGES_ENABLED is off (TTJA licence confirmation pending).
 */
providersRouter.get("/:id/verifications", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const rows = await db
    .select()
    .from(companyVerifications)
    .where(eq(companyVerifications.companyId, id));
  const mtrEnabled = c.env.MTR_BADGES_ENABLED === "true";

  // Phase 4: the Established badge derives from platform history — completed
  // bookings with positive outcomes; customer-caused cancellations excluded
  // (only completion_confirmed counts as a positive completion).
  const companyBookings = await db.select().from(bookings).where(eq(bookings.companyId, id));
  const positiveCompletions = companyBookings.filter(
    (b) => b.outcome === "completion_confirmed",
  ).length;

  return c.json({
    verifications: rows,
    badges: computeBadges(rows, { mtrEnabled }),
    mtrBadgesEnabled: mtrEnabled,
    established: computeEstablished(positiveCompletions),
  });
});

// --- Phase 4: region coverage ---

providersRouter.get("/:id/regions", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);
  const rows = await db
    .select()
    .from(serviceRegions)
    .where(eq(serviceRegions.companyId, id));
  return c.json({ regions: rows.map((r) => r.regionSlug) });
});

/** Replace the whole coverage set (validated against the catalog). An empty
 * set is valid — the provider becomes coverage-optional (eligible everywhere). */
providersRouter.put("/:id/regions", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);
  const raw = (body as Record<string, unknown>).regions;
  if (!Array.isArray(raw)) return c.json(providerMessage("regions_must_be_an_array"), 400);
  const slugs = [...new Set(raw.filter((r): r is string => typeof r === "string"))];
  for (const slug of slugs) {
    if (!(await isCatalogRegion(db, slug)))
      return c.json(providerMessage(`invalid_region: ${slug} is not in the catalog`), 400);
  }

  await db.batch([
    db.delete(serviceRegions).where(eq(serviceRegions.companyId, id)),
    ...slugs.map((slug) => db.insert(serviceRegions).values({ companyId: id, regionSlug: slug })),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return c.json({ regions: slugs });
});

// --- Phase 4: multi-user provider accounts (staff side) ---

providersRouter.get("/:id/users", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);
  const rows = await db.select().from(providerUsers).where(eq(providerUsers.companyId, id));
  return c.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
  });
});

/** Staff provisions users (the first owner, or additional members) — invites
 * go through the same single-use token + suppression checks as owner invites. */
providersRouter.post("/:id/users", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(providerMessage("not_found"), 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(providerMessage("invalid_json"), 400);
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) return c.json(providerMessage("invalid_email"), 400);
  const role = b.role === "owner" ? "owner" : "coordinator";

  const suppressed = (
    await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email)).limit(1)
  )[0];
  if (suppressed) return c.json(providerMessage("invite_suppressed"), 409);
  const existing = (
    await db.select().from(providerUsers).where(eq(providerUsers.email, email)).limit(1)
  )[0];
  if (existing) return c.json(providerMessage("email_already_a_user"), 409);

  const inserted = await db
    .insert(providerUsers)
    .values({ companyId: id, email, role, status: "invited", invitedBy: user.id })
    .returning();
  const created = inserted[0]!;

  const { raw } = await issueProviderToken(db, {
    userId: created.id,
    purpose: "provider_invite",
    secret: c.env.PROVIDER_SESSION_SECRET ?? c.env.EMAIL_TOKEN_SECRET ?? "insecure-dev-secret",
  });
  if (c.env.SEND_EMAIL) {
    try {
      await c.env.SEND_EMAIL.send({
        from: c.env.EMAIL_FROM ?? "Subcrew <outreach@subcrew.example>",
        to: email,
        subject: "You've been invited to your company's Subcrew profile",
        text: `Accept your invitation with this single-use link (valid 3 days):\n${raw}\n`,
      });
    } catch {
      // token stays valid for manual delivery
    }
  }

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "provider_user",
      entityId: created.id,
      action: "provider_user_invited",
      payload: { companyId: id, email, role, invitedBy: "staff" },
    }),
  ]);
  return c.json(
    { id: created.id, email: created.email, role: created.role, status: created.status },
    201,
  );
});

providersRouter.post("/:id/users/:userId/disable", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const userId = c.req.param("userId");
  const target = (
    await db
      .select()
      .from(providerUsers)
      .where(and(eq(providerUsers.id, userId), eq(providerUsers.companyId, id)))
      .limit(1)
  )[0];
  if (!target) return c.json(providerMessage("not_found"), 404);
  if (target.status === "disabled") return c.json({ ok: true, id, alreadyDisabled: true });

  const body = await c.req.json().catch(() => ({}));
  const reason = typeof (body as Record<string, unknown>).reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return c.json(providerMessage("reason_required"), 400);

  const now = new Date().toISOString();
  await db.batch([
    db.update(providerUsers).set({ status: "disabled", updatedAt: now }).where(eq(providerUsers.id, userId)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "provider_user",
      entityId: userId,
      action: "provider_user_disabled",
      payload: { companyId: id, email: target.email, reason, disabledBy: "staff" },
    }),
  ]);
  return c.json({ ok: true, id: userId });
});

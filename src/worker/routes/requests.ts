import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import {
  auditEvents,
  bookings,
  companies,
  outreachEntries,
  requests,
  responses,
  timeEntries,
  users,
} from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement, type EventAction } from "../events";
import { isTrade, type RequestStatus } from "../config";
import { canTransition, PRE_BOOKED_STATUSES } from "../lifecycle";

export const requestsRouter = new Hono<AppEnv>();

function requiredFieldsPresent(r: {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  trade?: string | null;
  startDate?: string | null;
  crewSize?: number | null;
}) {
  const missing: string[] = [];
  if (!r.title) missing.push("title");
  if (!r.description) missing.push("description");
  if (!r.location) missing.push("location");
  if (!r.trade) missing.push("trade");
  if (!r.startDate) missing.push("startDate");
  if (!r.crewSize) missing.push("crewSize");
  return missing;
}

async function getRequestOr404(c: any, id: string) {
  const db = drizzle(c.env.DB);
  const row = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!row) {
    await c.json({ error: "not_found" }, 404);
    return null;
  }
  return row;
}

requestsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const { status, trade } = c.req.query();
  const conditions = [];
  if (status) conditions.push(eq(requests.status, status));
  if (trade) conditions.push(eq(requests.trade, trade));
  const rows = await db
    .select()
    .from(requests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(requests.createdAt));
  return c.json(rows);
});

requestsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const candidate = {
    title: typeof b.title === "string" ? b.title.trim() : "",
    description: typeof b.description === "string" ? b.description.trim() : "",
    location: typeof b.location === "string" ? b.location.trim() : "",
    trade: typeof b.trade === "string" ? b.trade : "",
    startDate: typeof b.startDate === "string" ? b.startDate : "",
    crewSize: typeof b.crewSize === "number" ? b.crewSize : 0,
  };
  if (!isTrade(candidate.trade))
    return c.json(
      {
        error:
          "invalid_trade: allowed trades electrical, plumbing, hvac, drywall, flooring, painting",
      },
      400,
    );
  const missing = requiredFieldsPresent(candidate);
  if (missing.length) return c.json({ error: `missing_required_fields: ${missing.join(", ")}` }, 400);
  if (candidate.crewSize < 1) return c.json({ error: "crew_size_must_be_positive" }, 400);

  const inserted = await db
    .insert(requests)
    .values({
      ...candidate,
      budget: typeof b.budget === "string" ? b.budget : null,
      duration: typeof b.duration === "string" ? b.duration : null,
      notes: typeof b.notes === "string" ? b.notes : null,
      pmName: typeof b.pmName === "string" ? b.pmName : null,
      status: "draft",
      createdBy: user.id,
    })
    .returning();
  const request = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: request.id,
      action: "request_created",
      payload: { title: request.title, trade: request.trade, crewSize: request.crewSize },
    }),
  ]);
  return c.json(request, 201);
});

requestsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);

  const [requestResponses, requestBookings, requestOutreach, requestTime, events] =
    await Promise.all([
      db
        .select({ response: responses, provider: companies })
        .from(responses)
        .leftJoin(companies, eq(companies.id, responses.companyId))
        .where(eq(responses.requestId, id))
        .orderBy(asc(responses.receivedAt)),
      db
        .select({ booking: bookings, provider: companies })
        .from(bookings)
        .leftJoin(companies, eq(companies.id, bookings.companyId))
        .where(eq(bookings.requestId, id)),
      db
        .select({ entry: outreachEntries, provider: companies })
        .from(outreachEntries)
        .leftJoin(companies, eq(companies.id, outreachEntries.companyId))
        .where(eq(outreachEntries.requestId, id))
        .orderBy(asc(outreachEntries.sentAt)),
      db.select().from(timeEntries).where(eq(timeEntries.requestId, id)),
      db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entity, "request"), eq(auditEvents.entityId, id)))
        .orderBy(asc(auditEvents.occurredAt)),
    ]);

  return c.json({
    request,
    responses: requestResponses,
    bookings: requestBookings,
    outreach: requestOutreach,
    timeEntries: requestTime,
    events,
  });
});

requestsRouter.patch("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (request.status !== "draft") return c.json({ error: "only_draft_editable" }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const field of ["title", "description", "location", "startDate"] as const) {
    if (b[field] !== undefined) {
      if (typeof b[field] !== "string" || !(b[field] as string).trim())
        return c.json({ error: `${field}_required` }, 400);
      patch[field] = (b[field] as string).trim();
    }
  }
  if (b.trade !== undefined) {
    if (typeof b.trade !== "string" || !isTrade(b.trade))
      return c.json(
        {
          error:
            "invalid_trade: allowed trades electrical, plumbing, hvac, drywall, flooring, painting",
        },
        400,
      );
    patch.trade = b.trade;
  }
  if (b.crewSize !== undefined) {
    if (typeof b.crewSize !== "number" || b.crewSize < 1)
      return c.json({ error: "crew_size_must_be_positive" }, 400);
    patch.crewSize = b.crewSize;
  }
  for (const field of ["budget", "duration", "notes", "pmName"] as const) {
    if (b[field] !== undefined) {
      patch[field] = typeof b[field] === "string" ? b[field] : null;
    }
  }

  const updated = await db.update(requests).set(patch).where(eq(requests.id, id)).returning();
  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "request_updated",
      payload: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
    }),
  ]);
  return c.json(updated[0]);
});

requestsRouter.post("/:id/transition", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const to = body && typeof body === "object" ? (body as Record<string, unknown>).to : null;
  if (typeof to !== "string")
    return c.json({ error: "transition_target_required" }, 400);

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);

  const from = request.status as RequestStatus;
  if (!canTransition(from, to as RequestStatus)) {
    return c.json(
      { error: `invalid_transition: ${from} cannot move to ${to}` },
      400,
    );
  }

  if (to === "approved") {
    const missing = requiredFieldsPresent(request);
    if (missing.length)
      return c.json({ error: `approval_requires_complete_brief: missing ${missing.join(", ")}` }, 400);
  }

  const updated = await db
    .update(requests)
    .set({ status: to, updatedAt: new Date().toISOString() })
    .where(eq(requests.id, id))
    .returning();

  const actions: Partial<Record<string, EventAction>> = {
    approved: "request_approved",
    matched: "matched",
  };
  const action = actions[to];
  if (action) {
    await db.batch([
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: user.email,
        entity: "request",
        entityId: id,
        action,
        payload: { from, to },
      }),
    ]);
  }
  return c.json(updated[0]);
});

requestsRouter.post("/:id/responses", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (["booked", "cancelled", "closed"].includes(request.status))
    return c.json({ error: `request_is_${request.status}: no further responses` }, 400);

  const type = typeof b.type === "string" ? b.type : "";
  if (!["interest", "quote", "decline"].includes(type))
    return c.json({ error: "invalid_type: allowed values interest, quote, decline" }, 400);

  const companyId = typeof b.companyId === "string" ? b.companyId : "";
  const provider = (
    await db.select().from(companies).where(eq(companies.id, companyId)).limit(1)
  )[0];
  if (!provider) return c.json({ error: "provider_not_found" }, 400);

  let workersCount: number | null = null;
  let availableFrom: string | null = null;
  if (type === "interest" || type === "quote") {
    workersCount = typeof b.workersCount === "number" ? b.workersCount : NaN as number;
    availableFrom = typeof b.availableFrom === "string" ? b.availableFrom : "";
    if (!workersCount || workersCount < 1 || !availableFrom)
      return c.json(
        { error: "capacity_declaration_required: workersCount and availableFrom are needed" },
        400,
      );
  }
  let reason: string | null = null;
  if (type === "decline") {
    reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (!reason) return c.json({ error: "decline_requires_reason" }, 400);
  } else if (typeof b.reason === "string" && b.reason.trim()) {
    reason = b.reason.trim();
  }

  const inserted = await db
    .insert(responses)
    .values({
      requestId: id,
      companyId,
      type,
      workersCount,
      availableFrom,
      reason,
      createdBy: user.id,
    })
    .returning();
  const response = inserted[0]!;

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (request.status === "matched" || request.status === "in_outreach") {
    patch.status = "responded";
  }
  const updated = await db.update(requests).set(patch).where(eq(requests.id, id)).returning();

  const events = [
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "response_received",
      payload: {
        responseId: response.id,
        companyId,
        type,
        provider: provider.legalName,
      },
    }),
  ];
  if (type === "interest") {
    events.push(
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: user.email,
        entity: "request",
        entityId: id,
        action: "qualified_response",
        payload: {
          responseId: response.id,
          companyId,
          workersCount,
          availableFrom,
        },
      }),
    );
  }
  if (type === "quote") {
    events.push(
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: user.email,
        entity: "request",
        entityId: id,
        action: "qualified_response",
        payload: { responseId: response.id, companyId, workersCount, availableFrom },
      }),
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: user.email,
        entity: "request",
        entityId: id,
        action: "quote_submitted",
        payload: { responseId: response.id, companyId },
      }),
    );
  }
  await db.batch(events as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return c.json({ response, request: updated[0] }, 201);
});

requestsRouter.post("/:id/bookings", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);

  if (request.status === "booked")
    return c.json({ error: "already_booked: first confirmed booking stands" }, 409);
  if (request.status !== "responded")
    return c.json({ error: `invalid_transition: ${request.status} cannot move to booked` }, 400);

  const responseId = typeof b.responseId === "string" ? b.responseId : "";
  const response = (
    await db.select().from(responses).where(eq(responses.id, responseId)).limit(1)
  )[0];
  if (!response || response.requestId !== id)
    return c.json({ error: "response_not_found_for_request" }, 400);
  if (!["interest", "quote"].includes(response.type))
    return c.json({ error: "booking_requires_interest_or_quote_response" }, 400);

  const startDate = typeof b.startDate === "string" ? b.startDate : "";
  const endDate = typeof b.endDate === "string" ? b.endDate : "";
  const workersCount = typeof b.workersCount === "number" ? b.workersCount : 0;
  if (!startDate || !endDate || workersCount < 1)
    return c.json({ error: "booking_requires_date_range_and_capacity" }, 400);

  const inserted = await db
    .insert(bookings)
    .values({
      requestId: id,
      responseId,
      companyId: response.companyId,
      startDate,
      endDate,
      workersCount,
      createdBy: user.id,
    })
    .returning();
  const booking = inserted[0]!;

  const updated = await db
    .update(requests)
    .set({ status: "booked", updatedAt: new Date().toISOString() })
    .where(eq(requests.id, id))
    .returning();

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_confirmed",
      payload: {
        bookingId: booking.id,
        companyId: booking.companyId,
        startDate,
        endDate,
        workersCount,
      },
    }),
  ]);
  return c.json({ booking, request: updated[0] }, 201);
});

requestsRouter.post("/:id/outcome", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (request.status !== "booked")
    return c.json({ error: "outcome_requires_booked_request" }, 400);

  const outcome = typeof b.outcome === "string" ? b.outcome : "";
  if (!["completion_confirmed", "accepted_but_not_delivered"].includes(outcome))
    return c.json(
      { error: "invalid_outcome: allowed values completion_confirmed, accepted_but_not_delivered" },
      400,
    );

  const booking = (
    await db.select().from(bookings).where(eq(bookings.requestId, id)).limit(1)
  )[0];
  if (!booking) return c.json({ error: "booking_not_found" }, 404);

  const now = new Date().toISOString();
  const updatedBookings = await db
    .update(bookings)
    .set({ outcome, outcomeReason: typeof b.reason === "string" ? b.reason : null, outcomeAt: now })
    .where(eq(bookings.id, booking.id))
    .returning();
  const updated = await db
    .update(requests)
    .set({ status: "closed", updatedAt: now })
    .where(eq(requests.id, id))
    .returning();

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: outcome as EventAction,
      payload: { bookingId: booking.id, reason: b.reason ?? null },
    }),
  ]);
  return c.json({ request: updated[0], booking: updatedBookings[0] });
});

requestsRouter.post("/:id/cancel", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const request = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (
    !PRE_BOOKED_STATUSES.includes(request.status as RequestStatus) &&
    request.status !== "booked"
  )
    return c.json({ error: `cannot_cancel_request_in_status_${request.status}` }, 400);

  const cancelledBy = typeof b.cancelledBy === "string" ? b.cancelledBy : "";
  if (!["customer", "provider"].includes(cancelledBy))
    return c.json({ error: "cancellation_requires_attribution: customer or provider" }, 400);
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason) return c.json({ error: "cancellation_requires_reason" }, 400);

  const now = new Date().toISOString();
  if (request.status === "booked") {
    const existingBooking = (
      await db.select().from(bookings).where(eq(bookings.requestId, id)).limit(1)
    )[0];
    if (existingBooking) {
      await db
        .update(bookings)
        .set({ outcome: "cancelled", outcomeReason: `${cancelledBy}: ${reason}`, outcomeAt: now })
        .where(eq(bookings.id, existingBooking.id));
    }
  }

  const updated = await db
    .update(requests)
    .set({
      status: "cancelled",
      cancelledBy,
      cancelReason: reason,
      updatedAt: now,
    })
    .where(eq(requests.id, id))
    .returning();

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "request_cancelled",
      payload: { cancelledBy, reason, fromStatus: request.status },
    }),
  ]);
  return c.json(updated[0]);
});

requestsRouter.get("/:id/history", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.occurredAt));
  return c.json(events);
});

import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import {
  bookingRequests,
  bookingReschedules,
  bookings,
  holds,
  requests,
  requestTrades,
  responses,
} from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import { isKnownCatalogTrade } from "../catalog";
import { findCalendarConflict, calendarConflictResponse } from "../calendar/busy";
import { monetizationEnabled, gateBookingAction } from "../monetization";
import {
  expireDueHolds,
  holdsEnabled,
  holdExpiry,
  overlappingHoldCondition,
} from "../holds";

export const bookingRouter = new Hono<AppEnv>();

// Phase 4 monetization gate (details/09: booking interface is the paid
// part). Only when the pilot flag is on: booking-flow mutations on requests
// whose partner has no active agreement are refused with an upgrade prompt,
// and every gate hit is counted as funnel evidence. Flag off → no-op.
bookingRouter.use("/requests/:id/*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  if (!monetizationEnabled(c.env)) return next();
  const db = drizzle(c.env.DB);
  const request = (
    await db.select().from(requests).where(eq(requests.id, c.req.param("id"))).limit(1)
  )[0];
  if (!request) return next(); // the route itself 404s
  const gate = await gateBookingAction(db, request, new Date());
  if (!gate.gated) return next();

  await db.batch([
    auditEventStatement(db, {
      actorUserId: c.get("user")?.id ?? null,
      actorEmail: c.get("user")?.email ?? null,
      entity: "partner",
      entityId: gate.partnerId ?? "unassigned",
      action: "pilot_gate_blocked",
      payload: { requestId: request.id, route: new URL(c.req.url).pathname },
    }),
  ]);
  return c.json(
    {
      error: "pilot_gate_required",
      message:
        "the booking interface is part of the paid pilot — listing and matching stay free; ask about a booking pilot agreement",
      partnerId: gate.partnerId,
      readOnly: true,
    },
    403,
  );
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getRequestOr404(c: Context<AppEnv>, id: string) {
  const db = drizzle(c.env.DB);
  const row = (await db.select().from(requests).where(eq(requests.id, id)).limit(1))[0];
  if (!row) {
    await c.json({ error: "not_found" }, 404);
    return null;
  }
  return row;
}

function parseRange(b: Record<string, unknown>): { startDate: string; endDate: string; workersCount: number } | string {
  const startDate = typeof b.startDate === "string" ? b.startDate : "";
  const endDate = typeof b.endDate === "string" ? b.endDate : "";
  const workersCount = typeof b.workersCount === "number" ? b.workersCount : 0;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate)
    return "invalid_date_range: need startDate <= endDate as YYYY-MM-DD";
  if (!Number.isInteger(workersCount) || workersCount < 1)
    return "workers_count_must_be_positive_integer";
  return { startDate, endDate, workersCount };
}

/**
 * Step 1 of the two-step booking flow: record the booking request
 * (`booking_requested`). Nothing is committed and the request status is
 * unchanged until the explicit confirmation.
 */
bookingRouter.post("/requests/:id/bookings/request", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = await getRequestOr404(c, id);
  if (!request) return;

  if (["booked", "cancelled", "closed"].includes(request.status)) {
    return c.json({ error: `booking_refused: request is ${request.status}` }, 409);
  }
  if (request.status !== "responded") {
    return c.json(
      { error: `booking_request_requires_responded: request is ${request.status}` },
      400,
    );
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const range = parseRange(b);
  if (typeof range === "string") return c.json({ error: range }, 400);

  const trade = typeof b.trade === "string" ? b.trade : "";
  if (!(await isKnownCatalogTrade(db, trade))) return c.json({ error: "invalid_trade" }, 400);
  const tradeRows = await db.select().from(requestTrades).where(eq(requestTrades.requestId, id));
  if (!tradeRows.some((t) => t.trade === trade)) {
    return c.json({ error: `trade_not_required: ${trade} is not in the request's trades` }, 400);
  }

  let responseId: string | null = null;
  let holdId: string | null = null;
  let companyId = "";
  if (typeof b.responseId === "string" && b.responseId) {
    const response = (
      await db.select().from(responses).where(eq(responses.id, b.responseId)).limit(1)
    )[0];
    if (!response || response.requestId !== id)
      return c.json({ error: "response_not_found_for_request" }, 400);
    if (!["interest", "quote"].includes(response.type))
      return c.json({ error: "booking_requires_interest_or_quote_response" }, 400);
    responseId = response.id;
    companyId = response.companyId;
  } else if (holdsEnabled(c.env) && typeof b.holdId === "string" && b.holdId) {
    await expireDueHolds(db);
    const hold = (await db.select().from(holds).where(eq(holds.id, b.holdId)).limit(1))[0];
    if (!hold || hold.requestId !== id || hold.state !== "active")
      return c.json({ error: "hold_not_active_for_request" }, 400);
    holdId = hold.id;
    companyId = hold.companyId;
  } else {
    return c.json({ error: "responseId_required" }, 400);
  }

  // Phase 4: the calendar is the stronger signal — declared-free capacity
  // does not override a busy provider calendar (route-layer check; the
  // declaration triggers remain the DB-level invariant).
  const conflict = await findCalendarConflict(db, companyId, range.startDate, range.endDate);
  if (conflict) return c.json(calendarConflictResponse(conflict), 409);

  const inserted = await db
    .insert(bookingRequests)
    .values({
      requestId: id,
      responseId,
      holdId,
      companyId,
      trade,
      ...range,
      state: "requested",
      requestedBy: user.id,
    })
    .returning();
  const bookingRequest = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_requested",
      payload: {
        bookingRequestId: bookingRequest.id,
        companyId,
        trade,
        startDate: range.startDate,
        endDate: range.endDate,
        workersCount: range.workersCount,
        holdId,
      },
    }),
  ]);
  return c.json(bookingRequest, 201);
});

/**
 * Step 2: explicit confirmation. Inserts the `bookings` row — the DB trigger
 * enforces first-confirmed-wins on provider capacity — flips the request to
 * `booked`, supersedes this request's active holds, and withdraws competing
 * booking requests. All in one transactional batch.
 */
bookingRouter.post("/requests/:id/bookings/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = await getRequestOr404(c, id);
  if (!request) return;

  if (request.status === "booked")
    return c.json({ error: "already_booked: first confirmed booking stands" }, 409);
  if (request.status !== "responded")
    return c.json({ error: `invalid_transition: ${request.status} cannot move to booked` }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const bookingRequestId = (body as Record<string, unknown>).bookingRequestId;
  if (typeof bookingRequestId !== "string")
    return c.json({ error: "booking_request_id_required" }, 400);

  const br = (
    await db.select().from(bookingRequests).where(eq(bookingRequests.id, bookingRequestId)).limit(1)
  )[0];
  if (!br || br.requestId !== id) return c.json({ error: "booking_request_not_found" }, 404);
  if (br.state !== "requested")
    return c.json({ error: `booking_request_is_${br.state}` }, 400);

  // Phase 4: confirm-time calendar re-check bounds the staleness window.
  const confirmConflict = await findCalendarConflict(db, br.companyId, br.startDate, br.endDate);
  if (confirmConflict) return c.json(calendarConflictResponse(confirmConflict), 409);

  const now = new Date().toISOString();
  const batch: unknown[] = [
    db.insert(bookings).values({
      requestId: id,
      responseId: br.responseId!,
      companyId: br.companyId,
      trade: br.trade,
      startDate: br.startDate,
      endDate: br.endDate,
      workersCount: br.workersCount,
      createdBy: user.id,
    }),
    db
      .update(bookingRequests)
      .set({ state: "confirmed", confirmedBy: user.id, updatedAt: now })
      .where(eq(bookingRequests.id, br.id)),
    db
      .update(bookingRequests)
      .set({ state: "withdrawn", updatedAt: now })
      .where(
        and(
          eq(bookingRequests.requestId, id),
          eq(bookingRequests.state, "requested"),
        ),
      ),
    db
      .update(requests)
      .set({ status: "booked", updatedAt: now })
      .where(eq(requests.id, id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_confirmed",
      payload: {
        bookingRequestId: br.id,
        companyId: br.companyId,
        trade: br.trade,
        startDate: br.startDate,
        endDate: br.endDate,
        workersCount: br.workersCount,
      },
    }),
  ];

  // Supersede this request's active holds (confirmation beats a hold).
  const activeHolds = await db
    .select()
    .from(holds)
    .where(and(eq(holds.requestId, id), eq(holds.state, "active")));
  for (const h of activeHolds) {
    batch.push(
      db.update(holds).set({ state: "superseded", updatedAt: now }).where(eq(holds.id, h.id)),
    );
  }

  try {
    await db.batch(batch as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (e) {
    if (String(e).includes("capacity_conflict")) {
      const winners = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.companyId, br.companyId),
            eq(bookings.trade, br.trade),
          ),
        );
      const winner = winners.find(
        (w) =>
          w.outcome === null &&
          w.startDate <= br.endDate &&
          w.endDate >= br.startDate,
      );
      return c.json(
        {
          error: "capacity_conflict",
          message: "provider capacity already committed for overlapping dates",
          winner: winner
            ? { bookingId: winner.id, requestId: winner.requestId, startDate: winner.startDate, endDate: winner.endDate }
            : null,
        },
        409,
      );
    }
    throw e;
  }

  const booking = (
    await db.select().from(bookings).where(eq(bookings.requestId, id)).limit(1)
  )[0]!;
  return c.json({ booking, bookingRequestId: br.id }, 201);
});

/**
 * Work start: booked requests record `work_started` without a status change.
 */
bookingRouter.post("/requests/:id/work-start", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = await getRequestOr404(c, id);
  if (!request) return;
  if (request.status !== "booked")
    return c.json({ error: "work_start_requires_booked_request" }, 400);

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "work_started",
      payload: { at: new Date().toISOString() },
    }),
  ]);
  return c.json({ ok: true });
});

/**
 * 48-hour holds — feature-flagged (BOOKING_HOLDS_ENABLED), advisory only.
 */
bookingRouter.post("/requests/:id/holds", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  if (!holdsEnabled(c.env))
    return c.json({ error: "holds_disabled: BOOKING_HOLDS_ENABLED is off" }, 403);

  const request = await getRequestOr404(c, id);
  if (!request) return;
  if (["booked", "cancelled", "closed"].includes(request.status))
    return c.json({ error: `hold_refused: request is ${request.status}` }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const range = parseRange(b);
  if (typeof range === "string") return c.json({ error: range }, 400);
  const trade = typeof b.trade === "string" ? b.trade : "";
  if (!(await isKnownCatalogTrade(db, trade))) return c.json({ error: "invalid_trade" }, 400);
  const companyId = typeof b.companyId === "string" ? b.companyId : "";
  if (!companyId) return c.json({ error: "company_id_required" }, 400);
  const tradeRows = await db.select().from(requestTrades).where(eq(requestTrades.requestId, id));
  if (!tradeRows.some((t) => t.trade === trade))
    return c.json({ error: `trade_not_required: ${trade} is not in the request's trades` }, 400);

  await expireDueHolds(db);
  const conflicts = await db
    .select()
    .from(holds)
    .where(overlappingHoldCondition(companyId, trade, range.startDate, range.endDate));
  if (conflicts.length > 0)
    return c.json(
      { error: "hold_conflict", holdId: conflicts[0]!.id },
      409,
    );

  const inserted = await db
    .insert(holds)
    .values({
      requestId: id,
      companyId,
      trade,
      ...range,
      state: "active",
      expiresAt: holdExpiry(),
      createdBy: user.id,
    })
    .returning();
  const hold = inserted[0]!;
  return c.json(hold, 201);
});

bookingRouter.get("/requests/:id/holds", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  await expireDueHolds(db);
  const rows = await db.select().from(holds).where(eq(holds.requestId, id));
  return c.json(rows);
});

bookingRouter.post("/holds/:id/release", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  if (!holdsEnabled(c.env))
    return c.json({ error: "holds_disabled: BOOKING_HOLDS_ENABLED is off" }, 403);

  const hold = (await db.select().from(holds).where(eq(holds.id, id)).limit(1))[0];
  if (!hold) return c.json({ error: "not_found" }, 404);
  if (hold.state !== "active")
    return c.json({ error: `hold_is_${hold.state}` }, 400);

  const body = await c.req.json().catch(() => ({}));
  const reason =
    typeof (body as Record<string, unknown>).reason === "string"
      ? ((body as Record<string, unknown>).reason as string)
      : null;
  const updated = await db
    .update(holds)
    .set({ state: "released", releasedReason: reason, updatedAt: new Date().toISOString() })
    .where(eq(holds.id, id))
    .returning();
  return c.json(updated[0]);
});

/**
 * Phase 3: reschedule a confirmed booking — propose, then confirm or reject.
 * Confirming updates the booking row; the BEFORE UPDATE capacity trigger
 * enforces first-confirmed-wins for the new window (same `capacity_conflict`
 * as insertion). Proposal history is retained.
 */
bookingRouter.post("/requests/:id/bookings/reschedule", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = await getRequestOr404(c, id);
  if (!request) return;
  if (request.status !== "booked")
    return c.json({ error: "reschedule_requires_booked_request" }, 400);

  const booking = (
    await db.select().from(bookings).where(eq(bookings.requestId, id)).limit(1)
  )[0];
  if (!booking || booking.outcome)
    return c.json({ error: "no_live_booking_for_request" }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const range = parseRange(b);
  if (typeof range === "string") return c.json({ error: range }, 400);

  const open = (
    await db
      .select()
      .from(bookingReschedules)
      .where(and(eq(bookingReschedules.bookingId, booking.id), eq(bookingReschedules.state, "proposed")))
      .limit(1)
  )[0];
  if (open)
    return c.json({ error: "proposal_already_open", proposalId: open.id }, 409);

  const inserted = await db
    .insert(bookingReschedules)
    .values({
      bookingId: booking.id,
      ...range,
      reason: typeof b.reason === "string" ? b.reason : null,
      proposedBy: user.id,
    })
    .returning();
  const proposal = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_rescheduled",
      payload: {
        proposalId: proposal.id,
        bookingId: booking.id,
        state: "proposed",
        startDate: range.startDate,
        endDate: range.endDate,
        workersCount: range.workersCount,
        reason: proposal.reason,
      },
    }),
  ]);
  return c.json(proposal, 201);
});

async function getProposalContext(c: Context<AppEnv>, requestId: string, proposalId: string) {
  const db = drizzle(c.env.DB);
  const proposal = (
    await db.select().from(bookingReschedules).where(eq(bookingReschedules.id, proposalId)).limit(1)
  )[0];
  if (!proposal) {
    await c.json({ error: "not_found" }, 404);
    return null;
  }
  const booking = (
    await db.select().from(bookings).where(eq(bookings.id, proposal.bookingId)).limit(1)
  )[0];
  if (!booking || booking.requestId !== requestId) {
    await c.json({ error: "not_found" }, 404);
    return null;
  }
  return { db, proposal, booking };
}

bookingRouter.post("/requests/:id/bookings/reschedule/:proposalId/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  const request = await getRequestOr404(c, id);
  if (!request) return;

  const ctx = await getProposalContext(c, id, proposalId);
  if (!ctx) return;
  const { proposal, booking } = ctx;
  if (proposal.state !== "proposed")
    return c.json({ error: `proposal_is_${proposal.state}` }, 400);
  if (booking.outcome) return c.json({ error: "booking_no_longer_live" }, 400);

  // Phase 4: the new window must respect the provider's calendar too.
  const rescheduleConflict = await findCalendarConflict(
    db,
    booking.companyId,
    proposal.startDate,
    proposal.endDate,
  );
  if (rescheduleConflict) return c.json(calendarConflictResponse(rescheduleConflict), 409);

  const now = new Date().toISOString();
  const batch: unknown[] = [
    db
      .update(bookingReschedules)
      .set({ state: "confirmed", resolvedBy: user.id, updatedAt: now })
      .where(eq(bookingReschedules.id, proposal.id)),
    db
      .update(bookings)
      .set({
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        workersCount: proposal.workersCount,
      })
      .where(eq(bookings.id, booking.id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_rescheduled",
      payload: {
        proposalId: proposal.id,
        bookingId: booking.id,
        state: "confirmed",
        from: {
          startDate: booking.startDate,
          endDate: booking.endDate,
          workersCount: booking.workersCount,
        },
        to: {
          startDate: proposal.startDate,
          endDate: proposal.endDate,
          workersCount: proposal.workersCount,
        },
      },
    }),
  ];
  try {
    await db.batch(batch as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (e) {
    if (String(e).includes("capacity_conflict")) {
      const winners = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.companyId, booking.companyId), eq(bookings.trade, booking.trade)));
      const winner = winners.find(
        (w) =>
          w.id !== booking.id &&
          w.outcome === null &&
          w.startDate <= proposal.endDate &&
          w.endDate >= proposal.startDate,
      );
      return c.json(
        {
          error: "capacity_conflict",
          message: "provider capacity already committed for the requested window",
          winner: winner
            ? { bookingId: winner.id, requestId: winner.requestId, startDate: winner.startDate, endDate: winner.endDate }
            : null,
        },
        409,
      );
    }
    throw e;
  }

  const updated = (await db.select().from(bookings).where(eq(bookings.id, booking.id)).limit(1))[0]!;
  return c.json({ booking: updated, proposalId: proposal.id }, 200);
});

bookingRouter.post("/requests/:id/bookings/reschedule/:proposalId/reject", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const proposalId = c.req.param("proposalId");
  const request = await getRequestOr404(c, id);
  if (!request) return;

  const ctx = await getProposalContext(c, id, proposalId);
  if (!ctx) return;
  const { proposal } = ctx;
  if (proposal.state !== "proposed")
    return c.json({ error: `proposal_is_${proposal.state}` }, 400);

  const now = new Date().toISOString();
  await db.batch([
    db
      .update(bookingReschedules)
      .set({ state: "rejected", resolvedBy: user.id, updatedAt: now })
      .where(eq(bookingReschedules.id, proposal.id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_rescheduled",
      payload: { proposalId: proposal.id, state: "rejected" },
    }),
  ]);
  return c.json({ ok: true, proposalId: proposal.id, state: "rejected" });
});

/**
 * Phase 3: booking-level cancellation with mandatory attribution. Distinct
 * from request cancellation: the booking is marked cancelled with who and
 * why, and the parent request returns to `responded` so it can be re-booked.
 */
bookingRouter.post("/requests/:id/bookings/cancel", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const id = c.req.param("id");
  const request = await getRequestOr404(c, id);
  if (!request) return;
  if (request.status !== "booked")
    return c.json({ error: "booking_cancel_requires_booked_request" }, 400);

  const booking = (
    await db.select().from(bookings).where(eq(bookings.requestId, id)).limit(1)
  )[0];
  if (!booking || booking.outcome)
    return c.json({ error: "no_live_booking_for_request" }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;
  const cancelledBy = typeof b.cancelledBy === "string" ? b.cancelledBy : "";
  if (!["customer", "provider"].includes(cancelledBy))
    return c.json({ error: "attribution_required: cancelledBy must be customer or provider" }, 400);
  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : "";
  if (!reason) return c.json({ error: "reason_required" }, 400);

  const now = new Date().toISOString();
  await db.batch([
    db
      .update(bookings)
      .set({
        outcome: "cancelled",
        outcomeReason: reason,
        outcomeAt: now,
        cancelledBy,
        cancelReason: reason,
        cancelledAt: now,
      })
      .where(eq(bookings.id, booking.id)),
    db
      .update(requests)
      .set({ status: "responded", updatedAt: now })
      .where(eq(requests.id, id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "request",
      entityId: id,
      action: "booking_cancelled",
      payload: {
        bookingId: booking.id,
        companyId: booking.companyId,
        cancelledBy,
        reason,
      },
    }),
  ]);
  const updated = (await db.select().from(bookings).where(eq(bookings.id, booking.id)).limit(1))[0]!;
  return c.json({ booking: updated, requestStatus: "responded" }, 200);
});

import { Hono } from "hono";
import { desc, eq, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { bookingReviews, bookings, companies } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";

export const reviewsRouter = new Hono<AppEnv>();

/**
 * Phase 4: reviews tied to genuine platform transactions (details/05). A
 * review exists only for a booking whose outcome is a confirmed completion,
 * at most one per booking (unique index), author recorded, disputes hide the
 * review from display and metrics until restored. Reviews are never
 * presented as proof of technical competence or legal compliance.
 */

function reviewMessage(error: string) {
  return { error };
}

reviewsRouter.post("/bookings/:bookingId/review", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const bookingId = c.req.param("bookingId");
  const booking = (
    await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
  if (!booking) return c.json(reviewMessage("not_found"), 404);
  if (booking.outcome !== "completion_confirmed")
    return c.json(
      reviewMessage("review_requires_completion_confirmed: reviews exist only for completed bookings"),
      400,
    );

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json(reviewMessage("invalid_json"), 400);
  const b = body as Record<string, unknown>;
  const rating = typeof b.rating === "number" ? b.rating : 0;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return c.json(reviewMessage("rating_must_be_1_to_5"), 400);
  const comment = typeof b.comment === "string" && b.comment.trim() ? b.comment.trim() : null;

  const existing = (
    await db.select().from(bookingReviews).where(eq(bookingReviews.bookingId, bookingId)).limit(1)
  )[0];
  if (existing) return c.json(reviewMessage("already_reviewed: one review per booking"), 409);

  const inserted = await db
    .insert(bookingReviews)
    .values({
      bookingId,
      companyId: booking.companyId,
      rating,
      comment,
      createdBy: user.id,
    })
    .returning();
  const review = inserted[0]!;

  await db.batch([
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "booking_review",
      entityId: review.id,
      action: "review_submitted",
      payload: { bookingId, companyId: booking.companyId, rating },
    }),
  ]);
  return c.json(review, 201);
});

async function getReviewContext(c: any, bookingId: string) {
  const db = drizzle(c.env.DB);
  const review = (
    await db.select().from(bookingReviews).where(eq(bookingReviews.bookingId, bookingId)).limit(1)
  )[0];
  if (!review) {
    await c.json(reviewMessage("not_found"), 404);
    return null;
  }
  return { db, review };
}

reviewsRouter.post("/bookings/:bookingId/review/dispute", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const bookingId = c.req.param("bookingId");
  const ctx = await getReviewContext(c, bookingId);
  if (!ctx) return;
  const { review } = ctx;
  if (review.disputedAt) return c.json(reviewMessage("already_disputed"), 409);

  const body = await c.req.json().catch(() => null);
  const reason = typeof (body as Record<string, unknown>)?.reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return c.json(reviewMessage("reason_required"), 400);

  const now = new Date().toISOString();
  await db.batch([
    db
      .update(bookingReviews)
      .set({ disputedAt: now, disputeReason: reason, disputedBy: user.id, updatedAt: now })
      .where(eq(bookingReviews.id, review.id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "booking_review",
      entityId: review.id,
      action: "review_disputed",
      payload: { bookingId, reason },
    }),
  ]);
  return c.json({ ok: true, reviewId: review.id, state: "disputed" });
});

reviewsRouter.post("/bookings/:bookingId/review/restore", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const bookingId = c.req.param("bookingId");
  const ctx = await getReviewContext(c, bookingId);
  if (!ctx) return;
  const { review } = ctx;
  if (!review.disputedAt) return c.json(reviewMessage("not_disputed"), 400);

  const now = new Date().toISOString();
  await db.batch([
    db
      .update(bookingReviews)
      .set({ disputedAt: null, disputeReason: null, disputedBy: null, updatedAt: now })
      .where(eq(bookingReviews.id, review.id)),
    auditEventStatement(db, {
      actorUserId: user.id,
      actorEmail: user.email,
      entity: "booking_review",
      entityId: review.id,
      action: "review_restored",
      payload: { bookingId, previousReason: review.disputeReason },
    }),
  ]);
  return c.json({ ok: true, reviewId: review.id, state: "restored" });
});

/** Provider-facing review list — undisputed reviews only (disputes are
 * hidden from display while pending). */
reviewsRouter.get("/providers/:id/reviews", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return c.json(reviewMessage("not_found"), 404);
  const rows = await db
    .select()
    .from(bookingReviews)
    .where(and(eq(bookingReviews.companyId, id), isNull(bookingReviews.disputedAt)))
    .orderBy(desc(bookingReviews.createdAt));
  return c.json({ reviews: rows });
});

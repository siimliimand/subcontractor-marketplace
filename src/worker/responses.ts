import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { companies, requests, responses } from "./db/schema";
import { auditEventStatement, type EventChannel } from "./events";
import type { ResponseType } from "./config";

export type ResponseActor = { actorUserId: string | null; actorEmail: string | null };

export type CoreResponseParams = {
  requestId: string;
  companyId: string;
  type: ResponseType;
  workersCount: number | null;
  availableFrom: string | null;
  reason: string | null;
  actor: ResponseActor;
  channel: EventChannel;
};

export type RecordResponseResult =
  | {
      ok: true;
      statements: unknown[];
      responseId: string;
      requestId: string;
      requestStatusBefore: string;
    }
  | { ok: false; error: string };

/**
 * Shared response-recording core: mirrors the manual route's rules (closed request,
 * duplicate company response) and builds the statements (insert + status transition +
 * audit events) as one D1 batch. Callers may append additional statements
 * (e.g. token redemption) before executing.
 */
export async function buildRecordResponse(
  db: DrizzleD1Database,
  params: CoreResponseParams,
): Promise<RecordResponseResult> {
  const request = (
    await db.select().from(requests).where(eq(requests.id, params.requestId)).limit(1)
  )[0];
  if (!request) return { ok: false, error: "request_not_found" };
  if (["booked", "cancelled", "closed"].includes(request.status))
    return { ok: false, error: `request_is_${request.status}` };

  const provider = (
    await db.select().from(companies).where(eq(companies.id, params.companyId)).limit(1)
  )[0];
  if (!provider) return { ok: false, error: "provider_not_found" };

  const existing = (
    await db
      .select()
      .from(responses)
      .where(and(eq(responses.requestId, params.requestId), eq(responses.companyId, params.companyId)))
      .limit(1)
  )[0];
  if (existing) return { ok: false, error: "duplicate_response" };

  const { actorEmail, actorUserId } = params.actor;
  const auditBase = {
    actorUserId,
    actorEmail,
    channel: params.channel,
  };

  const responseId = crypto.randomUUID();
  const statements: unknown[] = [
    db.insert(responses).values({
      id: responseId,
      requestId: params.requestId,
      companyId: params.companyId,
      type: params.type,
      workersCount: params.workersCount,
      availableFrom: params.availableFrom,
      reason: params.reason,
      createdBy: actorUserId,
    }),
  ];

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (request.status === "matched" || request.status === "in_outreach") {
    patch.status = "responded";
  }
  statements.push(db.update(requests).set(patch).where(eq(requests.id, params.requestId)));

  statements.push(
    auditEventStatement(db, {
      ...auditBase,
      entity: "request",
      entityId: params.requestId,
      action: "response_received",
      payload: {
        responseId,
        companyId: params.companyId,
        type: params.type,
        provider: provider.legalName,
      },
    }),
  );
  if (params.type === "interest" || params.type === "quote") {
    statements.push(
      auditEventStatement(db, {
        ...auditBase,
        entity: "request",
        entityId: params.requestId,
        action: "qualified_response",
        payload: {
          responseId,
          companyId: params.companyId,
          workersCount: params.workersCount,
          availableFrom: params.availableFrom,
        },
      }),
    );
  }
  if (params.type === "quote") {
    statements.push(
      auditEventStatement(db, {
        ...auditBase,
        entity: "request",
        entityId: params.requestId,
        action: "quote_submitted",
        payload: { responseId, companyId: params.companyId },
      }),
    );
  }

  return {
    ok: true,
    statements,
    responseId,
    requestId: params.requestId,
    requestStatusBefore: request.status,
  };
}

/** Automated decline: when no other interest/quote responses exist, cancel with provider attribution. */
export async function buildDeclineCancellation(
  db: DrizzleD1Database,
  params: {
    requestId: string;
    reason: string | null;
    requestStatusBefore: string;
    actor: ResponseActor;
  },
): Promise<unknown[]> {
  const all = await db
    .select({ type: responses.type })
    .from(responses)
    .where(eq(responses.requestId, params.requestId));
  const hasOtherInterest = all.some((r) => ["interest", "quote"].includes(r.type));
  if (
    hasOtherInterest ||
    !["matched", "in_outreach", "responded"].includes(params.requestStatusBefore)
  ) {
    return [];
  }
  const reason = params.reason ?? "Provider declined the request";
  return [
    db
      .update(requests)
      .set({
        status: "cancelled",
        cancelledBy: "provider",
        cancelReason: reason,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(requests.id, params.requestId)),
    auditEventStatement(db, {
      actorUserId: params.actor.actorUserId,
      actorEmail: params.actor.actorEmail,
      channel: "automated",
      entity: "request",
      entityId: params.requestId,
      action: "request_cancelled",
      payload: { cancelledBy: "provider", reason, fromStatus: params.requestStatusBefore },
    }),
  ];
}

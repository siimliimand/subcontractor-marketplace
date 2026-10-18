import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditEvents } from "./db/schema";

export const EVENT_ACTIONS = [
  "request_created",
  "request_approved",
  "matched",
  "outreach_sent",
  "response_received",
  "qualified_response",
  "quote_submitted",
  "booking_confirmed",
  "completion_confirmed",
  "accepted_but_not_delivered",
  "request_cancelled",
  "provider_created",
  "provider_updated",
  "login",
  "access_denied",
] as const;

export type EventAction = (typeof EVENT_ACTIONS)[number];

export type EventChannel = "manual" | "automated";

export function isEventAction(value: string): value is EventAction {
  return (EVENT_ACTIONS as readonly string[]).includes(value);
}

export type AuditEventInput = {
  actorUserId: string;
  actorEmail: string;
  entity: string;
  entityId?: string | null;
  action: EventAction;
  payload?: unknown;
  channel?: EventChannel;
  occurredAt?: string;
};

export function buildAuditEvent(input: AuditEventInput) {
  if (!isEventAction(input.action)) {
    throw new Error(`Unknown audit event action: "${input.action}"`);
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return {
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    occurredAt,
    entity: input.entity,
    entityId: input.entityId ?? null,
    action: input.action,
    payloadJson: input.payload === undefined ? null : JSON.stringify(input.payload),
    channel: input.channel ?? "manual",
  };
}

export function auditEventStatement(db: DrizzleD1Database, input: AuditEventInput) {
  const row = buildAuditEvent(input);
  return db.insert(auditEvents).values(row);
}

export function withAuditEvents(
  db: DrizzleD1Database,
  statements: unknown[],
  events: AuditEventInput[],
): unknown[] {
  for (const event of events) {
    if (!isEventAction(event.action)) {
      throw new Error(`Unknown audit event action: "${event.action}"`);
    }
  }
  return [...statements, ...events.map((e) => auditEventStatement(db, e))];
}

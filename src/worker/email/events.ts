import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Bindings } from "../app";
import { emailSuppressions, outreachEntries } from "../db/schema";
import { auditEventStatement } from "../events";

export type EmailEventMessage = { id: string; body: unknown };

// ---------------------------------------------------------------------------
// Shared email delivery-lifecycle applier (SUBC-011).
//
// Cloudflare Email Service currently has no lifecycle-event → Queue routing,
// so the queue consumer below is dormant. Three additional producers now feed
// this same applier — the authenticated webhook (email/webhook.ts), inbound
// RFC 3464 DSN parsing (email/inbound.ts), and the stale-sent resolution
// sweep (email/resolve.ts). The applier is idempotent and transition-guarded:
//
//   delivered: only from 'sent'            (never downgrades 'opened')
//   opened:    from 'sent' | 'delivered'   (never downgrades 'bounced')
//   bounced:   from 'sent' | 'delivered' | 'opened'  (bounce always wins,
//              suppresses the address)
//
// 'skipped' and 'bounced' are terminal and never overwritten. Guards live in
// both the match query and the UPDATE where-clause so concurrent producers
// (queue at-least-once, webhook replay, sweep re-run) settle each transition
// exactly once: one audit event, one suppression row, one status change.
// ---------------------------------------------------------------------------

export type EmailLifecycleKind = "delivered" | "opened" | "bounced";

export type EmailLifecycleSource = "queue" | "webhook" | "inbound" | "resolution";

export type EmailLifecycleEvent = {
  kind: EmailLifecycleKind;
  to: string;
  sendId?: unknown;
  permanent?: unknown;
  source: EmailLifecycleSource;
};

/** States a transition may legally start from (the transition matrix). */
const SOURCE_STATES: Record<EmailLifecycleKind, readonly string[]> = {
  delivered: ["sent"],
  opened: ["sent", "delivered"],
  bounced: ["sent", "delivered", "opened"],
};

export type LifecycleBody = {
  type: string;
  to: string;
  sendId?: unknown;
  permanent?: unknown;
};

type TargetEntry = { id: string; requestId: string; companyId: string };

/** Tolerant parse of a lifecycle event body: object or JSON-encoded string. */
export function parseBody(raw: unknown): LifecycleBody | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["type"] !== "string" || typeof record["to"] !== "string") return null;
  return {
    type: record["type"],
    to: record["to"],
    sendId: record["sendId"],
    permanent: record["permanent"],
  };
}

/** Maps a provider-ish event type (message.delivered, …) onto the lifecycle kind. */
export function classifyLifecycleType(type: string): EmailLifecycleKind | null {
  if (type.includes("bounced")) return "bounced";
  if (type.includes("delivered")) return "delivered";
  if (type.includes("opened")) return "opened";
  return null;
}

async function findTargetEntry(
  db: DrizzleD1Database,
  to: string,
  allowedStates: readonly string[],
): Promise<TargetEntry | null> {
  const rows = await db.all<TargetEntry>(sql`
    SELECT e.id AS id, e.requestId AS requestId, e.companyId AS companyId
    FROM outreach_entries e
    JOIN companies c ON c.id = e.companyId
    WHERE c.contactEmail = ${to} AND e.channel = 'email'
      AND e.emailStatus IN (${sql.join(
        allowedStates.map((s) => sql`${s}`),
        sql`, `,
      )})
    ORDER BY e.sentAt DESC
    LIMIT 1
  `);
  return (rows as unknown as TargetEntry[])[0] ?? null;
}

/**
 * Applies one lifecycle event: match the recipient's most recent eligible
 * email-channel entry, transition it under the guard matrix, and record the
 * audit event (+ suppression row for bounces). Returns true when a transition
 * happened; unmatched recipients and already-settled entries are silent
 * no-ops (never throw, never duplicate events).
 */
export async function applyEmailLifecycleEvent(
  db: DrizzleD1Database,
  event: EmailLifecycleEvent,
): Promise<boolean> {
  const allowed = SOURCE_STATES[event.kind];
  const entry = await findTargetEntry(db, event.to, allowed);
  if (!entry) return false;
  const sendId = typeof event.sendId === "string" ? event.sendId : null;

  // Guarded transition: the UPDATE only matches while the entry is still in a
  // legal source state, so a concurrent duplicate settles nothing and audits
  // nothing (the RETURNING result gates every side effect below).
  const transitioned = await db
    .update(outreachEntries)
    .set({ emailStatus: event.kind })
    .where(
      and(
        eq(outreachEntries.id, entry.id),
        inArray(outreachEntries.emailStatus, [...allowed]),
      ),
    )
    .returning({ id: outreachEntries.id });
  if (transitioned.length === 0) return false;

  if (event.kind === "bounced") {
    const permanent = event.permanent ?? true;
    await db.batch([
      db
        .insert(emailSuppressions)
        .values({
          email: event.to,
          reason: permanent ? "hard_bounce" : "soft_bounce",
        })
        .onConflictDoNothing(),
      auditEventStatement(db, {
        actorUserId: null,
        actorEmail: null,
        entity: "outreach_entry",
        entityId: entry.id,
        action: "email_bounced",
        channel: "automated",
        payload: {
          requestId: entry.requestId,
          companyId: entry.companyId,
          to: event.to,
          sendId,
          permanent,
          source: event.source,
        },
      }),
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return true;
  }

  await db.batch([
    auditEventStatement(db, {
      actorUserId: null,
      actorEmail: null,
      entity: "outreach_entry",
      entityId: entry.id,
      action: event.kind === "delivered" ? "email_delivered" : "email_opened",
      channel: "automated",
      payload: {
        requestId: entry.requestId,
        companyId: entry.companyId,
        to: event.to,
        sendId,
        source: event.source,
      },
    }),
  ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return true;
}

/**
 * Queue consumer for Email Service lifecycle events (dormant producer — kept
 * wired for the moment Cloudflare ships lifecycle-event → Queue routing).
 * Messages are processed sequentially; a malformed or unmatched message is
 * skipped without throwing so one bad message never blocks the rest of the
 * batch (no retries).
 */
export async function handleEmailEventBatch(
  env: Bindings,
  messages: EmailEventMessage[],
): Promise<void> {
  const db = drizzle(env.DB);
  for (const message of messages) {
    try {
      const body = parseBody(message.body);
      if (!body) continue;
      const kind = classifyLifecycleType(body.type);
      if (!kind) continue;
      await applyEmailLifecycleEvent(db, {
        kind,
        to: body.to,
        sendId: body.sendId,
        permanent: body.permanent,
        source: "queue",
      });
    } catch {
      // Swallow: delivery lifecycle signals are additive and never blocking.
    }
  }
}

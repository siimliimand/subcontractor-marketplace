import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { eq, sql } from "drizzle-orm";
import type { Bindings } from "../app";
import { emailSuppressions, outreachEntries } from "../db/schema";
import { auditEventStatement } from "../events";

export type EmailEventMessage = { id: string; body: unknown };

type LifecycleBody = {
  type: string;
  to: string;
  sendId?: unknown;
  permanent?: unknown;
};

type TargetEntry = { id: string; requestId: string; companyId: string };

function parseBody(raw: unknown): LifecycleBody | null {
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

async function findTargetEntry(
  db: DrizzleD1Database,
  to: string,
): Promise<TargetEntry | null> {
  const rows = await db.all<TargetEntry>(sql`
    SELECT e.id AS id, e.requestId AS requestId, e.companyId AS companyId
    FROM outreach_entries e
    JOIN companies c ON c.id = e.companyId
    WHERE c.contactEmail = ${to} AND e.channel = 'email'
      AND e.emailStatus IN ('sent', 'opened')
    ORDER BY e.sentAt DESC
    LIMIT 1
  `);
  return (rows as unknown as TargetEntry[])[0] ?? null;
}

async function processMessage(db: DrizzleD1Database, message: EmailEventMessage): Promise<void> {
  const body = parseBody(message.body);
  if (!body) return;
  const isDelivery = body.type.includes("delivered");
  const isBounce = body.type.includes("bounced");
  if (!isDelivery && !isBounce) return;

  const entry = await findTargetEntry(db, body.to);
  if (!entry) return;
  const sendId = typeof body.sendId === "string" ? body.sendId : null;

  if (isDelivery) {
    await db.batch([
      db
        .update(outreachEntries)
        .set({ emailStatus: "delivered" })
        .where(eq(outreachEntries.id, entry.id)),
      auditEventStatement(db, {
        actorUserId: null,
        actorEmail: null,
        entity: "outreach_entry",
        entityId: entry.id,
        action: "email_delivered",
        channel: "automated",
        payload: { requestId: entry.requestId, companyId: entry.companyId, to: body.to, sendId },
      }),
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return;
  }

  const permanent = body.permanent ?? true;
  await db.batch([
    db
      .update(outreachEntries)
      .set({ emailStatus: "bounced" })
      .where(eq(outreachEntries.id, entry.id)),
    db
      .insert(emailSuppressions)
      .values({
        email: body.to,
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
        to: body.to,
        sendId,
        permanent,
      },
    }),
  ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/**
 * Queue consumer for Email Service lifecycle events. Messages are processed
 * sequentially; a malformed or unmatched message is skipped without throwing
 * so one bad message never blocks the rest of the batch (no retries).
 */
export async function handleEmailEventBatch(
  env: Bindings,
  messages: EmailEventMessage[],
): Promise<void> {
  const db = drizzle(env.DB);
  for (const message of messages) {
    try {
      await processMessage(db, message);
    } catch {
      // Swallow: delivery lifecycle signals are additive and never blocking.
    }
  }
}

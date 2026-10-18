import { eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import {
  companies,
  emailSuppressions,
  emailTokens,
  outreachEntries,
  requests,
} from "../db/schema";
import type { Bindings } from "../app";
import { auditEventStatement } from "../events";
import { composeOutreachEmail } from "./composer";
import { signToken, tokenTtlSeconds } from "./tokens";

export type EmailSendOutcome = {
  sent: { companyId: string }[];
  skipped: { companyId: string; reason: string }[];
};

export class DailyLimitError extends Error {
  constructor(public limit: number, public sentToday: number) {
    super(`daily_email_limit_reached: ${sentToday}/${limit} emails already sent today`);
  }
}

function utcDayStartIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export async function countEmailsSentToday(db: ReturnType<typeof drizzle>): Promise<number> {
  const result = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'email_sent' AND occurredAt >= ${utcDayStartIso()}`,
  );
  return Number((result as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

export async function sendOutreachEmailBatch(
  env: Bindings,
  params: { requestId: string; providerIds: string[]; staffUserId: string; staffEmail: string; appBaseUrl?: string },
): Promise<EmailSendOutcome> {
  const db = drizzle(env.DB);
  const limit = Number(env.EMAIL_DAILY_LIMIT ?? 50);
  const sentToday = await countEmailsSentToday(db);
  if (Number.isFinite(limit) && limit > 0 && sentToday >= limit) {
    throw new DailyLimitError(limit, sentToday);
  }

  const request = (
    await db.select().from(requests).where(eq(requests.id, params.requestId)).limit(1)
  )[0];
  if (!request) throw new Error("request_not_found");
  if (["booked", "cancelled", "closed"].includes(request.status)) {
    throw new Error(`request_is_${request.status}`);
  }

  const providers = await db
    .select()
    .from(companies)
    .where(inArray(companies.id, params.providerIds));

  const existingEntries = await db
    .select({ companyId: outreachEntries.companyId, batchNumber: outreachEntries.batchNumber })
    .from(outreachEntries)
    .where(eq(outreachEntries.requestId, params.requestId));
  const existingByCompany = new Map(existingEntries.map((e) => [e.companyId, e.batchNumber]));

  const suppressed = await db
    .select()
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.email, providers.map((p) => p.contactEmail)));
  const suppressedSet = new Set(suppressed.map((s) => s.email));

  const base = params.appBaseUrl ?? "";
  const outcome: EmailSendOutcome = { sent: [], skipped: [] };
  const pendingStatements: unknown[] = [];

  for (const companyId of params.providerIds) {
    const provider = providers.find((p) => p.id === companyId);
    if (!provider) {
      outcome.skipped.push({ companyId, reason: "provider_not_found" });
      continue;
    }
    if (provider.status === "opted_out") {
      outcome.skipped.push({
        companyId,
        reason: `provider_opted_out${provider.statusReason ? `: ${provider.statusReason}` : ""}`,
      });
      continue;
    }
    if (existingByCompany.has(companyId)) {
      outcome.skipped.push({
        companyId,
        reason: `duplicate_outreach: already contacted in batch ${existingByCompany.get(companyId)}`,
      });
      continue;
    }
    if (suppressedSet.has(provider.contactEmail)) {
      outcome.skipped.push({ companyId, reason: "email_suppressed" });
      // Spec (email-outreach): the entry is marked skipped with reason and the
      // batch is still recorded, so the cockpit can see why no email left.
      pendingStatements.push(
        db.insert(outreachEntries).values({
          id: crypto.randomUUID(),
          requestId: params.requestId,
          companyId,
          batchNumber: `E-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
          contactedBy: params.staffUserId,
          channel: "email",
          emailStatus: "skipped",
          emailSkippedReason: "email_suppressed",
          sentAt: new Date().toISOString(),
        }),
      );
      continue;
    }
    if (sentToday + outcome.sent.length >= limit) {
      outcome.skipped.push({ companyId, reason: `daily_limit_reached: ${limit}/day` });
      continue;
    }

    const entryId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + tokenTtlSeconds(env) * 1_000,
    ).toISOString();

    const tokens = await Promise.all(
      (["accept", "quote", "decline", "track"] as const).map(async (purpose) => {
        const jti = crypto.randomUUID();
        const token = await signToken({ jti, outreachEntryId: entryId, purpose }, env.EMAIL_TOKEN_SECRET!, expiresAt);
        return { purpose, jti, token };
      }),
    );
    const byPurpose = Object.fromEntries(tokens.map((t) => [t.purpose, t.token]));
    const email = composeOutreachEmail({
      request,
      providerName: provider.legalName,
      links: {
        accept: `${base}/e/${byPurpose.accept}`,
        quote: `${base}/e/${byPurpose.quote}`,
        decline: `${base}/e/${byPurpose.decline}`,
      },
      pixelUrl: `${base}/t/${byPurpose.track}.gif`,
      from: env.EMAIL_FROM ?? "Subcrew <outreach@subcrew.example>",
      replyTo: env.EMAIL_REPLY_TO,
    });

    try {
      await env.SEND_EMAIL!.send({
        from: email.from,
        to: provider.contactEmail,
        subject: email.subject,
        text: email.text,
      });
    } catch (err) {
      outcome.skipped.push({
        companyId,
        reason: `email_send_failed: ${err instanceof Error ? err.message.split("\n")[0] : "unknown"}`,
      });
      continue;
    }

    pendingStatements.push(
      db.insert(outreachEntries).values({
        id: entryId,
        requestId: params.requestId,
        companyId,
        batchNumber: `E-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
        contactedBy: params.staffUserId,
        channel: "email",
        emailStatus: "sent",
        sentAt: new Date().toISOString(),
      }),
    );
    for (const t of tokens) {
      pendingStatements.push(
        db.insert(emailTokens).values({
          jti: t.jti,
          outreachEntryId: entryId,
          purpose: t.purpose,
          expiresAt,
        }),
      );
    }
    pendingStatements.push(
      auditEventStatement(db, {
        actorUserId: params.staffUserId,
        actorEmail: params.staffEmail,
        entity: "outreach_entry",
        entityId: entryId,
        action: "email_sent",
        channel: "automated",
        payload: {
          requestId: params.requestId,
          companyId,
          to: provider.contactEmail,
          subject: email.subject,
        },
      }),
    );
    pendingStatements.push(
      auditEventStatement(db, {
        actorUserId: params.staffUserId,
        actorEmail: params.staffEmail,
        entity: "request",
        entityId: params.requestId,
        action: "outreach_sent",
        channel: "automated",
        payload: { companyId, channel: "email" },
      }),
    );
    outcome.sent.push({ companyId });
  }

  if (pendingStatements.length > 0) {
    await db.batch(pendingStatements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return outcome;
}

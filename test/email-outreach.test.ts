import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub, stubSendEnv } from "./helpers/email";
import { DailyLimitError, sendOutreachEmailBatch } from "../src/worker/email/sender";
import {
  auditEvents,
  companies,
  emailSuppressions,
  emailTokens,
  outreachEntries,
  requests,
  users,
} from "../src/worker/db/schema";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  await db().delete(auditEvents);
  await db().delete(emailTokens);
  await db().delete(emailSuppressions);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(companies);
});

async function setupRequestInMatched(providerCount = 1) {
  const providerIds: string[] = [];
  for (let i = 0; i < providerCount; i++) {
    const res = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: `Provider ${i}`,
        registrationIdentifier: `reg-${Date.now()}-${i}-${Math.random()}`,
        contactEmail: `p${i}-${Date.now()}@example.com`,
      }),
    });
    providerIds.push(((await res.json()) as { id: string }).id);
  }
  const reqRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Bathroom plumbing",
      description: "Install pipework",
      location: "Tartu",
      trade: "plumbing",
      startDate: "2026-11-10",
      crewSize: 2,
    }),
  });
  const request = (await reqRes.json()) as { id: string };
  for (const to of ["approved", "matched"]) {
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to }),
    });
  }
  return { requestId: request.id, providerIds };
}

describe("email outreach send", () => {
  it("sends a batch: entry sent, 4 future tokens, email_sent + outreach_sent audit events", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    const { outcome, sent } = await sendOutreachWithStub({
      requestId,
      providerIds: [providerIds[0]!],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(
      (await db().select().from(companies).where(eq(companies.id, providerIds[0]!)))[0]!
        .contactEmail,
    );
    expect(sent[0]!.from).toBe("Subcrew Test <outreach@test.example>");
    expect(outcome.skipped).toHaveLength(0);

    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    expect(entry.companyId).toBe(providerIds[0]);
    expect(entry.channel).toBe("email");
    expect(entry.emailStatus).toBe("sent");

    const tokens = await db()
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, entry.id));
    expect(tokens).toHaveLength(4);
    expect(new Set(tokens.map((t) => t.purpose))).toEqual(
      new Set(["accept", "quote", "decline", "track"]),
    );
    const now = Date.now();
    for (const t of tokens) {
      expect(t.usedAt).toBeNull();
      expect(new Date(t.expiresAt).getTime()).toBeGreaterThan(now);
    }

    const sentEvents = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_sent"));
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]!.entity).toBe("outreach_entry");
    expect(sentEvents[0]!.entityId).toBe(entry.id);
    expect(sentEvents[0]!.channel).toBe("automated");

    const outreachEvents = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "outreach_sent"));
    expect(outreachEvents).toHaveLength(1);
    expect(outreachEvents[0]!.entity).toBe("request");
    expect(outreachEvents[0]!.entityId).toBe(requestId);
    expect(outreachEvents[0]!.channel).toBe("automated");
  });

  it("skips a second email to the same provider, naming the existing batch", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    await sendOutreachWithStub({
      requestId,
      providerIds: [providerIds[0]!],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });
    const eventsBefore = (
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_sent"))
    ).length;

    const { outcome, sent } = await sendOutreachWithStub({
      requestId,
      providerIds: [providerIds[0]!],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    expect(sent).toHaveLength(0);
    expect(outcome.sent).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]!.companyId).toBe(providerIds[0]);
    expect(outcome.skipped[0]!.reason).toContain("duplicate_outreach");
    expect(outcome.skipped[0]!.reason).toMatch(/batch E-/);
    expect(
      (await db().select().from(auditEvents).where(eq(auditEvents.action, "email_sent")))
        .length,
    ).toBe(eventsBefore);
  });

  it("skips suppressed addresses with a skipped entry and no email_sent event", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    const provider = (
      await db().select().from(companies).where(eq(companies.id, providerIds[0]!))
    )[0]!;
    await db()
      .insert(emailSuppressions)
      .values({ email: provider.contactEmail, reason: "hard_bounce" });

    const { outcome, sent } = await sendOutreachWithStub({
      requestId,
      providerIds: [providerIds[0]!],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    expect(sent).toHaveLength(0);
    expect(outcome.skipped[0]!.reason).toContain("email_suppressed");

    const entries = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, requestId));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.emailStatus).toBe("skipped");
    expect(entries[0]!.emailSkippedReason).toContain("email_suppressed");
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_sent")),
    ).toHaveLength(0);
  });

  it("skips opted-out providers", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    await SELF.fetch(`https://example.com/api/providers/${providerIds[0]}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ status: "opted_out", reason: "no emails please" }),
    });

    const { outcome, sent } = await sendOutreachWithStub({
      requestId,
      providerIds: [providerIds[0]!],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    expect(sent).toHaveLength(0);
    expect(outcome.skipped[0]!.reason).toContain("provider_opted_out");
    expect(outcome.skipped[0]!.reason).toContain("no emails please");
  });

  it("rejects the whole batch when the daily email_sent limit is reached", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    const today = new Date();
    const occurredAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 1),
    ).toISOString();
    for (let i = 0; i < Number(env.EMAIL_DAILY_LIMIT); i++) {
      await db().insert(auditEvents).values({
        actorUserId: "someone",
        actorEmail: "someone@example.com",
        occurredAt,
        entity: "outreach_entry",
        entityId: `fake-${i}`,
        action: "email_sent",
        payloadJson: null,
        channel: "automated",
      });
    }

    const { stubEnv } = stubSendEnv();
    await expect(
      sendOutreachEmailBatch(stubEnv, {
        requestId,
        providerIds: [providerIds[0]!],
        staffUserId: await staffUserId(),
        staffEmail: "staff@example.com",
      }),
    ).rejects.toThrow(/daily_email_limit_reached/);
    expect(
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId)),
    ).toHaveLength(0);
  });

  it("rejects sending for a cancelled request", async () => {
    const { requestId, providerIds } = await setupRequestInMatched(1);
    await SELF.fetch(`https://example.com/api/requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "postponed" }),
    });

    const { stubEnv } = stubSendEnv();
    await expect(
      sendOutreachEmailBatch(stubEnv, {
        requestId,
        providerIds: [providerIds[0]!],
        staffUserId: await staffUserId(),
        staffEmail: "staff@example.com",
      }),
    ).rejects.toThrow(/request_is_cancelled/);
  });
});

describe("email outreach route auth", () => {
  it("denies anonymous POST without Access headers", async () => {
    const { requestId } = await setupRequestInMatched(1);
    const res = await SELF.fetch(
      `https://example.com/api/requests/${requestId}/outreach/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerIds: ["x"] }),
      },
    );
    expect([401, 403]).toContain(res.status);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { handleEmailEventBatch } from "../src/worker/email/events";
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

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

async function createProvider(index: number) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `Provider ${index}`,
      registrationIdentifier: `reg-${Date.now()}-${index}-${Math.random()}`,
      contactEmail: `p${index}-${Date.now()}-${Math.random()}@example.com`,
    }),
  });
  const provider = (await res.json()) as { id: string; contactEmail: string };
  return provider;
}

async function createMatchedRequest() {
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
  return request.id;
}

describe("email lifecycle queue consumer", () => {
  it("marks entry delivered once and is idempotent for duplicate messages", async () => {
    const provider = await createProvider(0);
    const requestId = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId,
      providerIds: [provider.id],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;

    await handleEmailEventBatch(env, [
      { id: "m1", body: { type: "message.delivered", to: provider.contactEmail, sendId: "send-1" } },
    ]);

    const delivered = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(delivered.emailStatus).toBe("delivered");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_delivered"));
    expect(events).toHaveLength(1);
    expect(events[0]!.entity).toBe("outreach_entry");
    expect(events[0]!.entityId).toBe(entry.id);
    expect(events[0]!.channel).toBe("automated");
    expect(events[0]!.actorUserId).toBeNull();
    expect(events[0]!.actorEmail).toBeNull();
    expect(JSON.parse(events[0]!.payloadJson ?? "{}")).toMatchObject({
      requestId,
      companyId: provider.id,
      to: provider.contactEmail,
      sendId: "send-1",
    });

    // Duplicate delivered message: no new event, no throw
    await handleEmailEventBatch(env, [
      { id: "m2", body: { type: "message.delivered", to: provider.contactEmail } },
    ]);
    expect(
      await db()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "email_delivered")),
    ).toHaveLength(1);
  });

  it("accepts string-encoded JSON bodies", async () => {
    const provider = await createProvider(0);
    const requestId = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId,
      providerIds: [provider.id],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    await handleEmailEventBatch(env, [
      {
        id: "m1",
        body: JSON.stringify({ type: "message.delivered", to: provider.contactEmail }),
      },
    ]);
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    expect(entry.emailStatus).toBe("delivered");
  });

  it("records bounce, suppresses the address, and never duplicates the suppression", async () => {
    const provider = await createProvider(0);
    const requestId = await createMatchedRequest();
    await sendOutreachWithStub({
      requestId,
      providerIds: [provider.id],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    const bounce = { type: "message.bounced", to: provider.contactEmail, permanent: true };
    await handleEmailEventBatch(env, [{ id: "b1", body: bounce }]);

    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    expect(entry.emailStatus).toBe("bounced");

    const suppressions = await db()
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, provider.contactEmail));
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]!.reason).toBe("hard_bounce");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_bounced"));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payloadJson ?? "{}")).toMatchObject({
      to: provider.contactEmail,
      permanent: true,
    });

    // Second bounce: suppression row not duplicated, no new event
    await handleEmailEventBatch(env, [{ id: "b2", body: bounce }]);
    expect(
      await db()
        .select()
        .from(emailSuppressions)
        .where(eq(emailSuppressions.email, provider.contactEmail)),
    ).toHaveLength(1);
    expect(
      await db()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "email_bounced")),
    ).toHaveLength(1);
  });

  it("ignores unknown addresses, malformed bodies and irrelevant types without throwing", async () => {
    await handleEmailEventBatch(env, [
      { id: "u1", body: { type: "message.delivered", to: "nobody@example.com" } },
      { id: "u2", body: "this is not json{{{" },
      { id: "u3", body: 12345 },
      { id: "u4", body: { type: "something.else", to: "x@example.com" } },
      { id: "u5", body: { type: "message.delivered" } },
      { id: "u6", body: null },
    ]);
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_delivered")),
    ).toHaveLength(0);
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_bounced")),
    ).toHaveLength(0);
  });
});

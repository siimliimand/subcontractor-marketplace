import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../src/worker/app";
import { webhookApp } from "../src/worker/email/webhook";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
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

const HOOK = "https://example.com/hooks/email-events";
const BEARER = { Authorization: "Bearer test-webhook-secret" };

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
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
  return (await res.json()) as { id: string; contactEmail: string };
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

/** Provider + matched request + one stub-sent outreach entry. */
async function seedSentEntry(index: number) {
  const provider = await createProvider(index);
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
  return { provider, requestId, entry };
}

describe("email events webhook receiver", () => {
  it("rejects missing or wrong bearer credentials with 401", async () => {
    const noAuth = await SELF.fetch(HOOK, {
      method: "POST",
      body: JSON.stringify({ type: "message.delivered", to: "p@example.com" }),
    });
    expect(noAuth.status).toBe(401);

    const wrong = await SELF.fetch(HOOK, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
      body: JSON.stringify({ type: "message.delivered", to: "p@example.com" }),
    });
    expect(wrong.status).toBe(401);
  });

  it("fails closed with email_events_webhook_disabled when the secret is unset", async () => {
    const stubEnv = { ...env } as unknown as Bindings;
    delete stubEnv.EMAIL_EVENTS_WEBHOOK_SECRET;
    expect(stubEnv.EMAIL_EVENTS_WEBHOOK_SECRET).toBeUndefined();
    const res = await webhookApp.fetch(
      new Request(HOOK, {
        method: "POST",
        headers: BEARER,
        body: JSON.stringify({ type: "message.delivered", to: "p@example.com" }),
      }),
      stubEnv as Bindings,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "email_events_webhook_disabled" });
  });

  it("applies a delivered event without any Access headers and audits source webhook", async () => {
    const { provider, entry } = await seedSentEntry(0);

    const res = await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify({
        type: "message.delivered",
        to: provider.contactEmail,
        sendId: "send-9",
      }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, skipped: 0 });

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("delivered");

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_delivered"));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payloadJson ?? "{}")).toMatchObject({
      to: provider.contactEmail,
      sendId: "send-9",
      source: "webhook",
    });
  });

  it("accepts an array batch and skips unknown/malformed events without failing", async () => {
    const { provider, entry } = await seedSentEntry(1);
    const res = await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify([
        { type: "message.opened", to: "someone-else@example.com" }, // unmatched → skipped
        { type: "complaint.registered", to: provider.contactEmail }, // unknown type → skipped
        { type: "message.bounced", to: provider.contactEmail }, // applied
      ]),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, skipped: 2 });

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("bounced");
    expect(
      await db()
        .select()
        .from(emailSuppressions)
        .where(eq(emailSuppressions.email, provider.contactEmail)),
    ).toHaveLength(1);
  });

  it("duplicate replay is a no-op (skipped, no second audit event)", async () => {
    const { provider, entry } = await seedSentEntry(2);
    const body = JSON.stringify({ type: "message.delivered", to: provider.contactEmail });

    const first = await SELF.fetch(HOOK, { method: "POST", headers: BEARER, body });
    expect(await first.json()).toEqual({ accepted: 1, skipped: 0 });

    const second = await SELF.fetch(HOOK, { method: "POST", headers: BEARER, body });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ accepted: 0, skipped: 1 });

    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_delivered")),
    ).toHaveLength(1);
    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("delivered");
  });

  it("returns 400 for malformed JSON and 413 for oversized payloads", async () => {
    const bad = await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: "this is not json{{{",
    });
    expect(bad.status).toBe(400);

    const big = await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify({ type: "message.delivered", to: "x@example.com", pad: "a".repeat(70_000) }),
    });
    expect(big.status).toBe(413);
  });

  it("non-POST methods on the hook path return 404", async () => {
    const get = await SELF.fetch(HOOK, { headers: BEARER });
    expect(get.status).toBe(404);
    const put = await SELF.fetch(HOOK, { method: "PUT", headers: BEARER });
    expect(put.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { signToken } from "../src/worker/email/tokens";
import {
  auditEvents,
  availabilityDeclarations,
  companies,
  emailSuppressions,
  emailTokens,
  outreachEntries,
  requests,
  responses,
  users,
} from "../src/worker/db/schema";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  await db().delete(auditEvents);
  await db().delete(emailTokens);
  await db().delete(emailSuppressions);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(companies);
  // availability declarations are company-cascade; clear after companies
  await db().delete(availabilityDeclarations);
});

let providerCounter = 0;

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

async function createProviderWithChannel(channel: "email_only" | "booking_system" | null) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `Adoption ${++providerCounter}`,
      registrationIdentifier: `reg-ad-${providerCounter}-${Date.now()}`,
      contactEmail: `ad${providerCounter}-${Date.now()}@example.com`,
    }),
  });
  const provider = ((await res.json()) as { id: string }).id;
  if (channel) {
    const staff = await staffUserId();
    await db().insert(availabilityDeclarations).values({
      companyId: provider,
      trade: "plumbing",
      workersCount: 2,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      channel,
      lastConfirmedAt: new Date().toISOString(),
      createdBy: staff,
    });
  }
  return provider;
}

async function createMatchedRequest() {
  const reqRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Adoption funnel request",
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

async function acceptTokens(requestId: string, providerId: string) {
  const { outcome } = await sendOutreachWithStub({
    requestId,
    providerIds: [providerId],
    staffUserId: await staffUserId(),
    staffEmail: "staff@example.com",
  });
  expect(outcome.sent).toHaveLength(1);
  const entry = (
    await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
  )[0]!;
  const rows = await db()
    .select()
    .from(emailTokens)
    .where(eq(emailTokens.outreachEntryId, entry.id));
  const acceptRow = rows.find((r) => r.purpose === "accept")!;
  return signToken(
    {
      jti: acceptRow.jti,
      outreachEntryId: acceptRow.outreachEntryId,
      purpose: acceptRow.purpose as never,
    },
    env.EMAIL_TOKEN_SECRET,
    acceptRow.expiresAt,
  );
}

async function submitAccept(token: string): Promise<string> {
  const res = await SELF.fetch(`https://example.com/e/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ workersCount: "2", availableFrom: "2026-11-10" }).toString(),
  });
  return await res.text();
}

const promptedEvents = (_companyId: string) =>
  db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "adoption_prompted"));

describe("adoption funnel prompt", () => {
  it("prompts an email-only provider once on accept, never again", async () => {
    const provider = await createProviderWithChannel("email_only");
    const requestId = await createMatchedRequest();
    const token = await acceptTokens(requestId, provider);

    const html1 = await submitAccept(token);
    expect(html1).toContain("Tired of answering by email?");
    const events = await promptedEvents(provider);
    expect(events).toHaveLength(1);
    expect(events[0]!.entity).toBe("company");
    expect(events[0]!.channel).toBe("automated");
    // No contact email in the payload (minimisation)
    expect(events[0]!.payloadJson).not.toContain("@");

    // Second request + accept: plain confirmation, no second prompt.
    const requestId2 = await createMatchedRequest();
    const token2 = await acceptTokens(requestId2, provider);
    const html2 = await submitAccept(token2);
    expect(html2).not.toContain("Tired of answering by email?");
    expect(await promptedEvents(provider)).toHaveLength(1);
  });

  it("never prompts booking-system providers", async () => {
    const provider = await createProviderWithChannel("booking_system");
    const requestId = await createMatchedRequest();
    const token = await acceptTokens(requestId, provider);
    const html = await submitAccept(token);
    expect(html).not.toContain("Tired of answering by email?");
    expect(await promptedEvents(provider)).toHaveLength(0);
  });

  it("never prompts providers with unknown channel (no declarations)", async () => {
    const provider = await createProviderWithChannel(null);
    const requestId = await createMatchedRequest();
    const token = await acceptTokens(requestId, provider);
    const html = await submitAccept(token);
    expect(html).not.toContain("Tired of answering by email?");
    expect(await promptedEvents(provider)).toHaveLength(0);
  });

  it("does not prompt on decline", async () => {
    const provider = await createProviderWithChannel("email_only");
    const requestId = await createMatchedRequest();
    const { outcome } = await sendOutreachWithStub({
      requestId,
      providerIds: [provider],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });
    expect(outcome.sent).toHaveLength(1);
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    const rows = await db()
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, entry.id));
    const declineRow = rows.find((r) => r.purpose === "decline")!;
    const token = await signToken(
      {
        jti: declineRow.jti,
        outreachEntryId: declineRow.outreachEntryId,
        purpose: declineRow.purpose as never,
      },
      env.EMAIL_TOKEN_SECRET,
      declineRow.expiresAt,
    );
    const res = await SELF.fetch(`https://example.com/e/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reason: "too busy" }).toString(),
    });
    const html = await res.text();
    expect(html).not.toContain("Tired of answering by email?");
    expect(await promptedEvents(provider)).toHaveLength(0);
  });
});

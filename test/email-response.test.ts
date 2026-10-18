import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { signToken } from "../src/worker/email/tokens";
import {
  auditEvents,
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
  const { privateKey } = (globalThis as any).__testAccessKey;
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
  return ((await res.json()) as { id: string }).id;
}

async function createMatchedRequest(title = "Bathroom plumbing") {
  const reqRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title,
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

type TokenSet = {
  entryId: string;
  accept: string;
  quote: string;
  decline: string;
  track: string;
};

async function sendAndGetTokens(requestId: string, providerId: string): Promise<TokenSet> {
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
  expect(rows).toHaveLength(4);
  const byPurpose = new Map(rows.map((r) => [r.purpose, r]));
  async function sign(purpose: string): Promise<string> {
    const row = byPurpose.get(purpose)!;
    return signToken(
      { jti: row.jti, outreachEntryId: row.outreachEntryId, purpose: row.purpose as never },
      env.EMAIL_TOKEN_SECRET,
      row.expiresAt,
    );
  }
  return {
    entryId: entry.id,
    accept: await sign("accept"),
    quote: await sign("quote"),
    decline: await sign("decline"),
    track: await sign("track"),
  };
}

function landing(token: string) {
  return SELF.fetch(`https://example.com/e/${token}`);
}

function submitForm(token: string, body: Record<string, string>) {
  return SELF.fetch(`https://example.com/e/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("public token response flow", () => {
  it("accept flow: landing shows brief + form, submit records response and consumes all tokens", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);
    const request = (
      await db().select().from(requests).where(eq(requests.id, requestId))
    )[0]!;
    const provider = (
      await db().select().from(companies).where(eq(companies.id, providerId))
    )[0]!;

    const get = await landing(tokens.accept);
    expect(get.status).toBe(200);
    expect(get.headers.get("X-Robots-Tag")).toBe("noindex");
    const html = await get.text();
    expect(html).toContain(request.title);
    expect(html).toContain("<form");
    // No internal identifiers leak onto the page
    expect(html).not.toContain(request.id);

    const post = await submitForm(tokens.accept, {
      workersCount: "3",
      availableFrom: "2026-12-01",
    });
    expect(post.status).toBe(200);
    expect(await post.text()).toMatch(/Thank you/i);

    const responseRow = (
      await db().select().from(responses).where(eq(responses.requestId, requestId))
    )[0]!;
    expect(responseRow.companyId).toBe(providerId);
    expect(responseRow.type).toBe("interest");
    expect(responseRow.workersCount).toBe(3);
    expect(responseRow.availableFrom).toBe("2026-12-01");
    expect(responseRow.createdBy).toBeNull();

    const updatedRequest = (
      await db().select().from(requests).where(eq(requests.id, requestId))
    )[0]!;
    expect(updatedRequest.status).toBe("responded");

    const received = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "response_received"));
    expect(received).toHaveLength(1);
    expect(received[0]!.channel).toBe("automated");
    expect(received[0]!.actorEmail).toBe(provider.contactEmail);
    expect(received[0]!.actorUserId).toBeNull();

    const qualified = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "qualified_response"));
    expect(qualified).toHaveLength(1);
    expect(qualified[0]!.channel).toBe("automated");

    const allTokens = await db()
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, tokens.entryId));
    expect(allTokens).toHaveLength(4);
    for (const t of allTokens) expect(t.usedAt).not.toBeNull();

    // Replay of any token of the entry: "already recorded", no new response row
    const replay = await submitForm(tokens.quote, {
      workersCount: "5",
      availableFrom: "2026-12-02",
    });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toMatch(/already/i);
    expect(
      await db().select().from(responses).where(eq(responses.requestId, requestId)),
    ).toHaveLength(1);
  });

  it("decline flow: records decline and cancels the request with provider attribution", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);
    const provider = (
      await db().select().from(companies).where(eq(companies.id, providerId))
    )[0]!;

    const post = await submitForm(tokens.decline, { reason: "Fully booked" });
    expect(post.status).toBe(200);
    expect(await post.text()).toMatch(/Thank you/i);

    const responseRow = (
      await db().select().from(responses).where(eq(responses.requestId, requestId))
    )[0]!;
    expect(responseRow.type).toBe("decline");
    expect(responseRow.reason).toBe("Fully booked");

    const request = (
      await db().select().from(requests).where(eq(requests.id, requestId))
    )[0]!;
    expect(request.status).toBe("cancelled");
    expect(request.cancelledBy).toBe("provider");
    expect(request.cancelReason).toBe("Fully booked");

    const cancelled = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "request_cancelled"));
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.channel).toBe("automated");
    expect(cancelled[0]!.actorEmail).toBe(provider.contactEmail);
  });

  it("quote flow: records workers + available-from and emits quote_submitted", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);

    const post = await submitForm(tokens.quote, {
      workersCount: "4",
      availableFrom: "2026-11-20",
    });
    expect(post.status).toBe(200);

    const responseRow = (
      await db().select().from(responses).where(eq(responses.requestId, requestId))
    )[0]!;
    expect(responseRow.type).toBe("quote");
    expect(responseRow.workersCount).toBe(4);
    expect(responseRow.availableFrom).toBe("2026-11-20");

    const quotes = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "quote_submitted"));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.channel).toBe("automated");
  });

  it("closed request: tokens render no-longer-open and record nothing", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);
    await SELF.fetch(`https://example.com/api/requests/${requestId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ cancelledBy: "customer", reason: "postponed" }),
    });

    const post = await submitForm(tokens.accept, {
      workersCount: "3",
      availableFrom: "2026-12-01",
    });
    expect(post.status).toBe(200);
    expect(await post.text()).toMatch(/no longer open/i);
    expect(
      await db().select().from(responses).where(eq(responses.requestId, requestId)),
    ).toHaveLength(0);

    // Tokens were consumed by the closed-request visit
    const allTokens = await db()
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, tokens.entryId));
    for (const t of allTokens) expect(t.usedAt).not.toBeNull();
  });

  it("invalid and expired tokens render the identical neutral page", async () => {
    const garbage = await landing("garbage");
    expect(garbage.status).toBe(404);
    const garbageHtml = await garbage.text();

    const expiredToken = await signToken(
      { jti: crypto.randomUUID(), outreachEntryId: crypto.randomUUID(), purpose: "accept" },
      env.EMAIL_TOKEN_SECRET,
      new Date(Date.now() - 60_000).toISOString(),
    );
    const expired = await landing(expiredToken);
    expect(expired.status).toBe(404);

    const expiredHtml = await expired.text();
    // One generic message for every failure mode — never reveals which applies
    expect(expiredHtml).toBe(garbageHtml);
  });

  it("form validation: accept without capacity re-renders the form and records nothing", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);

    const bad = await submitForm(tokens.accept, { workersCount: "0", availableFrom: "" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/<form/);
    expect(
      await db().select().from(responses).where(eq(responses.requestId, requestId)),
    ).toHaveLength(0);
    const tokenRow = (
      await db().select().from(emailTokens).where(eq(emailTokens.outreachEntryId, tokens.entryId))
    ).find((t) => t.purpose === "accept")!;
    expect(tokenRow.usedAt).toBeNull();
  });

  it("attribution: client-submitted companyId/requestId are ignored", async () => {
    const providerId = await createProvider(0);
    const otherProviderId = await createProvider(1);
    const requestId = await createMatchedRequest();
    const otherRequestId = await createMatchedRequest("Other kitchen");
    const tokens = await sendAndGetTokens(requestId, providerId);

    const post = await submitForm(tokens.accept, {
      workersCount: "2",
      availableFrom: "2026-12-05",
      companyId: otherProviderId,
      requestId: otherRequestId,
    });
    expect(post.status).toBe(200);

    const own = await db()
      .select()
      .from(responses)
      .where(eq(responses.requestId, requestId));
    expect(own).toHaveLength(1);
    expect(own[0]!.companyId).toBe(providerId);
    expect(
      await db()
        .select()
        .from(responses)
        .where(eq(responses.requestId, otherRequestId)),
    ).toHaveLength(0);
  });
});

describe("tracking pixel", () => {
  it("records exactly one email_opened per token; invalid token records nothing", async () => {
    const providerId = await createProvider(0);
    const requestId = await createMatchedRequest();
    const tokens = await sendAndGetTokens(requestId, providerId);

    const first = await SELF.fetch(`https://example.com/t/${tokens.track}.gif`);
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("image/gif");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(first.headers.get("X-Robots-Tag")).toBe("noindex");
    const gifBytes = new Uint8Array(await first.arrayBuffer());
    expect(gifBytes.length).toBe(43);
    expect(Array.from(gifBytes.slice(0, 3))).toEqual([0x47, 0x49, 0x46]); // "GIF"
    const openedAfterFirst = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_opened"));
    expect(openedAfterFirst).toHaveLength(1);
    expect(openedAfterFirst[0]!.entity).toBe("outreach_entry");
    expect(openedAfterFirst[0]!.entityId).toBe(tokens.entryId);
    expect(openedAfterFirst[0]!.channel).toBe("automated");

    const second = await SELF.fetch(`https://example.com/t/${tokens.track}.gif`);
    expect(second.status).toBe(200);
    expect(second.headers.get("Content-Type")).toBe("image/gif");
    expect(
      await db()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "email_opened")),
    ).toHaveLength(1);

    const invalid = await SELF.fetch(`https://example.com/t/not-a-token.gif`);
    expect(invalid.status).toBe(200);
    expect(invalid.headers.get("Content-Type")).toBe("image/gif");
    expect(
      await db()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "email_opened")),
    ).toHaveLength(1);
  });
});

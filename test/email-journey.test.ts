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

/**
 * Mirrors the remote staging e2e (openspec task 7.4) as closely as the test
 * environment allows: links are parsed from the plain-text email body exactly
 * as a recipient would click them. The open-tracking pixel exists only in the
 * HTML part, which the send stub does not capture (miniflare has no sendEmail
 * binding), so the track token is rebuilt from the token row like
 * email-response.test.ts does.
 */
async function sendBatchAndExtractLinks(requestId: string, providerIds: string[]) {
  const { sent } = await sendOutreachWithStub({
    requestId,
    providerIds,
    staffUserId: await staffUserId(),
    staffEmail: "staff@example.com",
    appBaseUrl: "https://example.com",
  });
  expect(sent).toHaveLength(providerIds.length);

  const perEmail = sent.map((message) => {
    const accept = message.text.match(/^Accept: (\S+)$/m)?.[1];
    const quote = message.text.match(/^Send a quote: (\S+)$/m)?.[1];
    const decline = message.text.match(/^Decline: (\S+)$/m)?.[1];
    expect(accept).toMatch(/^https:\/\/example\.com\/e\/.+/);
    expect(quote).toMatch(/^https:\/\/example\.com\/e\/.+/);
    expect(decline).toMatch(/^https:\/\/example\.com\/e\/.+/);
    return { to: message.to, accept: accept!, quote: quote!, decline: decline! };
  });

  const trackUrlByRecipient = new Map<string, string>();
  const entries = await db()
    .select()
    .from(outreachEntries)
    .where(eq(outreachEntries.requestId, requestId));
  for (const entry of entries) {
    const row = (
      await db()
        .select()
        .from(emailTokens)
        .where(eq(emailTokens.outreachEntryId, entry.id))
    ).find((t) => t.purpose === "track")!;
    const company = (
      await db().select().from(companies).where(eq(companies.id, entry.companyId))
    )[0]!;
    const token = await signToken(
      { jti: row.jti, outreachEntryId: row.outreachEntryId, purpose: "track" },
      env.EMAIL_TOKEN_SECRET,
      row.expiresAt,
    );
    trackUrlByRecipient.set(company.contactEmail, `https://example.com/t/${token}.gif`);
  }
  return { perEmail, trackUrlByRecipient };
}

function openPixel(url: string) {
  return SELF.fetch(url);
}

describe("open pixel upgrades the entry delivery status (SUBC-011)", () => {
  it("pixel fetch moves 'sent' → 'opened' on the entry row", async () => {
    const provider = await createProvider(0);
    const requestId = await createMatchedRequest();
    const { trackUrlByRecipient } = await sendBatchAndExtractLinks(requestId, [provider]);
    const company = (await db().select().from(companies).where(eq(companies.id, provider)))[0]!;
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    expect(entry.emailStatus).toBe("sent");

    const res = await openPixel(trackUrlByRecipient.get(company.contactEmail)!);
    expect(res.status).toBe(200);

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("opened");
  });

  it("pixel fetch upgrades 'delivered' → 'opened'", async () => {
    const provider = await createProvider(1);
    const requestId = await createMatchedRequest();
    const { trackUrlByRecipient } = await sendBatchAndExtractLinks(requestId, [provider]);
    const company = (await db().select().from(companies).where(eq(companies.id, provider)))[0]!;
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    await db()
      .update(outreachEntries)
      .set({ emailStatus: "delivered" })
      .where(eq(outreachEntries.id, entry.id));

    const res = await openPixel(trackUrlByRecipient.get(company.contactEmail)!);
    expect(res.status).toBe(200);

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("opened");
  });

  it("an open on a 'bounced' entry still audits but keeps the terminal status", async () => {
    const provider = await createProvider(2);
    const requestId = await createMatchedRequest();
    const { trackUrlByRecipient } = await sendBatchAndExtractLinks(requestId, [provider]);
    const company = (await db().select().from(companies).where(eq(companies.id, provider)))[0]!;
    const entry = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
    )[0]!;
    await db()
      .update(outreachEntries)
      .set({ emailStatus: "bounced" })
      .where(eq(outreachEntries.id, entry.id));

    const res = await openPixel(trackUrlByRecipient.get(company.contactEmail)!);
    expect(res.status).toBe(200);

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("bounced");
    // The open is still a fact: the audit event was recorded.
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_opened")),
    ).toHaveLength(1);
  });
});

describe("email journey e2e (local mirror of staging task 7.4)", () => {
  it("batch send → pixel open → accept with capacity → funnel events + dashboard movement; second provider declines", async () => {
    // 1. Provider + request setup through the real API
    const providerA = await createProvider(0);
    const providerB = await createProvider(1);
    const requestId = await createMatchedRequest();
    const companyA = (
      await db().select().from(companies).where(eq(companies.id, providerA))
    )[0]!;
    const companyB = (
      await db().select().from(companies).where(eq(companies.id, providerB))
    )[0]!;

    // 2. Batch email outreach to both providers
    const { perEmail, trackUrlByRecipient } = await sendBatchAndExtractLinks(requestId, [
      providerA,
      providerB,
    ]);
    const emailA = perEmail.find((e) => e.to === companyA.contactEmail)!;
    const emailB = perEmail.find((e) => e.to === companyB.contactEmail)!;

    // Dashboard before any response: 2 sent, nothing opened, no qualified split yet
    const before = (await (
      await SELF.fetch("https://example.com/api/dashboard/overview", {
        headers: { ...authHeaders },
      })
    ).json()) as {
      email: { sent: number; opened: number; automatedQualified: number; manualQualified: number };
    };
    expect(before.email.sent).toBe(2);
    expect(before.email.opened).toBe(0);

    // 3. Provider A opens the email (tracking pixel fires once)
    const pixel = await openPixel(trackUrlByRecipient.get(companyA.contactEmail)!);
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get("Content-Type")).toBe("image/gif");
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_opened")),
    ).toHaveLength(1);

    // 4. Provider A clicks Accept, sees the brief, submits capacity
    const landing = await SELF.fetch(emailA.accept);
    expect(landing.status).toBe(200);
    const landingHtml = await landing.text();
    expect(landingHtml).toContain("Bathroom plumbing");
    expect(landingHtml).not.toContain(requestId); // no internal ids on the public page
    const action = landingHtml.match(/<form[^>]*\saction="([^"]*)"/)![1]!;
    expect(action).toBe(new URL(emailA.accept).pathname);

    const submit = await SELF.fetch(`https://example.com${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        workersCount: "3",
        availableFrom: "2026-11-15",
      }).toString(),
    });
    expect(submit.status).toBe(200);
    expect(await submit.text()).toMatch(/Thank you/i);

    // 5. Funnel audit events exist with automated attribution from the token only
    const received = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "response_received"));
    expect(received).toHaveLength(1);
    expect(received[0]!.channel).toBe("automated");
    expect(received[0]!.actorEmail).toBe(companyA.contactEmail);
    expect(received[0]!.actorUserId).toBeNull();

    const qualified = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "qualified_response"));
    expect(qualified).toHaveLength(1);
    expect(qualified[0]!.channel).toBe("automated");

    // Request moved matched → responded
    const requestRow = (
      await db().select().from(requests).where(eq(requests.id, requestId))
    )[0]!;
    expect(requestRow.status).toBe("responded");

    // Response row carries the declared capacity
    const responseRow = (
      await db().select().from(responses).where(eq(responses.requestId, requestId))
    )[0]!;
    expect(responseRow.companyId).toBe(providerA);
    expect(responseRow.type).toBe("interest");
    expect(responseRow.workersCount).toBe(3);
    expect(responseRow.availableFrom).toBe("2026-11-15");

    // All of A's tokens are single-use consumed
    const aEntry = (
      await db()
        .select()
        .from(outreachEntries)
        .where(eq(outreachEntries.requestId, requestId))
    ).find((e) => e.companyId === providerA)!;
    for (const t of await db()
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, aEntry.id))) {
      expect(t.usedAt).not.toBeNull();
    }

    // 6. Provider B declines instead
    const declineLanding = await SELF.fetch(emailB.decline);
    expect(declineLanding.status).toBe(200);
    const declineAction = (await declineLanding.text()).match(
      /<form[^>]*\saction="([^"]*)"/,
    )![1]!;
    const declinePost = await SELF.fetch(`https://example.com${declineAction}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reason: "Crew committed elsewhere" }).toString(),
    });
    expect(declinePost.status).toBe(200);

    const allResponses = await db()
      .select()
      .from(responses)
      .where(eq(responses.requestId, requestId));
    expect(allResponses).toHaveLength(2);
    const declineRow = allResponses.find((r) => r.companyId === providerB)!;
    expect(declineRow.type).toBe("decline");
    expect(declineRow.reason).toBe("Crew committed elsewhere");

    // A's qualified interest exists, so B's decline must NOT cancel the request
    expect(
      await db()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "request_cancelled")),
    ).toHaveLength(0);

    // 7. Dashboard reflects the movement: 2 sent, 1 opened, automated=1/manual=0
    const after = (await (
      await SELF.fetch("https://example.com/api/dashboard/overview", {
        headers: { ...authHeaders },
      })
    ).json()) as {
      eligibleRequests: number;
      email: { sent: number; opened: number; automatedQualified: number; manualQualified: number };
    };
    expect(after.email.sent).toBe(2);
    expect(after.email.opened).toBe(1);
    expect(after.email.automatedQualified).toBe(1);
    expect(after.email.manualQualified).toBe(0);
    expect(after.eligibleRequests).toBe(1);
  });
});

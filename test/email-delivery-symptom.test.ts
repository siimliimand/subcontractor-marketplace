import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { handleInboundEmail } from "../src/worker/email/inbound";
import { resolveStaleSentEmails } from "../src/worker/email/resolve";
import { signToken } from "../src/worker/email/tokens";
import {
  auditEvents,
  companies,
  emailSuppressions,
  emailTokens,
  outreachEntries,
  requests,
  users,
} from "../src/worker/db/schema";

// ---------------------------------------------------------------------------
// SUBC-011 symptom acceptance. Original failure (README caveat 2026-10-18):
// Cloudflare Email Service has no lifecycle-event → Queue routing, so the
// queue consumer is dormant with zero producers — every pilot outreach email
// stayed 'sent' forever, delivered/opened/bounced never appeared in the
// cockpit, bounces never suppressed addresses, bounce rate was unmeasurable.
//
// This file reproduces that state, then proves every real-world resolution
// path moves the state WITHOUT any Queue producer: webhook, inbound DSN,
// open pixel, and the resolution sweep — and that per-provider bounce rate
// becomes measurable.
// ---------------------------------------------------------------------------

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
      legalName: `OÜ Symptom ${index}`,
      registrationIdentifier: `reg-symptom-${index}-${Date.now()}-${Math.random()}`,
      contactEmail: `symptom${index}-${Date.now()}-${Math.random()}@example.com`,
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

/** The exact reported seeding: provider + matched request + stub-sent batch. */
async function seedSentEntry(index: number, opts?: { ageMinutes?: number }) {
  const provider = await createProvider(index);
  const requestId = await createMatchedRequest();
  const { sent } = await sendOutreachWithStub({
    requestId,
    providerIds: [provider.id],
    staffUserId: await staffUserId(),
    staffEmail: "staff@example.com",
    appBaseUrl: "https://example.com",
  });
  expect(sent).toHaveLength(1);
  const entry = (
    await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, requestId))
  )[0]!;
  if (opts?.ageMinutes) {
    const sentAt = new Date(Date.now() - opts.ageMinutes * 60_000).toISOString();
    await db().update(outreachEntries).set({ sentAt }).where(eq(outreachEntries.id, entry.id));
  }
  return { provider, requestId, entry };
}

async function auditCount(action: string): Promise<number> {
  return (
    await db().select().from(auditEvents).where(eq(auditEvents.action, action))
  ).length;
}

describe("email delivery symptom — stuck at 'sent' is gone", () => {
  it("reproduces the original failure: no producer leaves the entry stuck at 'sent'", async () => {
    const { entry } = await seedSentEntry(0);

    // The exact reported symptom: the entry sits at 'sent' with zero
    // lifecycle audit events and the dashboard shows no deliveries — no
    // signal exists anywhere that can move the state.
    expect(entry.emailStatus).toBe("sent");
    expect(await auditCount("email_delivered")).toBe(0);
    expect(await auditCount("email_bounced")).toBe(0);
    expect(await auditCount("email_opened")).toBe(0);

    const overview = (await (
      await SELF.fetch("https://example.com/api/dashboard/overview", {
        headers: authHeaders,
      })
    ).json()) as { email: { delivered: number } };
    expect(overview.email.delivered).toBe(0);
  });

  it("(a) webhook delivered event resolves the entry within the same tick", async () => {
    const { provider, entry } = await seedSentEntry(1);

    const res = await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify({ type: "message.delivered", to: provider.contactEmail }),
    });
    expect(res.status).toBe(202);

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("delivered");
    expect(await auditCount("email_delivered")).toBe(1);

    const overview = (await (
      await SELF.fetch("https://example.com/api/dashboard/overview", {
        headers: authHeaders,
      })
    ).json()) as { email: { delivered: number } };
    expect(overview.email.delivered).toBe(1);
  });

  it("(b) inbound DSN bounce flips the entry and suppresses the address", async () => {
    const { provider, entry } = await seedSentEntry(2);
    const dsn = `From: MAILER-DAEMON@subcontractor.ww0.dev
To: info@subcontractor.ww0.dev
Subject: Undelivered Mail Returned to Sender
Auto-Submitted: auto-replied
Content-Type: multipart/report; report-type=delivery-status; boundary="SYM1"

--SYM1
Content-Type: message/delivery-status

Final-Recipient: rfc822; ${provider.contactEmail}
Action: failed
Status: 5.1.1

--SYM1--`;

    const result = await handleInboundEmail(env, dsn);
    expect(result).toMatchObject({ applied: true, to: provider.contactEmail });

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

  it("(c) the open pixel upgrades the entry to 'opened'", async () => {
    const { entry } = await seedSentEntry(3);

    const tokenRow = (
      await db().select().from(emailTokens).where(eq(emailTokens.outreachEntryId, entry.id))
    ).find((t) => t.purpose === "track")!;
    const token = await signToken(
      { jti: tokenRow.jti, outreachEntryId: tokenRow.outreachEntryId, purpose: "track" },
      env.EMAIL_TOKEN_SECRET,
      tokenRow.expiresAt,
    );
    const pixel = await SELF.fetch(`https://example.com/t/${token}.gif`);
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get("Content-Type")).toBe("image/gif");

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("opened");
    expect(await auditCount("email_opened")).toBe(1);
  });

  it("(d) the resolution sweep infers delivery past the window when no signal arrives", async () => {
    const { entry } = await seedSentEntry(4, { ageMinutes: 11 });

    const resolved = await resolveStaleSentEmails(db(), {
      now: new Date(),
      resolveAfterMinutes: 10,
    });
    expect(resolved).toEqual([entry.id]);

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
      inferred: true,
      source: "resolution",
    });
  });

  it("(e) per-provider bounce rate is measurable after resolution", async () => {
    // Provider A: hard bounce via the webhook path.
    const a = await seedSentEntry(5);
    await SELF.fetch(HOOK, {
      method: "POST",
      headers: BEARER,
      body: JSON.stringify({ type: "message.bounced", to: a.provider.contactEmail }),
    });
    // Provider B: no signal at all → resolved by the sweep.
    const b = await seedSentEntry(6, { ageMinutes: 11 });
    await resolveStaleSentEmails(db(), { now: new Date(), resolveAfterMinutes: 10 });

    const data = (await (
      await SELF.fetch("https://example.com/api/dashboard/email-delivery", {
        headers: authHeaders,
      })
    ).json()) as {
      providers: { companyId: string; sent: number; bounced: number; bounceRate: number | null }[];
      totals: { sent: number; bounced: number; bounceRate: number | null };
    };
    const rowA = data.providers.find((p) => p.companyId === a.provider.id)!;
    const rowB = data.providers.find((p) => p.companyId === b.provider.id)!;
    expect(rowA).toMatchObject({ sent: 1, bounced: 1, bounceRate: 1 });
    expect(rowB).toMatchObject({ sent: 1, bounced: 0, bounceRate: 0 });
    expect(data.totals).toMatchObject({ sent: 2, bounced: 1, bounceRate: 0.5 });
  });
});

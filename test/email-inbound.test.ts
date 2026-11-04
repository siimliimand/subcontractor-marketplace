import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import {
  handleInboundEmail,
  parseDeliveryFailure,
} from "../src/worker/email/inbound";
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

async function seedSentEntry() {
  const providerRes = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: "OÜ Inbound",
      registrationIdentifier: `reg-inbound-${Date.now()}-${Math.random()}`,
      contactEmail: `inbound-${Date.now()}-${Math.random()}@example.com`,
    }),
  });
  const provider = (await providerRes.json()) as { id: string; contactEmail: string };
  const reqRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Drywall partitions",
      description: "Two floors",
      location: "Tallinn",
      trade: "drywall",
      startDate: "2026-11-20",
      crewSize: 4,
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
  await sendOutreachWithStub({
    requestId: request.id,
    providerIds: [provider.id],
    staffUserId: await staffUserId(),
    staffEmail: "staff@example.com",
  });
  const entry = (
    await db().select().from(outreachEntries).where(eq(outreachEntries.requestId, request.id))
  )[0]!;
  return { provider, requestId: request.id, entry };
}

function hardBounceDsn(to: string): string {
  return `From: MAILER-DAEMON@subcontractor.ww0.dev
To: info@subcontractor.ww0.dev
Subject: Undelivered Mail Returned to Sender
Auto-Submitted: auto-replied
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND1"

--BOUND1
Content-Description: Notification
Content-Type: text/plain; charset=utf-8

This is the mail system at subcontractor.ww0.dev.

I'm sorry to have to inform you that your message could not
be delivered to one or more recipients.

   <${to}>: Recipient address rejected: User unknown

--BOUND1
Content-Description: Delivery report
Content-Type: message/delivery-status

Reporting-MTA: dns; subcontractor.ww0.dev

Final-Recipient: rfc822; ${to}
Original-Recipient: rfc822;${to}
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <${to}>: Recipient address rejected: User unknown

--BOUND1
Content-Description: Undelivered message headers
Content-Type: text/rfc822-headers

Subject: Subcrew: new work opportunity
From: Subcrew <info@subcontractor.ww0.dev>

--BOUND1--`;
}

function softBounceDsn(to: string): string {
  return `From: MAILER-DAEMON@relay.example.com
To: info@subcontractor.ww0.dev
Subject: Delayed Mail (still being retried)
Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND2"

--BOUND2
Content-Type: message/delivery-status

Reporting-MTA: dns; relay.example.com

Final-Recipient: rfc822; <${to}>
Action: delayed
Status: 4.2.1
Diagnostic-Code: smtp; 450 4.2.1 mailbox busy

--BOUND2--`;
}

function xFailedDsn(to: string): string {
  return `From: MAILER-DAEMON@googlemail.com
To: info@subcontractor.ww0.dev
Subject: Delivery Status Notification (Failure)
X-Failed-Recipients: ${to}
Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND3"

--BOUND3
Content-Type: message/delivery-status

Reporting-MTA: dns; googlemail.com

Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.

--BOUND3--`;
}

function vacationAutoReply(): string {
  return `From: Provider Owner <owner@example.com>
To: info@subcontractor.ww0.dev
Subject: Out of office
Auto-Submitted: auto-replied
Precedence: bulk
Content-Type: text/plain

I am on vacation until Monday and will respond after I return.

-- 
Provider Owner`;
}

function humanReply(): string {
  return `From: Provider Owner <owner@example.com>
To: info@subcontractor.ww0.dev
Subject: Re: Subcrew: new work opportunity
Content-Type: text/plain

Hi, we could take 3 workers starting next week. Can you send the brief?

Best,
Owner`;
}

describe("RFC 3464 DSN parser", () => {
  it("parses a hard bounce DSN (5.1.1) as permanent", () => {
    expect(parseDeliveryFailure(hardBounceDsn("bad@example.com"))).toEqual({
      to: "bad@example.com",
      permanent: true,
    });
  });

  it("parses a soft bounce DSN (4.x) as temporary", () => {
    expect(parseDeliveryFailure(softBounceDsn("greylisted@example.com"))).toEqual({
      to: "greylisted@example.com",
      permanent: false,
    });
  });

  it("falls back to X-Failed-Recipients and strips angle brackets", () => {
    expect(parseDeliveryFailure(xFailedDsn("ghost@example.com"))).toEqual({
      to: "ghost@example.com",
      permanent: true,
    });
  });

  it("never classifies vacation auto-replies as bounces", () => {
    expect(parseDeliveryFailure(vacationAutoReply())).toBeNull();
  });

  it("never classifies ordinary human replies as bounces", () => {
    expect(parseDeliveryFailure(humanReply())).toBeNull();
  });

  it("returns null for a failure DSN without any recipient header", () => {
    const raw = `From: MAILER-DAEMON@x.example
To: info@subcontractor.ww0.dev
Content-Type: message/delivery-status

Action: failed
Status: 5.0.0
`;
    expect(parseDeliveryFailure(raw)).toBeNull();
  });
});

describe("inbound email application", () => {
  it("applies a hard-bounce DSN through the shared applier with source inbound", async () => {
    const { provider, entry } = await seedSentEntry();
    const raw = hardBounceDsn(provider.contactEmail);

    const result = await handleInboundEmail(env, raw);
    expect(result).toMatchObject({ applied: true, to: provider.contactEmail, permanent: true });

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("bounced");

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
      source: "inbound",
    });
  });

  it("leaves state untouched for non-DSN mail", async () => {
    const { provider, entry } = await seedSentEntry();
    const result = await handleInboundEmail(env, vacationAutoReply());
    expect(result).toBeNull();

    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("sent");
    expect(
      await db()
        .select()
        .from(emailSuppressions)
        .where(eq(emailSuppressions.email, provider.contactEmail)),
    ).toHaveLength(0);
  });
});

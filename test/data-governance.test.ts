import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
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
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(auditEvents);
  await db().delete(emailTokens);
  await db().delete(emailSuppressions);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(companies);
});

let providerCounter = 0;

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

async function createProvider(email?: string) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `Governance ${++providerCounter} OÜ`,
      registrationIdentifier: `reg-gov-${providerCounter}-${Date.now()}`,
      contactEmail: email ?? `gov${providerCounter}-${Date.now()}@example.com`,
      contactPhone: "+372 555 0001",
    }),
  });
  return (await res.json()) as { id: string; contactEmail?: string };
}

describe("suppression management", () => {
  it("adds with reason, lists with origin, refuses duplicates", async () => {
    const add = await SELF.fetch("https://example.com/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "stop-me@example.com", reason: "provider request" }),
    });
    expect(add.status).toBe(201);

    const dup = await SELF.fetch("https://example.com/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "stop-me@example.com", reason: "again" }),
    });
    expect(dup.status).toBe(409);

    const list = (await (
      await SELF.fetch("https://example.com/api/suppressions", { headers: authHeaders })
    ).json()) as { suppressions: { email: string; reason: string }[] };
    expect(list.suppressions.map((s) => s.email)).toContain("stop-me@example.com");
    expect(list.suppressions[0]!.reason).toContain("manual");

    const events = await db().select().from(auditEvents);
    expect(events.some((e) => e.action === "suppression_added")).toBe(true);
  });

  it("requires a reason to add and to remove; removal re-allows sending and is audited", async () => {
    const noReason = await SELF.fetch("https://example.com/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(noReason.status).toBe(400);

    await SELF.fetch("https://example.com/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "temporary@example.com", reason: "mistake" }),
    });

    const noReasonDelete = await SELF.fetch(
      "https://example.com/api/suppressions/temporary@example.com",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: "{}",
      },
    );
    expect(noReasonDelete.status).toBe(400);

    const del = await SELF.fetch(
      "https://example.com/api/suppressions/temporary@example.com",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ reason: "suppressed in error" }),
      },
    );
    expect(del.status).toBe(200);
    const remaining = await db().select().from(emailSuppressions);
    expect(remaining.map((s) => s.email)).not.toContain("temporary@example.com");

    const events = await db().select().from(auditEvents);
    const removed = events.find((e) => e.action === "suppression_removed");
    expect(removed).toBeDefined();
    expect(JSON.parse(removed!.payloadJson ?? "{}").reason).toBe("suppressed in error");
  });
});

describe("company data erasure", () => {
  it("anonymises the company, redacts the audit trail, keeps history, requires reason", async () => {
    const provider = await createProvider();
    const contactEmail = `gov${providerCounter}-${""}@example.com`;
    // Recover the actual contact email from the DB (createProvider suffixes
    // timestamps; fetch fresh).
    const row = (await db().select().from(companies).where(eq(companies.id, provider.id)))[0]!;
    const email = row.contactEmail!;

    // Generate audit activity carrying the contact email (email send payload
    // style + outreach).
    const requestId = ((
      await (
        await SELF.fetch("https://example.com/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            title: "Erasure target",
            description: "d",
            location: "Tartu",
            trade: "plumbing",
            startDate: "2026-11-10",
            crewSize: 2,
          }),
        })
      ).json()
    ) as { id: string }).id;
    for (const to of ["approved", "matched"]) {
      await SELF.fetch(`https://example.com/api/requests/${requestId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    await sendOutreachWithStub({
      requestId,
      providerIds: [provider.id],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });
    // Record a response so the funnel has history involving the provider.
    await SELF.fetch(`https://example.com/api/requests/${requestId}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        type: "interest",
        companyId: provider.id,
        workersCount: 2,
        availableFrom: "2026-11-10",
      }),
    });

    const noReason = await SELF.fetch(`https://example.com/api/providers/${provider.id}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: "{}",
    });
    expect(noReason.status).toBe(400);

    const erase = await SELF.fetch(`https://example.com/api/providers/${provider.id}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "provider GDPR request" }),
    });
    expect(erase.status).toBe(200);

    const anonymised = (
      await db().select().from(companies).where(eq(companies.id, provider.id))
    )[0]!;
    expect(anonymised.legalName).toMatch(/^Erased company/);
    expect(anonymised.contactEmail).toBe("erased-contact");
    expect(anonymised.contactPhone).toBeNull();
    expect(anonymised.status).toBe("opted_out");
    expect(anonymised.statusReason).toContain("erased");

    // Audit trail: the address is gone; the events are not.
    const payloadHits = await db()
      .select()
      .from(auditEvents)
      .where(like(auditEvents.payloadJson, `%${email}%`));
    expect(payloadHits).toHaveLength(0);
    const actorHits = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorEmail, email));
    expect(actorHits).toHaveLength(0);

    // Funnel history preserved: the response event still exists (anonymised payload).
    const funnel = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "response_received"));
    expect(funnel.length).toBeGreaterThanOrEqual(1);
    expect(funnel[0]!.payloadJson).not.toContain(email);

    const erased = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "company_erased"));
    expect(erased).toHaveLength(1);
    expect(erased[0]!.payloadJson).not.toContain(email);
    void contactEmail;
  });
});

describe("payload minimisation", () => {
  it("email_sent payload references the outreach entry, not the recipient address", async () => {
    const provider = await createProvider();
    const requestId = ((
      await (
        await SELF.fetch("https://example.com/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            title: "Minimisation check",
            description: "d",
            location: "Tartu",
            trade: "plumbing",
            startDate: "2026-11-10",
            crewSize: 2,
          }),
        })
      ).json()
    ) as { id: string }).id;
    for (const to of ["approved", "matched"]) {
      await SELF.fetch(`https://example.com/api/requests/${requestId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ to }),
      });
    }
    const row = (await db().select().from(companies).where(eq(companies.id, provider.id)))[0]!;
    await sendOutreachWithStub({
      requestId,
      providerIds: [provider.id],
      staffUserId: await staffUserId(),
      staffEmail: "staff@example.com",
    });

    const sent = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "email_sent"));
    expect(sent.length).toBe(1);
    expect(sent[0]!.payloadJson).not.toContain(row.contactEmail!);
    expect(JSON.parse(sent[0]!.payloadJson ?? "{}").subject).toBeDefined();
  });
});

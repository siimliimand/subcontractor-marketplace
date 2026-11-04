import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { sendOutreachWithStub } from "./helpers/email";
import { resolveStaleSentEmails } from "../src/worker/email/resolve";
import { applyEmailLifecycleEvent } from "../src/worker/email/events";
import { runScheduledJobs } from "../src/worker/index";
import {
  auditEvents,
  companies,
  emailSuppressions,
  emailTokens,
  holds,
  outreachEntries,
  requests,
  responses,
  services,
  users,
} from "../src/worker/db/schema";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  // Provisions the staff user row (requireStaff upserts on first auth).
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(auditEvents);
  await db().delete(emailTokens);
  await db().delete(emailSuppressions);
  await db().delete(holds);
  await db().delete(responses);
  await db().delete(outreachEntries);
  await db().delete(requests);
  await db().delete(services);
  await db().delete(companies);
});

async function staffUserId(): Promise<string> {
  const user = (
    await db().select().from(users).where(eq(users.email, "staff@example.com")).limit(1)
  )[0];
  if (!user) throw new Error("staff user not provisioned");
  return user.id;
}

let regCounter = 0;

async function createProvider(index: number) {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `Provider ${index}`,
      registrationIdentifier: `reg-res-${++regCounter}-${Math.random()}`,
      contactEmail: `res${regCounter}-${Math.random()}@example.com`,
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

/** Provider + matched request + stub-sent email entry, `ageMinutes` old. */
async function seedSentEntry(index: number, ageMinutes: number) {
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
  const sentAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
  await db().update(outreachEntries).set({ sentAt }).where(eq(outreachEntries.id, entry.id));
  return { provider, requestId, entry };
}

/**
 * Compact replica of the cron-jobs.test.ts widening seed: two electricians,
 * a matched request walked to in_outreach whose matching entry is backdated
 * past the widening timeout.
 */
async function seedWidenableRequest(ageHours: number) {
  const staff = await staffUserId();
  const providerIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = await SELF.fetch("https://example.com/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        legalName: `OÜ Res ${++regCounter}`,
        registrationIdentifier: `reg-res-w-${regCounter}`,
        contactEmail: `resw${regCounter}@x.ee`,
      }),
    });
    const provider = (await res.json()) as { id: string };
    providerIds.push(provider.id);
    await SELF.fetch(`https://example.com/api/providers/${provider.id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ trade: "electrical", serviceArea: "Tallinn", pricingModel: "hour" }),
    });
  }
  const requestRes = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Resolution cron job",
      description: "d",
      location: "Tallinn",
      trades: ["electrical"],
      startDate: "2026-11-02",
      crewSize: 3,
    }),
  });
  const request = (await requestRes.json()) as { id: string };
  for (const to of ["approved", "matched", "in_outreach"]) {
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to }),
    });
  }
  await db().insert(outreachEntries).values({
    requestId: request.id,
    companyId: providerIds[0]!,
    batchNumber: `M-res-test-00001`,
    contactedBy: staff,
    channel: "matching",
    trade: "electrical",
    matchScore: 0.8,
    matchFactorsJson: "{}",
    sentAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
  });
  return request.id;
}

describe("stale-sent resolution sweep", () => {
  it("resolves a stale 'sent' entry to inferred delivered with an audit event", async () => {
    const { provider, requestId, entry } = await seedSentEntry(0, 11);

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
      reason: "resolution_window_elapsed",
      resolveAfterMinutes: 10,
      source: "resolution",
      requestId,
      companyId: provider.id,
    });
  });

  it("leaves fresh sent entries untouched", async () => {
    const { entry } = await seedSentEntry(1, 3);
    const resolved = await resolveStaleSentEmails(db(), {
      now: new Date(),
      resolveAfterMinutes: 10,
    });
    expect(resolved).toEqual([]);
    const after = (
      await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id))
    )[0]!;
    expect(after.emailStatus).toBe("sent");
  });

  it("never touches bounced/skipped entries, manual channels, or null statuses", async () => {
    const { provider, requestId, entry } = await seedSentEntry(2, 11);
    // Bounced via the shared applier.
    await applyEmailLifecycleEvent(db(), {
      kind: "bounced",
      to: provider.contactEmail,
      source: "webhook",
    });
    // Distinct companies for the hand-seeded entries (unique index on
    // (requestId, companyId)).
    const extras: { batchNumber: string; channel: string; status: string | null }[] = [
      { batchNumber: "E-test-skip-1", channel: "email", status: "skipped" },
      { batchNumber: "M-test-1", channel: "manual", status: "sent" },
      { batchNumber: "E-test-null-1", channel: "email", status: null },
    ];
    const staffId = await staffUserId();
    for (const extra of extras) {
      const extraProvider = await createProvider(7);
      await db().insert(outreachEntries).values({
        requestId,
        companyId: extraProvider.id,
        batchNumber: extra.batchNumber,
        contactedBy: staffId,
        channel: extra.channel,
        emailStatus: extra.status,
        emailSkippedReason: extra.status === "skipped" ? "email_suppressed" : null,
        sentAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      });
    }

    const resolved = await resolveStaleSentEmails(db(), {
      now: new Date(),
      resolveAfterMinutes: 10,
    });
    expect(resolved).toEqual([]);

    const rows = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.requestId, requestId));
    expect(rows.find((r) => r.id === entry.id)!.emailStatus).toBe("bounced");
    expect(rows.find((r) => r.batchNumber === "E-test-skip-1")!.emailStatus).toBe("skipped");
    expect(rows.find((r) => r.batchNumber === "M-test-1")!.emailStatus).toBe("sent");
    expect(rows.find((r) => r.batchNumber === "E-test-null-1")!.emailStatus).toBeNull();
  });

  it("is idempotent — a second run resolves nothing new", async () => {
    const { entry } = await seedSentEntry(3, 11);
    const first = await resolveStaleSentEmails(db(), {
      now: new Date(),
      resolveAfterMinutes: 10,
    });
    expect(first).toEqual([entry.id]);
    const second = await resolveStaleSentEmails(db(), {
      now: new Date(),
      resolveAfterMinutes: 10,
    });
    expect(second).toEqual([]);
    expect(
      await db().select().from(auditEvents).where(eq(auditEvents.action, "email_delivered")),
    ).toHaveLength(1);
  });

  it("a late real bounce after inferred delivery still wins", async () => {
    const { provider, entry } = await seedSentEntry(4, 11);
    await resolveStaleSentEmails(db(), { now: new Date(), resolveAfterMinutes: 10 });

    const applied = await applyEmailLifecycleEvent(db(), {
      kind: "bounced",
      to: provider.contactEmail,
      source: "inbound",
    });
    expect(applied).toBe(true);
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
});

describe("runScheduledJobs cadence (*/5 cron)", () => {
  it("runs the hourly set at minute 0 and sweeps in the same tick", async () => {
    const requestId = await seedWidenableRequest(10);
    const { entry } = await seedSentEntry(5, 11);

    // Synthetic clock: an hour ahead, then pinned to minute 0 — guaranteed
    // after every seeded row while exercising the hourly gate.
    const now = new Date(Date.now() + 3_600_000);
    now.setUTCMinutes(0, 0, 0);
    const result = await runScheduledJobs(env, { now });

    // Hourly set fired: the silent request was widened.
    expect(result.widened.length).toBe(1);
    expect(result.widened[0]!.requestId).toBe(requestId);
    // Sweep fired too: the stale email entry resolved.
    expect(result.resolved).toEqual([entry.id]);
    expect(
      (await db().select().from(outreachEntries).where(eq(outreachEntries.id, entry.id)))[0]!
        .emailStatus,
    ).toBe("delivered");
  });

  it("skips widening/retention at minute 7 but still resolves stale entries", async () => {
    await seedWidenableRequest(10);
    const { entry } = await seedSentEntry(6, 11);

    const now = new Date(Date.now() + 3_600_000);
    now.setUTCMinutes(7, 0, 0);
    const result = await runScheduledJobs(env, { now });

    expect(result.widened).toEqual([]);
    expect(result.purged).toEqual({
      tokensDeleted: 0,
      holdsDeleted: 0,
      intervalsDeleted: 0,
    });
    // No widening batch was created.
    expect(
      (
        await db()
          .select()
          .from(outreachEntries)
          .where(eq(outreachEntries.requestId, entry.requestId))
      ).length,
    ).toBeGreaterThanOrEqual(1);
    const widenBatches = await db()
      .select()
      .from(outreachEntries)
      .where(eq(outreachEntries.channel, "matching"));
    expect(widenBatches.every((e) => !e.batchNumber.endsWith("-w"))).toBe(true);
    // The sweep still ran.
    expect(result.resolved).toEqual([entry.id]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, requests, timeEntries } from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  authHeaders = accessHeaders(
    await makeAccessToken(privateKey, { email: "staff@example.com" }),
  );
  await db().delete(auditEvents);
  await db().delete(timeEntries);
  await db().delete(requests);
});

async function createRequest() {
  const res = await SELF.fetch("https://example.com/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      title: "Painting job",
      description: "Repaint facade",
      location: "Tallinn",
      trade: "painting",
      startDate: "2026-11-15",
      crewSize: 4,
    }),
  });
  return (await res.json()) as { id: string };
}

describe("effort tracking", () => {
  it("logs manual time entries per request", async () => {
    const request = await createRequest();
    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ minutes: 45, note: "clarified brief and called providers" }),
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { minutes: number; note: string };
    expect(entry.minutes).toBe(45);
    expect(entry.note).toContain("providers");
  });

  it("rejects invalid minutes", async () => {
    const request = await createRequest();
    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ minutes: -5 }),
    });
    expect(res.status).toBe(400);
  });

  it("rollup: total minutes and count of manual audit events", async () => {
    const request = await createRequest();
    await SELF.fetch(`https://example.com/api/requests/${request.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ minutes: 45, note: "calls" }),
    });
    await SELF.fetch(`https://example.com/api/requests/${request.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ minutes: 30 }),
    });
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to: "approved" }),
    });

    const res = await SELF.fetch(`https://example.com/api/requests/${request.id}/effort`, {
      headers: authHeaders,
    });
    const rollup = (await res.json()) as { totalMinutes: number; manualEvents: number };
    expect(rollup.totalMinutes).toBe(75);
    // request_created + request_approved
    expect(rollup.manualEvents).toBe(2);
  });
});

describe("append-only guarantee", () => {
  it("no update or delete path exists for audit events", async () => {
    const request = await createRequest();
    // create an event
    await SELF.fetch(`https://example.com/api/requests/${request.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ to: "approved" }),
    });
    const before = (await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}/history`, {
        headers: authHeaders,
      })
    ).json()) as { id: string }[];
    expect(before.length).toBeGreaterThan(0);

    // verify the API surface exposes no mutation of events: app router actions list
    const { appPaths } = (await import("../src/worker/app")) as any;
    const routes = appPaths?.() ?? [];
    const mutatingEventRoutes = routes.filter((r: unknown) => {
      const path = String(r);
      return path.includes("audit") || path.includes("events");
    });
    // even if introspection is unavailable, direct attempts fail
    expect(mutatingEventRoutes.filter((r: string) => /PUT|PATCH|DELETE|post/.test(r))).toEqual([]);

    const eventId = before[0]!.id;
    const del = await SELF.fetch(`https://example.com/api/audit-events/${eventId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect([403, 404]).toContain(del.status);
    const patch = await SELF.fetch(`https://example.com/api/audit-events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ action: "tampered" }),
    });
    expect([403, 404]).toContain(patch.status);

    const after = (await (
      await SELF.fetch(`https://example.com/api/requests/${request.id}/history`, {
        headers: authHeaders,
      })
    ).json()) as { id: string; action: string }[];
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
  });
});

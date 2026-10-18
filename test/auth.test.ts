import { describe, it, expect, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessKey, makeAccessToken, accessHeaders } from "./helpers/access";
import { users, auditEvents } from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const db = () => drizzle(env.DB);
const accessKey = () => (globalThis as any).__testAccessKey;

afterEach(async () => {
  await db().delete(auditEvents);
  await db().delete(users);
});

describe("staff access", () => {
  it("rejects missing token with 403 and no data", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "forbidden" });
  });

  it("rejects invalid signature with 403", async () => {
    const other = await makeAccessKey();
    const token = await makeAccessToken(other.privateKey, { email: "staff@example.com" });
    const res = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it("rejects wrong audience with 403", async () => {
    const token = await makeAccessToken(accessKey().privateKey, {
      email: "staff@example.com",
      aud: "other-audience",
    });
    const res = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it("rejects wrong issuer with 403", async () => {
    const token = await makeAccessToken(accessKey().privateKey, {
      email: "staff@example.com",
      iss: "https://evil.example.com",
    });
    const res = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
  });

  it("provisions allowlisted staff on first login and records login event", async () => {
    const token = await makeAccessToken(accessKey().privateKey, { email: "Staff@Example.com" });
    const res = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    expect(res.status).toBe(200);
    const me = (await res.json()) as { id: string; email: string };
    expect(me.email).toBe("staff@example.com");

    const rows = await db().select().from(users).where(eq(users.email, "staff@example.com"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("staff");

    const events = await db().select().from(auditEvents).where(eq(auditEvents.action, "login"));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(me.id);
    expect(events[0]!.channel).toBe("manual");
  });

  it("reuses the user record on repeat login", async () => {
    const token = await makeAccessToken(accessKey().privateKey, { email: "staff@example.com" });
    const res1 = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    const me1 = (await res1.json()) as { id: string };
    const res2 = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    const me2 = (await res2.json()) as { id: string };
    expect(me2.id).toBe(me1.id);
    const rows = await db().select().from(users).where(eq(users.email, "staff@example.com"));
    expect(rows).toHaveLength(1);
  });

  it("denies non-allowlisted email with 403 and records access_denied", async () => {
    const token = await makeAccessToken(accessKey().privateKey, { email: "outsider@example.com" });
    const res = await SELF.fetch("https://example.com/api/me", { headers: accessHeaders(token) });
    expect(res.status).toBe(403);
    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "access_denied"));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorEmail).toBe("outsider@example.com");
  });
});

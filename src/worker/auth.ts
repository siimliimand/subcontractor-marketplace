import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { users } from "./db/schema";
import { auditEventStatement } from "./events";
import type { AppEnv } from "./app";

export type AccessUser = {
  id: string;
  email: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export function staffAllowlist(bindings: AppEnv["Bindings"]): string[] {
  const raw = bindings.STAFF_ALLOWLIST ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireStaff(c: Context<AppEnv>, next: Next) {
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  const db = drizzle(c.env.DB);

  if (!token || !teamDomain || !audience) {
    return c.json({ error: "forbidden" }, 403);
  }

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience,
    });
    claims = payload as Record<string, unknown>;
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email) {
    return c.json({ error: "forbidden" }, 403);
  }

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing.length === 0) {
    if (!staffAllowlist(c.env).includes(email)) {
      await db.batch([
        auditEventStatement(db, {
          actorUserId: "anonymous",
          actorEmail: email,
          entity: "auth",
          action: "access_denied",
          payload: { reason: "not_allowlisted" },
        }),
      ]);
      return c.json({ error: "forbidden" }, 403);
    }
    const inserted = await db
      .insert(users)
      .values({ email, role: "staff", lastLoginAt: new Date().toISOString() })
      .returning();
    const user = inserted[0]!;
    await db.batch([
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: email,
        entity: "auth",
        action: "login",
        payload: { provisioned: true },
      }),
    ]);
    c.set("user", { id: user.id, email });
    return next();
  }

  const user = existing[0]!;
  if (user.role !== "staff") {
    await db.batch([
      auditEventStatement(db, {
        actorUserId: user.id,
        actorEmail: email,
        entity: "auth",
        action: "access_denied",
        payload: { reason: "not_staff" },
      }),
    ]);
    return c.json({ error: "forbidden" }, 403);
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(users.id, user.id));
  c.set("user", { id: user.id, email });
  return next();
}

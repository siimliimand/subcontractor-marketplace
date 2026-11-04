import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { providerUserTokens, providerUsers, type ProviderUserRole } from "./db/schema";

/**
 * Phase 4 provider accounts: named people per company with roles,
 * authenticated exclusively through single-use expiring email tokens — the
 * same pattern as the outreach token flows, with no passwords anywhere.
 * Sessions are short-lived HMAC-signed cookies.
 *
 * Errors are deliberately generic: a disabled user's token is
 * indistinguishable from an invalid one.
 */

export const PROVIDER_TOKEN_PURPOSES = ["provider_invite", "provider_login"] as const;
export type ProviderTokenPurpose = (typeof PROVIDER_TOKEN_PURPOSES)[number];

const TOKEN_TTL_SECONDS = 3 * 24 * 3_600; // invite/login links: 3 days
export const SESSION_TTL_SECONDS = 12 * 3_600; // cookie session: 12 hours

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

/** Constant-time equality for signature comparisons. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The stored `jti` is the secret-keyed hash of the raw token — the raw
 * value itself lives only in the invite/login link. */
export async function hashProviderToken(raw: string, secret: string): Promise<string> {
  return hmac(secret, `ptoken:${raw}`);
}

export function tokenExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000).toISOString();
}

export async function issueProviderToken(
  db: DrizzleD1Database,
  input: { userId: string; purpose: ProviderTokenPurpose; secret: string; now?: Date },
): Promise<{ raw: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const raw = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = tokenExpiry(now);
  await db.insert(providerUserTokens).values({
    userId: input.userId,
    jti: await hashProviderToken(raw, input.secret),
    purpose: input.purpose,
    expiresAt,
  });
  return { raw, expiresAt };
}

export type ConsumedToken = { userId: string; purpose: ProviderTokenPurpose };

/**
 * Single-use consume: look the presented token up by its hash; expired,
 * used, and unknown tokens are rejected uniformly (generic upstream).
 * Marks the row used on success.
 */
export async function consumeProviderToken(
  db: DrizzleD1Database,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<ConsumedToken | null> {
  const hashed = await hashProviderToken(token, secret);
  const row = (
    await db.select().from(providerUserTokens).where(eq(providerUserTokens.jti, hashed)).limit(1)
  )[0];
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt <= now.toISOString()) return null;
  if (!PROVIDER_TOKEN_PURPOSES.includes(row.purpose as ProviderTokenPurpose)) return null;
  await db
    .update(providerUserTokens)
    .set({ usedAt: now.toISOString() })
    .where(eq(providerUserTokens.id, row.id));
  return { userId: row.userId, purpose: row.purpose as ProviderTokenPurpose };
}

// --- HMAC session cookies ---

export type ProviderSession = { userId: string; companyId: string; role: ProviderUserRole; exp: number };

export async function signSession(
  session: Omit<ProviderSession, "exp">,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const payload: ProviderSession = {
    ...session,
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifySession(
  cookie: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): Promise<ProviderSession | null> {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const expected = await hmac(secret, body);
  if (!safeEqual(expected, cookie.slice(dot + 1))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as ProviderSession;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.companyId !== "string" ||
      !["owner", "coordinator"].includes(parsed.role) ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp * 1000 <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The session's user must still exist and be active in the same company —
 * a disabled user's session dies on their next request (generic rejection). */
export async function resolveActiveProviderUser(db: DrizzleD1Database, session: ProviderSession) {
  const user = (
    await db.select().from(providerUsers).where(eq(providerUsers.id, session.userId)).limit(1)
  )[0];
  if (!user || user.status !== "active" || user.companyId !== session.companyId) return null;
  if (!["owner", "coordinator"].includes(user.role)) return null;
  return user;
}

/** Lazy cleanup of dead provider tokens (outreach-token retention policy). */
export async function purgeProviderTokens(
  db: DrizzleD1Database,
  now: Date,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3_600_000).toISOString();
  const result = await db.run(
    sql`DELETE FROM provider_user_tokens WHERE expiresAt < ${cutoff}`,
  );
  return result.meta.changes ?? 0;
}

import type { EmailTokenPurpose } from "../db/schema";

export const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 3_600;

const TOKEN_VERSION = 1;

type TokenPayload = {
  v: number;
  jti: string;
  e: string;
  p: EmailTokenPurpose;
  exp: number;
};

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

export function tokenTtlSeconds(env: { EMAIL_TOKEN_TTL_SECONDS?: string }): number {
  const parsed = Number(env.EMAIL_TOKEN_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_SECONDS;
}

export async function signToken(
  input: { jti: string; outreachEntryId: string; purpose: EmailTokenPurpose },
  secret: string,
  expiresAtIso: string,
): Promise<string> {
  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    jti: input.jti,
    e: input.outreachEntryId,
    p: input.purpose,
    exp: Math.floor(new Date(expiresAtIso).getTime() / 1_000),
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export type VerifiedToken = {
  jti: string;
  outreachEntryId: string;
  purpose: EmailTokenPurpose;
  expiresAt: number;
};

export async function verifyToken(token: string, secret: string): Promise<VerifiedToken | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: Uint8Array;
  try {
    const key = await hmacKey(secret);
    expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  } catch {
    return null;
  }
  let provided: Uint8Array;
  try {
    provided = base64UrlToBytes(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ provided[i]!;
  if (diff !== 0) return null;

  let payload: TokenPayload;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
    if (
      parsed?.v !== TOKEN_VERSION ||
      typeof parsed.jti !== "string" ||
      typeof parsed.e !== "string" ||
      typeof parsed.exp !== "number" ||
      !["accept", "quote", "decline", "track"].includes(parsed.p)
    ) {
      return null;
    }
    payload = parsed as TokenPayload;
  } catch {
    return null;
  }
  return {
    jti: payload.jti,
    outreachEntryId: payload.e,
    purpose: payload.p,
    expiresAt: payload.exp,
  };
}

export function tokenExpired(verified: VerifiedToken, nowMs = Date.now()): boolean {
  return verified.expiresAt * 1_000 <= nowMs;
}

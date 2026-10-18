import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  signToken,
  tokenExpired,
  tokenTtlSeconds,
  verifyToken,
} from "../src/worker/email/tokens";

const SECRET = "test-secret";
const FUTURE = new Date(Date.now() + 7 * 24 * 3_600 * 1_000).toISOString();
const PAST = new Date(Date.now() - 60 * 1_000).toISOString();

describe("email tokens", () => {
  it("sign/verify roundtrip preserves jti, entry id and purpose", async () => {
    for (const purpose of ["accept", "quote", "decline", "track"] as const) {
      const token = await signToken(
        { jti: "jti-1", outreachEntryId: "entry-1", purpose },
        SECRET,
        FUTURE,
      );
      const verified = await verifyToken(token, SECRET);
      expect(verified).not.toBeNull();
      expect(verified!.jti).toBe("jti-1");
      expect(verified!.outreachEntryId).toBe("entry-1");
      expect(verified!.purpose).toBe(purpose);
      expect(tokenExpired(verified!)).toBe(false);
    }
  });

  it("expired token is detected", async () => {
    const token = await signToken(
      { jti: "jti-2", outreachEntryId: "entry-2", purpose: "accept" },
      SECRET,
      PAST,
    );
    const verified = await verifyToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(tokenExpired(verified!)).toBe(true);
    expect(tokenExpired(verified!, 0)).toBe(false);
  });

  it("tampered signature is rejected", async () => {
    const token = await signToken(
      { jti: "jti-3", outreachEntryId: "entry-3", purpose: "quote" },
      SECRET,
      FUTURE,
    );
    const [body, sig] = token.split(".");
    const flipped = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    expect(await verifyToken(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it("tampered payload is rejected", async () => {
    const token = await signToken(
      { jti: "jti-4", outreachEntryId: "entry-4", purpose: "decline" },
      SECRET,
      FUTURE,
    );
    const [body, sig] = token.split(".");
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as { jti: string };
    payload.jti = "forged-jti";
    const forgedBody = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyToken(`${forgedBody}.${sig}`, SECRET)).toBeNull();
  });

  it("garbage strings are rejected", async () => {
    expect(await verifyToken("", SECRET)).toBeNull();
    expect(await verifyToken("garbage", SECRET)).toBeNull();
    expect(await verifyToken("a.b", SECRET)).toBeNull();
    expect(await verifyToken("....", SECRET)).toBeNull();
  });

  it("wrong secret is rejected", async () => {
    const token = await signToken(
      { jti: "jti-5", outreachEntryId: "entry-5", purpose: "accept" },
      SECRET,
      FUTURE,
    );
    expect(await verifyToken(token, "other-secret")).toBeNull();
  });

  it("unknown purposes are rejected by verify", async () => {
    const payload = {
      v: 1,
      jti: "jti-6",
      e: "entry-6",
      p: "unsubscribe",
      exp: Math.floor(Date.now() / 1_000) + 3_600,
    };
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const token = `${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}`;
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it("tokenTtlSeconds defaults to 7 days and parses EMAIL_TOKEN_TTL_SECONDS", () => {
    expect(DEFAULT_TOKEN_TTL_SECONDS).toBe(604800);
    expect(tokenTtlSeconds({})).toBe(604800);
    expect(tokenTtlSeconds({ EMAIL_TOKEN_TTL_SECONDS: "3600" })).toBe(3600);
    expect(tokenTtlSeconds({ EMAIL_TOKEN_TTL_SECONDS: "nope" })).toBe(604800);
    expect(tokenTtlSeconds({ EMAIL_TOKEN_TTL_SECONDS: "-5" })).toBe(604800);
    expect(tokenTtlSeconds({ EMAIL_TOKEN_TTL_SECONDS: "0" })).toBe(604800);
  });
});

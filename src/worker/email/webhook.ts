import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../app";
import { applyEmailLifecycleEvent, classifyLifecycleType, parseBody } from "./events";

// ---------------------------------------------------------------------------
// SUBC-011: secret-gated webhook receiver for email delivery lifecycle
// events. Cloudflare Email Service has no lifecycle-event → Queue routing,
// so this endpoint lets events enter the system today (manual ops path via
// curl, or any future provider-side routing) and applies them through the
// same shared, idempotent lifecycle applier as the queue consumer.
//
// Public route (outside the Access guard — same tier as /e/*, /t/*, /u/*),
// authenticated by a shared bearer secret compared in constant time. An
// unset secret fails CLOSED: the endpoint reports disabled in every
// environment, never open.
// ---------------------------------------------------------------------------

type PublicEnv = { Bindings: Bindings };

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Constant-time equality: SHA-256 both sides (equalizing length/hamming
 * leakage) then XOR-accumulate the digests.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= va[i]! ^ vb[i]!;
  }
  return diff === 0;
}

export function createWebhookApp() {
  const app = new Hono<PublicEnv>();

  app.post("/hooks/email-events", async (c) => {
    const secret = c.env.EMAIL_EVENTS_WEBHOOK_SECRET;
    if (!secret) {
      // Fail closed: without a configured secret there is no open endpoint.
      return c.json({ error: "email_events_webhook_disabled" }, 401);
    }
    const presented = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    if (presented === "" || !(await timingSafeEqual(presented, secret))) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const events: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

    const db = drizzle(c.env.DB);
    let accepted = 0;
    let skipped = 0;
    for (const item of events) {
      // Per-event isolation: one bad event never fails the rest.
      try {
        const body = parseBody(item);
        const kind = body ? classifyLifecycleType(body.type) : null;
        if (!body || !kind) {
          skipped++;
          continue;
        }
        const applied = await applyEmailLifecycleEvent(db, {
          kind,
          to: body.to,
          sendId: body.sendId,
          permanent: body.permanent,
          source: "webhook",
        });
        if (applied) accepted++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
    return c.json({ accepted, skipped }, accepted > 0 ? 202 : 200);
  });

  return app;
}

export const webhookApp = createWebhookApp();

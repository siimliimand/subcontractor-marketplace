import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { outreachEntries, requests } from "../db/schema";
import type { AppEnv } from "../app";
import { DailyLimitError, sendOutreachEmailBatch } from "../email/sender";

export const emailOutreachRouter = new Hono<AppEnv>();

emailOutreachRouter.post("/requests/:id/outreach/email", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const requestId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  if (!c.env.EMAIL_TOKEN_SECRET) {
    return c.json({ error: "email_not_configured: EMAIL_TOKEN_SECRET missing" }, 500);
  }
  if (!c.env.SEND_EMAIL) {
    return c.json({ error: "email_not_configured: SEND_EMAIL binding missing" }, 500);
  }

  const providerIds = Array.isArray(b.providerIds) ? b.providerIds : [];
  if (providerIds.length === 0 || !providerIds.every((p) => typeof p === "string"))
    return c.json({ error: "provider_ids_required" }, 400);

  const request = (
    await db.select().from(requests).where(eq(requests.id, requestId)).limit(1)
  )[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (["booked", "cancelled", "closed"].includes(request.status))
    return c.json({ error: `request_is_${request.status}: closed for outreach` }, 400);

  try {
    const outcome = await sendOutreachEmailBatch(c.env, {
      requestId,
      providerIds: providerIds as string[],
      staffUserId: user.id,
      staffEmail: user.email,
      appBaseUrl: new URL(c.req.url).origin,
    });
    return c.json(
      {
        sent: outcome.sent.map((s) => s.companyId),
        skipped: outcome.skipped,
        requestStatus: request.status,
      },
      outcome.sent.length > 0 ? 201 : 400,
    );
  } catch (err) {
    if (err instanceof DailyLimitError) {
      return c.json({ error: err.message, limit: err.limit, sentToday: err.sentToday }, 400);
    }
    const message = err instanceof Error ? err.message : "email_send_failed";
    if (message.startsWith("request_is_")) return c.json({ error: message }, 400);
    return c.json({ error: message }, 500);
  }
});

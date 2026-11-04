import { createApp } from "./app";
import type { AppEnv } from "./app";
import { publicApp } from "./email/public";
import { handleEmailEventBatch } from "./email/events";
import { webhookApp } from "./email/webhook";
import { handleInboundEmail } from "./email/inbound";
import { resolveStaleSentEmails } from "./email/resolve";
import { providerPortal } from "./providerPortal";
import { widenTimedOutRequests } from "./cron/widening";
import { purgeExpiredArtifacts } from "./cron/retention";
import { fetchCalendarFeeds } from "./cron/calendar";
import { drizzle } from "drizzle-orm/d1";

const app = createApp();

/**
 * Scheduled jobs (SUBC-011: cron now fires every 5 minutes):
 * - EVERY invocation: the stale-sent email resolution sweep, so delivery
 *   states settle within ~15 minutes (10-minute window + 5-minute sweep).
 * - Hourly set (gated on minute 0 so the every-5-minute cadence leaves their
 *   hourly cadence unchanged): timeout-triggered outreach widening, the
 *   retention purge, and calendar feed fetching. All logic lives in the cron
 *   modules so tests invoke them directly (the pinned vitest-pool-workers
 *   miniflare does not run scheduled handlers).
 */
async function runScheduledJobs(env: AppEnv["Bindings"], opts?: { now?: Date }) {
  const now = opts?.now ?? new Date();
  const db = drizzle(env.DB);

  // Sweep on every tick — push paths (webhook/inbound/queue) are instant,
  // this one covers the no-signal-at-all case.
  const resolved = await resolveStaleSentEmails(db, {
    now,
    resolveAfterMinutes: Number(env.EMAIL_RESOLVE_AFTER_MINUTES ?? "10"),
  });
  if (resolved.length > 0) {
    console.log(
      JSON.stringify({
        cron: "email-resolution",
        resolved: resolved.length,
        entryIds: resolved,
        at: now.toISOString(),
      }),
    );
  }

  // Hourly set: only on the top of the hour.
  const hourly = now.getUTCMinutes() === 0;
  const widened = hourly
    ? await widenTimedOutRequests(db, {
        now,
        timeoutHours: Number(env.WIDENING_TIMEOUT_HOURS ?? "8"),
        actor: null,
      })
    : [];
  const purged = hourly
    ? await purgeExpiredArtifacts(db, {
        now,
        tokenRetentionDays: Number(env.RETENTION_TOKEN_DAYS ?? "30"),
        holdRetentionDays: Number(env.RETENTION_HOLD_DAYS ?? "90"),
        intervalRetentionDays: Number(env.CALENDAR_PURGE_DAYS ?? "14"),
      })
    : { tokensDeleted: 0, holdsDeleted: 0, intervalsDeleted: 0 };
  const calendar =
    hourly && env.CALENDAR_FETCH_ENABLED !== "false"
      ? await fetchCalendarFeeds(db, { now })
      : null;
  if (
    widened.length > 0 ||
    purged.tokensDeleted > 0 ||
    purged.holdsDeleted > 0 ||
    purged.intervalsDeleted > 0 ||
    (calendar && calendar.fetched > 0)
  ) {
    console.log(
      JSON.stringify({ cron: "hourly", widened, purged, calendar, at: now.toISOString() }),
    );
  }
  return { widened, purged, calendar, resolved };
}

export default {
  async fetch(request: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    const url = new URL(request.url);
    const { pathname } = url;
    // Public token routes live outside the Access guard and must be matched
    // before every other branch.
    if (pathname.startsWith("/u/")) {
      return providerPortal.fetch(request, env, ctx);
    }
    if (pathname.startsWith("/e/") || pathname.startsWith("/t/")) {
      return publicApp.fetch(request, env, ctx);
    }
    // SUBC-011: secret-gated email-event webhook — public tier (bearer auth
    // inside the handler), matched before the Access-guarded /api routes.
    if (pathname.startsWith("/hooks/")) {
      return webhookApp.fetch(request, env, ctx);
    }
    if (pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async queue(
    batch: MessageBatch<unknown>,
    env: AppEnv["Bindings"],
    _ctx: ExecutionContext,
  ) {
    await handleEmailEventBatch(
      env,
      batch.messages.map((m) => ({ id: m.id, body: m.body })),
    );
  },
  /**
   * SUBC-011: inbound email handler for Cloudflare Email Routing. Bounce
   * DSNs sent back to our envelope addresses on the sending subdomain are
   * routed here (dashboard setup — README "Email pipeline") and parsed for
   * explicit RFC 3464 failures. Never throws: inbound lifecycle signals are
   * additive (queue-consumer semantics).
   *
   * Minimal structural type: `raw`/`rawSize` are the only fields read, so
   * the handler stays green even when ambient ForwardableEmailMessage types
   * drift.
   */
  async email(
    message: { raw: ReadableStream<Uint8Array>; rawSize: number },
    env: AppEnv["Bindings"],
    _ctx: ExecutionContext,
  ) {
    const MAX_INBOUND_BYTES = 256 * 1024;
    try {
      if (message.rawSize > MAX_INBOUND_BYTES) return; // oversized → abort
      const raw = await new Response(message.raw).text();
      const result = await handleInboundEmail(env, raw);
      if (result) {
        console.log(JSON.stringify({ inbound: result, at: new Date().toISOString() }));
      }
    } catch {
      // Swallow: an unparseable inbound message is never blocking.
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: AppEnv["Bindings"],
    _ctx: ExecutionContext,
  ) {
    await runScheduledJobs(env, {
      now: new Date(controller.scheduledTime ?? Date.now()),
    });
  },
};

export { runScheduledJobs };

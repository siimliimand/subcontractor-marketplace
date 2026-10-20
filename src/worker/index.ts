import { createApp } from "./app";
import type { AppEnv } from "./app";
import { publicApp } from "./email/public";
import { handleEmailEventBatch } from "./email/events";
import { providerPortal } from "./providerPortal";
import { widenTimedOutRequests } from "./cron/widening";
import { purgeExpiredArtifacts } from "./cron/retention";
import { fetchCalendarFeeds } from "./cron/calendar";
import { drizzle } from "drizzle-orm/d1";

const app = createApp();

/**
 * Phase 3/4 cron (hourly): timeout-triggered outreach widening, the retention
 * purge, and calendar feed fetching. All logic lives in the cron modules so
 * tests invoke them directly (the pinned vitest-pool-workers miniflare does
 * not run scheduled handlers).
 */
async function runScheduledJobs(env: AppEnv["Bindings"]) {
  const now = new Date();
  const db = drizzle(env.DB);
  const widened = await widenTimedOutRequests(db, {
    now,
    timeoutHours: Number(env.WIDENING_TIMEOUT_HOURS ?? "8"),
    actor: null,
  });
  const purged = await purgeExpiredArtifacts(db, {
    now,
    tokenRetentionDays: Number(env.RETENTION_TOKEN_DAYS ?? "30"),
    holdRetentionDays: Number(env.RETENTION_HOLD_DAYS ?? "90"),
    intervalRetentionDays: Number(env.CALENDAR_PURGE_DAYS ?? "14"),
  });
  const calendar =
    env.CALENDAR_FETCH_ENABLED === "false"
      ? null
      : await fetchCalendarFeeds(db, { now });
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
  return { widened, purged, calendar };
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
  async scheduled(
    _controller: ScheduledController,
    env: AppEnv["Bindings"],
    _ctx: ExecutionContext,
  ) {
    await runScheduledJobs(env);
  },
};

export { runScheduledJobs };

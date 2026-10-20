import { Hono } from "hono";
import { requireStaff, type AccessUser } from "./auth";
import { providersRouter } from "./routes/providers";
import { requestsRouter } from "./routes/requests";
import { outreachRouter } from "./routes/outreach";
import { matchingRouter } from "./routes/matching";
import { bookingRouter } from "./routes/bookingRequests";
import { emailOutreachRouter } from "./routes/emailOutreach";
import { effortRouter } from "./routes/effort";
import { dashboardRouter } from "./routes/dashboard";
import { briefsRouter } from "./routes/briefs";
import { suppressionRouter } from "./routes/suppression";
import { catalogRouter } from "./routes/catalog";
import { calendarRouter } from "./routes/calendar";
import { reviewsRouter } from "./routes/reviews";
import { pilotRouter } from "./routes/pilot";
import { plannerRouter } from "./routes/planner";
import { auditExportRouter } from "./routes/auditExport";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD?: string;
  STAFF_ALLOWLIST?: string;
  SEND_EMAIL?: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<void>;
  };
  EMAIL_TOKEN_SECRET?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_TOKEN_TTL_SECONDS?: string;
  // Phase 2: 48-hour holds feature flag ("true" enables hold routes).
  BOOKING_HOLDS_ENABLED?: string;
  // Phase 3: hours a matching batch may sit silent before the cron widens it
  // once toward 10 (default 8).
  WIDENING_TIMEOUT_HOURS?: string;
  // Phase 3: retention windows for the cron purge, in days (defaults 30/90).
  RETENTION_TOKEN_DAYS?: string;
  RETENTION_HOLD_DAYS?: string;
  // Phase 3: MTR/Tarvik trade-notification badge display gate — stays off
  // until the TTJA licence confirmation is recorded.
  MTR_BADGES_ENABLED?: string;
  // Phase 4: ICS calendar fetching (default on), staleness window (days),
  // purge window for stale intervals (days), and per-company feed cap.
  CALENDAR_FETCH_ENABLED?: string;
  CALENDAR_STALE_DAYS?: string;
  CALENDAR_PURGE_DAYS?: string;
  MAX_FEEDS_PER_COMPANY?: string;
  // Phase 4: monetization pilot master switch — off means zero gating.
  MONETIZATION_PILOT_ENABLED?: string;
  // Phase 4: planner AI master switch (default off) — demand-gated track.
  PLANNER_AI_ENABLED?: string;
  // Phase 4: HMAC secret for provider-user session cookies.
  PROVIDER_SESSION_SECRET?: string;
  // Phase 2: Workers AI binding for the brief builder.
  AI?: {
    run(model: string, inputs: unknown): Promise<unknown>;
  };
};

export type AppEnv = { Bindings: Bindings; Variables: { user: AccessUser } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  app.use("/api/*", requireStaff);

  app.get("/api/me", (c) => c.json(c.get("user")));

  app.route("/api/providers", providersRouter);
  app.route("/api/requests", requestsRouter);
  app.route("/api", outreachRouter);
  app.route("/api", matchingRouter);
  app.route("/api", bookingRouter);
  app.route("/api", briefsRouter);
  app.route("/api", emailOutreachRouter);
  app.route("/api", effortRouter);
  app.route("/api/dashboard", dashboardRouter);
  app.route("/api", suppressionRouter);
  app.route("/api", catalogRouter);
  app.route("/api", calendarRouter);
  app.route("/api", reviewsRouter);
  app.route("/api", pilotRouter);
  app.route("/api", plannerRouter);
  app.route("/api", auditExportRouter);

  return app;
}

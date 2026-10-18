import { Hono } from "hono";
import { requireStaff, type AccessUser } from "./auth";
import { providersRouter } from "./routes/providers";
import { requestsRouter } from "./routes/requests";
import { outreachRouter } from "./routes/outreach";
import { effortRouter } from "./routes/effort";
import { dashboardRouter } from "./routes/dashboard";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD?: string;
  STAFF_ALLOWLIST?: string;
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
  app.route("/api", effortRouter);
  app.route("/api/dashboard", dashboardRouter);

  return app;
}

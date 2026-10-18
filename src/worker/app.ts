import { Hono } from "hono";
import { requireStaff, type AccessUser } from "./auth";

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

  return app;
}

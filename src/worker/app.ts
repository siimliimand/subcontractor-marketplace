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

  app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString(), dbg: { td: !!c.env.ACCESS_TEAM_DOMAIN, aud: c.env.ACCESS_AUD ?? null, al: c.env.STAFF_ALLOWLIST ?? null } }));

  app.use("/api/*", requireStaff);

  app.get("/api/me", (c) => c.json(c.get("user")));

  return app;
}

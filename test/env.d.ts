import type { Config } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Config.DefaultEnv {
    DB: D1Database;
    ASSETS: Fetcher;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    STAFF_ALLOWLIST: string;
  }
}

import type { Config } from "@cloudflare/vitest-pool-workers";
import type { makeAccessKey } from "./helpers/access";

type TestAccessKey = Awaited<ReturnType<typeof makeAccessKey>>;

declare global {
  // Set by test/apply-migrations.ts (vitest setupFiles) before any test
  // runs: the ES256 key pair used to mint Cf-Access JWTs. Declared
  // non-optional because setup guarantees existence by test time.
  var __testAccessKey: TestAccessKey;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Config.DefaultEnv {
    DB: D1Database;
    ASSETS: Fetcher;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    STAFF_ALLOWLIST: string;
    EMAIL_TOKEN_SECRET: string;
    EMAIL_FROM: string;
    EMAIL_DAILY_LIMIT: string;
  }
}

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
            ACCESS_AUD: "test-audience",
            STAFF_ALLOWLIST: "staff@example.com,lead@example.com",
          },
          d1Databases: ["DB"],
        },
      },
    },
  },
});

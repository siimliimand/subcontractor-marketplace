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
            EMAIL_TOKEN_SECRET:
              "f9c790f94f4775272624a1a95fb63096455bcceba53798801629eaa4d80f55f1",
            EMAIL_FROM: "Subcrew Test <outreach@test.example>",
            EMAIL_DAILY_LIMIT: "10",
          },
          d1Databases: ["DB"],
          // NOTE: miniflare 3.20241230.0 (pinned by vitest-pool-workers 0.5)
          // does not implement sendEmail bindings; this option is future-proofing.
          sendEmail: [{ name: "SEND_EMAIL" }],
        },
      },
    },
  },
});

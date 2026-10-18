import { beforeAll } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import migration0 from "../migrations/0000_init.sql?raw";
import migration1 from "../migrations/0001_fix_indexes.sql?raw";
import migration2 from "../migrations/0002_email_pipeline.sql?raw";
import { makeAccessKey, TEAM_DOMAIN } from "./helpers/access";

function toStatements(sql: string): string[] {
  // drizzle-kit emits "--> statement-breakpoint" both on its own line (older
  // format) and inline right after the terminating ";" (newer format).
  // Normalise both to ";" so every statement is split out individually.
  return sql
    .replace(/;?\s*--> statement-breakpoint/g, ";\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS _test_migrations (tag TEXT PRIMARY KEY)",
  ).run();
  const applied = new Set(
    (
      await env.DB.prepare("SELECT tag FROM _test_migrations").all<{ tag: string }>()
    ).results.map((r) => r.tag),
  );
  const migrations: [string, string][] = [
    ["0000_init", migration0],
    ["0001_fix_indexes", migration1],
    ["0002_email_pipeline", migration2],
  ];
  for (const [tag, sqlText] of migrations) {
    if (applied.has(tag)) continue;
    for (const stmt of toStatements(sqlText)) {
      await env.DB.prepare(stmt).run();
    }
    await env.DB.prepare("INSERT INTO _test_migrations (tag) VALUES (?)").bind(tag).run();
  }

  const key = await makeAccessKey();
  (globalThis as any).__testAccessKey = key;
  fetchMock.activate();
  fetchMock.get(TEAM_DOMAIN).intercept({ path: "/cdn-cgi/access/certs" }).reply(
    200,
    JSON.stringify({ keys: [key.publicJwk] }),
    { headers: { "Content-Type": "application/json" } },
  ).persist();
});

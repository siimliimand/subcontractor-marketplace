import { beforeAll } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import migration0 from "../migrations/0000_init.sql?raw";
import migration1 from "../migrations/0001_fix_indexes.sql?raw";
import { makeAccessKey, TEAM_DOMAIN } from "./helpers/access";

function toStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("-->"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  const existing = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  ).all();
  if (existing.results.length === 0) {
    for (const stmt of [...toStatements(migration0), ...toStatements(migration1)]) {
      await env.DB.prepare(stmt).run();
    }
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

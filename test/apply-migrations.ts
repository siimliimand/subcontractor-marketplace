import { beforeAll } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import migration0 from "../migrations/0000_init.sql?raw";
import migration1 from "../migrations/0001_fix_indexes.sql?raw";
import migration2 from "../migrations/0002_email_pipeline.sql?raw";
import migration3 from "../migrations/0003_phase2_multitrade_availability.sql?raw";
import migration4 from "../migrations/0004_phase2_booking_hardening.sql?raw";
import migration5 from "../migrations/0005_phase2_brief_proposals.sql?raw";
import migration6 from "../migrations/0006_phase3_pilot.sql?raw";
import migration7 from "../migrations/0007_phase4_expansion.sql?raw";
import { makeAccessKey, TEAM_DOMAIN } from "./helpers/access";

function toStatements(sql: string): string[] {
  // drizzle-kit emits "--> statement-breakpoint" both on its own line (older
  // format) and inline right after the terminating ";" (newer format).
  // Normalise both to ";" so every statement is split out individually.
  const text = sql.replace(/;?\s*--> statement-breakpoint/g, ";\n");
  // Split on ";", but keep CREATE TRIGGER bodies intact (a semicolon inside a
  // BEGIN...END block does not terminate the statement) and ignore semicolons,
  // quotes and keywords inside "--" line comments.
  const statements: string[] = [];
  let buf = "";
  let depth = 0;
  let inString = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inComment) {
      buf += ch;
      if (ch === "\n") inComment = false;
      continue;
    }
    if (ch === "'") {
      inString = !inString;
      buf += ch;
      continue;
    }
    if (inString) {
      buf += ch;
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      inComment = true;
      buf += ch;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const m = /^(BEGIN|END)\b/i.exec(text.slice(i));
      if (m) {
        if (m[1]!.toUpperCase() === "BEGIN") depth++;
        else depth = Math.max(0, depth - 1);
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    buf += ch;
    if (ch === ";" && depth === 0) {
      const s = buf.trim();
      if (s) statements.push(s);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
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
    ["0003_phase2_multitrade_availability", migration3],
    ["0004_phase2_booking_hardening", migration4],
    ["0005_phase2_brief_proposals", migration5],
    ["0006_phase3_pilot", migration6],
    ["0007_phase4_expansion", migration7],
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

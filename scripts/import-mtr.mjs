#!/usr/bin/env node
/**
 * Phase 3 — MTR/Tarvik trade-notification badge import (OFFLINE).
 *
 * Reads the TTJA MTR open-data XML (https://mtr.ttja.ee/opendata/avaandmed_ettevotjad.xml,
 * licence per metadata: CC BY-SA 3.0 — ⚠ pending founder's TTJA confirmation,
 * see docs/phase0/register-findings.md follow-up #1) and emits idempotent SQL
 * upserting `company_verifications` rows of type `trade_notification` per
 * (company, trade), matched by registrationIdentifier.
 *
 * NO RUNTIME REGISTER API CALLS.
 *
 * DISPLAY GATE: imported rows are visible to staff via
 * GET /api/providers/:id/verifications, but the badge only renders in
 * PM-facing views when MTR_BADGES_ENABLED=true — keep it off until the TTJA
 * licence confirmation is recorded.
 *
 * All parsing/planning lives in scripts/import-mtr-lib.mjs (workerd-safe,
 * unit-tested). This CLI only handles argv, file I/O, stdout/stderr and the
 * exit-code contract:
 *   0 — plan emitted (upserts and/or explicitly forced expire; --dry-run
 *       always emits a READ-ONLY diagnostics bundle, never INSERT/UPDATE)
 *   1 — zero-upsert guard triggered (a guarded dry-run still prints the
 *       read-only diagnostics before exiting; see --force-expire)
 *   1 — unparseable file / missing undertakers / usage error
 *
 * ZERO-UPSERT GUARD (SUBC-015): when the export yields zero upserts (format
 * drift), NO expire-all UPDATE is emitted — a drifted file must never flip
 * every mtr:% trade_notification row to 'invalid' in one pass. Re-running
 * with --force-expire emits the expire UPDATE anyway (audited via a WARNING
 * comment in the SQL and a stderr note).
 *
 * DRY-RUN (--dry-run, SUBC-029): emits ONLY read-only diagnostics — current
 * mtr:% trade_notification row counts by status, the exact rows the expire
 * UPDATE would flip, and how many matched undertakers exist in companies —
 * followed by a projection summary. Structurally contains no INSERT/UPDATE
 * for any input; --force-expire is ignored under --dry-run (with a warning).
 *
 * Usage:
 *   node scripts/import-mtr.mjs <file.xml> [--dataset <label>] [--force-expire] [--dry-run] > import-mtr.sql
 *   wrangler d1 execute cockpit-staging -e staging --remote --file import-mtr.sql
 *
 * XML layouts understood (fast-xml-parser, tolerant path resolution): the
 * file contains undertaker entries ("ettevotja") each with a registry code
 * ("registriKood"/"registrikood"/"kood") and either legacy activity notices
 * ("teatis"/"teatised" with an EMTAK "kood"/"tegevusala") or, since the
 * 2026-11 export, licences ("load"/"luba") carrying <staatus>kehtiv</staatus>
 * plus <emtak>/<emtak2025> EMTAK code lists. A licence counts as valid when
 * staatus is "kehtiv" (when present) AND no end date is present or it is in
 * the future (kehtiv_kuni/kehtivKuni; xsi:nil is open-ended).
 *
 * EMTAK → cockpit trade mapping (subclass level, construction F section):
 *   43.21 → electrical; 43.22 → plumbing + hvac;
 *   43.31/43.32 → drywall; 43.33 → flooring; 43.34 → painting
 */

import { readFileSync } from "node:fs";
import { argv, stdout, exit } from "node:process";
import { buildImportPlan, planToSql } from "./import-mtr-lib.mjs";

function fail(msg) {
  console.error(`import-mtr: ${msg}`);
  exit(1);
}

const args = argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const datasetFlagIdx = args.indexOf("--dataset");
const dataset = datasetFlagIdx >= 0 ? args[datasetFlagIdx + 1] : undefined;
const forceExpire = args.includes("--force-expire");
const dryRun = args.includes("--dry-run");
if (!file) fail("usage: import-mtr.mjs <file.xml> [--dataset <label>] [--force-expire] [--dry-run]");

let plan;
try {
  plan = buildImportPlan(readFileSync(file, "utf8"), { dataset, forceExpire, dryRun });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

stdout.write(planToSql(plan));

if (plan.guarded) {
  console.error(`import-mtr: ${plan.warnings.join("\nimport-mtr: ")}`);
  console.error("import-mtr: no INSERT/UPDATE emitted — existing mtr:% rows left untouched");
  console.error(
    plan.dryRun
      ? "import-mtr: dry-run: the read-only diagnostics were still emitted above (before-counts) — resolve the drift before importing"
      : "import-mtr: to emit the expire-all UPDATE anyway, re-run with --force-expire",
  );
  exit(1);
}
for (const warning of plan.warnings) {
  console.error(`import-mtr: ${warning}`);
}

#!/usr/bin/env node
/**
 * Phase 3 — Äriregister existence-badge import (OFFLINE).
 *
 * Reads the Äriregister open-data CSV (avaandmed.ariregister.rik.ee,
 * dataset "ettevotja_rekvisiidid" — simple/general data, CC BY 4.0,
 * attribution: RIK avaandmed) and emits idempotent SQL that upserts
 * `company_verifications` rows for companies already in the cockpit D1
 * (matched by `registrationIdentifier` = Äriregistri kood).
 *
 * NO RUNTIME REGISTER API CALLS: the production request path never fetches
 * registers; this staff-run script is the only way register data enters.
 *
 * Usage:
 *   node scripts/import-ariregister.mjs <file.csv> [--dataset <label>] > import-ariregister.sql
 *   wrangler d1 execute cockpit-staging -e staging --remote --file import-ariregister.sql
 *
 * CSV expectations (tolerant header matching, case/underscore-insensitive):
 *   registry code column contains "ariregistrikood" or "kood" or "regcode"
 *   name column        contains "nimi" or "name"
 *   status column      contains "staatus" or "status"  (R = registered & active)
 *   EMTAK column       contains "tegevusala" (optional, informational)
 * Rows whose status is not "R" import as `invalid` (dissolved/liquidated) so
 * a previously-badged company loses its badge on the next import.
 *
 * Re-running against the same snapshot is idempotent (ON CONFLICT upsert);
 * the checkedAt timestamp advances to the import run time.
 */

import { readFileSync } from "node:fs";
import { argv, stdout, exit } from "node:process";

function fail(msg) {
  console.error(`import-ariregister: ${msg}`);
  exit(1);
}

const args = argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const datasetFlagIdx = args.indexOf("--dataset");
const dataset =
  datasetFlagIdx >= 0 ? args[datasetFlagIdx + 1] : `ariregister:ettevotja_rekvisiidid`;
if (!file) fail("usage: import-ariregister.mjs <file.csv> [--dataset <label>]");
const licence = "CC BY 4.0 — data from Äriregister (RIK) open data, avaandmed.ariregister.rik.ee";

function parseCsv(text) {
  // Small RFC-4180-ish parser: quoted fields, doubled quotes, CRLF.
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

const norm = (s) => s.toLowerCase().replace(/[^a-zõäöü]/g, "");

const text = readFileSync(file, "utf8");
const [headerRow, ...dataRows] = parseCsv(text);
if (!headerRow) fail("empty CSV");

const findColumn = (candidates) => {
  const idx = headerRow.findIndex((h) =>
    candidates.some((c) => norm(h).includes(norm(c))),
  );
  if (idx < 0) fail(`could not find a column matching any of: ${candidates.join(", ")}`);
  return idx;
};

const codeIdx = findColumn(["ariregistrikood", "registrikood", "kood", "regcode"]);
const nameIdx = findColumn(["nimi", "name"]);
const statusIdx = findColumn(["staatus", "status"]);
const emtakIdx = headerRow.findIndex((h) => norm(h).includes(norm("tegevusala")));

const sqlEscape = (s) => s.replace(/'/g, "''");
const now = new Date().toISOString();
const checkedAt = sqlEscape(now);
const ds = sqlEscape(dataset);

let matched = 0;
let unmatched = 0;
const statements = [];
statements.push(
  `-- Äriregister import ${now}: dataset ${ds}, ${dataRows.length} CSV rows, licence ${licence}`,
);

for (const row of dataRows) {
  const code = (row[codeIdx] ?? "").trim();
  if (!code || !/^\d{7,9}$/.test(code)) continue;
  const name = (row[nameIdx] ?? "").trim();
  const status = (row[statusIdx] ?? "").trim().toUpperCase();
  const emtak = emtakIdx >= 0 ? (row[emtakIdx] ?? "").trim() : "";
  const active = status === "R" || status === "" ? "valid" : "invalid";
  const detail = JSON.stringify({ name, registryStatus: status, emtak }).replace(/'/g, "''");

  // Only touches companies that exist in the cockpit (registrationIdentifier
  // match). Companies absent from D1 are skipped — they get imported when
  // onboarded, then the next import run badges them.
  const before = matched;
  statements.push(`INSERT INTO company_verifications
  (id, companyId, type, trade, status, checkedAt, sourceDataset, sourceLicence, detailJson)
SELECT lower(hex(randomblob(16))), c.id, 'registry_active', NULL, '${active}', '${checkedAt}', '${ds}', '${sqlEscape(licence)}', '${detail}'
FROM companies c WHERE c.registrationIdentifier = '${sqlEscape(code)}'
ON CONFLICT (companyId, type, COALESCE(trade, '')) DO UPDATE SET
  status = excluded.status,
  checkedAt = excluded.checkedAt,
  sourceDataset = excluded.sourceDataset,
  sourceLicence = excluded.sourceLicence,
  detailJson = excluded.detailJson;`);
  if (active === "valid") matched++;
  if (before === matched && active === "valid") unmatched++;
}

statements.push(`-- summary: ${dataRows.length} rows read, ${matched} valid, ${unmatched} valid-but-unmatched (company not in cockpit yet)`);
stdout.write(statements.join("\n\n") + "\n");

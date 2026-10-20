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
 * Usage:
 *   node scripts/import-mtr.mjs <file.xml> [--dataset <label>] > import-mtr.sql
 *   wrangler d1 execute cockpit-staging -e staging --remote --file import-mtr.sql
 *
 * XML expectations (fast-xml-parser, tolerant path resolution): the file
 * contains undertaker entries ("ettevotja") each with a registry code
 * ("registriKood"/"registrikood"/"kood") and activity notices ("teatis"/
 * "teatised") carrying an EMTAK activity code ("kood"/"emtak"/"tegevusala")
 * and optional validity ("kehtivKuni"/"kehtivusKuni"/"lopukuupaev"). A notice
 * counts as valid when no end date is present or it is in the future.
 *
 * EMTAK → cockpit trade mapping (subclass level, construction F section):
 *   43.21 → electrical; 43.22 → plumbing + hvac;
 *   43.31/43.32 → drywall; 43.33 → flooring; 43.34 → painting
 */

import { readFileSync } from "node:fs";
import { argv, stdout, exit } from "node:process";
import { XMLParser } from "fast-xml-parser";

function fail(msg) {
  console.error(`import-mtr: ${msg}`);
  exit(1);
}

const args = argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const datasetFlagIdx = args.indexOf("--dataset");
const dataset = datasetFlagIdx >= 0 ? args[datasetFlagIdx + 1] : "mtr:avaandmed_ettevotjad";
if (!file) fail("usage: import-mtr.mjs <file.xml> [--dataset <label>]");
const licence =
  "CC BY-SA 3.0 (per open-data metadata) — data from TTJA MTR/Tarvik open data, mtr.ttja.ee — display pending TTJA licence confirmation";

const EMTAK_TO_TRADES = {
  "4321": ["electrical"],
  "4322": ["plumbing", "hvac"],
  "4331": ["drywall"],
  "4332": ["drywall"],
  "4333": ["flooring"],
  "4334": ["painting"],
};

function tradesForEmtak(code) {
  if (!code) return [];
  // Digits only: "43.210", "43210" and "4321 0" all normalise the same way.
  const norm = String(code).replace(/[^0-9]/g, "");
  for (const [prefix, trades] of Object.entries(EMTAK_TO_TRADES)) {
    if (norm.startsWith(prefix)) return trades;
  }
  return [];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => ["ettevotja", "teatis", "tegevusala"].includes(name),
});
const doc = parser.parse(readFileSync(file, "utf8"));

// Locate the undertaker array wherever it sits in the document.
const undertakers = findUndertakers(doc);
if (!undertakers) fail("could not locate undertaker entries (looked for *ettevotja* elements)");

const firstString = (obj, patterns) => {
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (
      patterns.some((p) => new RegExp(p, "i").test(key)) &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return String(value).trim();
    }
  }
  return "";
};

function noticesOf(entry) {
  for (const [key, value] of Object.entries(entry ?? {})) {
    if (!/teatis/i.test(key)) continue;
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      // Wrapper element: <teatised><teatis>…</teatis></teatised>
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (/teatis/i.test(innerKey)) return Array.isArray(innerValue) ? innerValue : [innerValue];
      }
    }
  }
  return [];
}

/**
 * Find the undertaker array anywhere in the document: the first array of
 * objects that looks like undertaker records (registry code / notices).
 */
function findUndertakers(node) {
  if (Array.isArray(node)) {
    const looksRight =
      node.length > 0 &&
      node[0] &&
      typeof node[0] === "object" &&
      Object.keys(node[0]).some((k) => /teatis|registri?kood|^kood$|nimi/i.test(k));
    if (looksRight) return node;
    for (const v of node) {
      const found = findUndertakers(v);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  for (const value of Object.values(node)) {
    const found = findUndertakers(value);
    if (found) return found;
  }
  return null;
}

const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();
const checkedAt = now.replace(/'/g, "''");
const ds = dataset.replace(/'/g, "''");

// (registryCode, trade) → valid?
const perCompany = new Map();
for (const entry of undertakers) {
  const code = firstString(entry, ["registri?kood", "^kood$", "regcode"]);
  if (!code) continue;
  const trades = new Map(); // trade → anyValid
  for (const notice of noticesOf(entry)) {
    // <tegevusala> may parse as an object or a single-element array.
    const tg = notice?.tegevusala;
    const tegevusala = Array.isArray(tg) ? tg[0] : tg;
    const emtak =
      firstString(notice, ["^kood$", "emtak", "tehtavus"]) ||
      firstString(tegevusala, ["^kood$", "emtak"]);
    const forTrades = tradesForEmtak(emtak);
    if (forTrades.length === 0) continue;
    const end = firstString(notice, ["kehtiv.*kuni", "lopukuupaev", "kuupaev.*kuni"]);
    const valid = !end || end >= today;
    for (const trade of forTrades) {
      trades.set(trade, (trades.get(trade) ?? false) || valid);
    }
  }
  if (trades.size > 0) perCompany.set(code, trades);
}

const sqlEscape = (s) => String(s).replace(/'/g, "''");
const statements = [
  `-- MTR/Tarvik import ${now}: dataset ${ds}, ${undertakers.length} undertakers read, ${perCompany.size} with relevant notices, licence ${licence}`,
];

let rows = 0;
for (const [code, trades] of perCompany) {
  for (const [trade, anyValid] of trades) {
    rows++;
    const status = anyValid ? "valid" : "invalid";
    statements.push(`INSERT INTO company_verifications
  (id, companyId, type, trade, status, checkedAt, sourceDataset, sourceLicence, detailJson)
SELECT lower(hex(randomblob(16))), c.id, 'trade_notification', '${sqlEscape(trade)}', '${status}', '${checkedAt}', '${ds}', '${sqlEscape(licence)}', NULL
FROM companies c WHERE c.registrationIdentifier = '${sqlEscape(code)}'
ON CONFLICT (companyId, type, COALESCE(trade, '')) DO UPDATE SET
  status = excluded.status,
  checkedAt = excluded.checkedAt,
  sourceDataset = excluded.sourceDataset,
  sourceLicence = excluded.sourceLicence,
  detailJson = excluded.detailJson;`);
  }
}

// Not-valid trade notifications must also be recorded so a previously valid
// badge expires on re-import: companies with a prior valid row for a trade
// absent from this import get flipped to invalid. Single pass, per import.
statements.push(`-- Expire trade notifications for companies whose current import no longer lists them
UPDATE company_verifications
SET status = 'invalid', checkedAt = '${checkedAt}', sourceDataset = '${ds}'
WHERE type = 'trade_notification'
  AND sourceDataset LIKE 'mtr:%'
  AND checkedAt < '${checkedAt}'
  AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_verifications.companyId
      AND c.registrationIdentifier IN (${[...perCompany.keys()].map((c) => `'${sqlEscape(c)}'`).join(",") || "''"})
  );`);

statements.push(`-- summary: ${rows} trade-notification rows upserted across ${perCompany.size} undertakers`);
stdout.write(statements.join("\n\n") + "\n");

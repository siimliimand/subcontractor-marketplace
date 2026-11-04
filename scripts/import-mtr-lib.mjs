/**
 * MTR/Tarvik trade-notification import core — pure, workerd-pool-safe.
 *
 * Shared by scripts/import-mtr.mjs (the thin CLI) and test/import-mtr.test.ts.
 * Mirrors the scripts/ci-currency-lib.mjs precedent (SUBC-008): everything
 * with I/O (file reads, argv, exit codes) lives in the orchestrator script;
 * everything that must be unit/integration-tested lives here.
 *
 * The ONLY import is fast-xml-parser (pure JS, no Node builtins), so this
 * module is safe to import from the @cloudflare/vitest-pool-workers pool.
 *
 * Parsing contract (both known export layouts):
 *   - Legacy (pre-2026-11 fixture): <ettevotja><teatised><teatis> with
 *     <tegevusala><kood>43210</kood></tegevusala> and optional <kehtivKuni>.
 *   - Current (2026-11-04 daily export): <ettevotja><load><luba> with
 *     <staatus>kehtiv|esitatud|peatatud</staatus>, <emtak>/<emtak2025>
 *     carrying repeated <kood> children, <kehtiv_alates>/<kehtiv_kuni>
 *     (an xsi:nil kehtiv_kuni is open-ended).
 *
 * ZERO-UPSERT GUARD (SUBC-015): when the plan produces zero upserts the
 * expire-all UPDATE is suppressed unless opts.forceExpire is set — a
 * format-drifted export must never flip every mtr:% trade_notification
 * row to 'invalid' in one pass. See docs/decision-log.md (SUBC-015).
 *
 * DRY-RUN MODE (SUBC-029): opts.dryRun renders a READ-ONLY bundle — the
 * header comment, three diagnostics SELECTs (current mtr:% rows by status,
 * the expiry projection mirroring the expire UPDATE's exact WHERE clause,
 * and how many matched undertakers exist in companies), then a projection
 * summary. No INSERT/UPDATE is ever emitted in dry-run, for ANY input;
 * --force-expire is ignored under dry-run with an explicit warning.
 */

import { XMLParser } from "fast-xml-parser";

/** Default dataset label (matches the open-data file name). */
export const DEFAULT_DATASET = "mtr:avaandmed_ettevotjad";

/**
 * Licence string surfaced with every imported row. CHANGES ONLY with the
 * founder's post-TTJA-confirmation re-import (see SUBC-012); do not edit
 * casually.
 */
export const DEFAULT_LICENCE =
  "CC BY-SA 3.0 (per open-data metadata) — data from TTJA MTR/Tarvik open data, mtr.ttja.ee — display pending TTJA licence confirmation";

/**
 * EMTAK → cockpit trade mapping (subclass level, construction F section):
 *   43.21 → electrical; 43.22 → plumbing + hvac;
 *   43.31/43.32 → drywall; 43.33 → flooring; 43.34 → painting
 */
export const EMTAK_TO_TRADES = {
  "4321": ["electrical"],
  "4322": ["plumbing", "hvac"],
  "4331": ["drywall"],
  "4332": ["drywall"],
  "4333": ["flooring"],
  "4334": ["painting"],
};

export function tradesForEmtak(code) {
  if (!code) return [];
  // Digits only: "43.210", "43210" and "4321 0" all normalise the same way.
  const norm = String(code).replace(/[^0-9]/g, "");
  for (const [prefix, trades] of Object.entries(EMTAK_TO_TRADES)) {
    if (norm.startsWith(prefix)) return trades;
  }
  return [];
}

/** XML parser configuration shared by every import invocation. */
function makeParser() {
  return new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ["ettevotja", "teatis", "tegevusala"].includes(name),
  });
}

/**
 * Find the undertaker array anywhere in the document: the first array of
 * objects that looks like undertaker records (registry code / notices).
 */
export function findUndertakers(node) {
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

/** Normalise a repeated-or-single XML child shape to an array of nodes. */
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Extract the notice/licence objects of one undertaker across BOTH known
 * layouts:
 *   - legacy keys matching /teatis/i (teatis array or teatised wrapper)
 *   - current keys matching /load|luba/i (luba array, single luba object,
 *     or a load wrapper holding luba children)
 * A wrapper node (teatised/load) contributes its family-matching OBJECT
 * children; anything else is treated as a notice itself, so stray scalar
 * children (e.g. legacy teatisNr) never masquerade as wrappers.
 */
export function noticesOf(entry) {
  const notices = [];
  for (const [key, value] of Object.entries(entry ?? {})) {
    const family = /teatis/i.test(key)
      ? /teatis/i
      : /load|luba/i.test(key)
        ? /load|luba/i
        : null;
    if (!family) continue;
    for (const node of toArray(value)) {
      if (!node || typeof node !== "object") continue;
      const inner = [];
      for (const [innerKey, innerValue] of Object.entries(node)) {
        if (!family.test(innerKey)) continue;
        for (const child of toArray(innerValue)) {
          if (child && typeof child === "object") inner.push(child);
        }
      }
      if (inner.length > 0) notices.push(...inner);
      else notices.push(node);
    }
  }
  return notices;
}

/**
 * Collect every EMTAK code carried by one notice:
 *   - current format: every <kood> child of <emtak>/<emtak2025> (each may be
 *     a scalar string/number, a single-child object, or an array of either)
 *   - legacy format: the notice-level or tegevusala-level code string
 */
function emtakCodesOf(notice) {
  const codes = [];
  for (const [key, value] of Object.entries(notice ?? {})) {
    if (!/^emtak/i.test(key)) continue;
    for (const node of toArray(value)) {
      if (node && typeof node === "object") {
        for (const [childKey, childValue] of Object.entries(node)) {
          if (!/^kood$/i.test(childKey)) continue;
          for (const code of toArray(childValue)) {
            if (typeof code === "string" || typeof code === "number") codes.push(String(code));
          }
        }
      } else if (typeof node === "string" || typeof node === "number") {
        codes.push(String(node));
      }
    }
  }
  const tg = notice?.tegevusala;
  const tegevusala = Array.isArray(tg) ? tg[0] : tg;
  const legacy =
    firstString(notice, ["^kood$", "emtak", "tehtavus"]) ||
    firstString(tegevusala, ["^kood$", "emtak"]);
  if (legacy) codes.push(legacy);
  return codes;
}

/**
 * Validity of one notice:
 *   - when a staatus field exists (current format), only "kehtiv" may count
 *     as valid; esitatud/peatatud/anything else is invalid
 *   - end date (kehtiv_kuni/kehtivKuni/lopukuupaev): absent or xsi:nil
 *     (object-valued, no text) means open-ended; otherwise end >= today
 *   - legacy notices (no staatus) keep the end-date-only rule
 */
function noticeValid(notice, today) {
  const staatus = firstString(notice, ["^staatus$"]).toLowerCase();
  const staatusOk = staatus === "" || staatus === "kehtiv";
  const end = firstString(notice, ["kehtiv.*kuni", "lopukuupaev", "kuupaev.*kuni"]);
  const dateOk = !end || end >= today;
  return staatusOk && dateOk;
}

const sqlEscape = (s) => String(s).replace(/'/g, "''");

/**
 * READ-ONLY diagnostics block for dry-run plans (SUBC-029): three SELECT
 * statements, zero writes —
 *   (1) before-counts: current mtr:% trade_notification rows by status
 *   (2) expiry projection: COUNT over the expire UPDATE's exact WHERE
 *       clause (type, sourceDataset LIKE 'mtr:%', checkedAt < plan stamp,
 *       NOT EXISTS matched-code company)
 *   (3) matched-companies count: how many matched undertakers' upserts
 *       will actually land in companies (the rest are harmless no-ops)
 * matchedCodesList is the same quoted IN-list construction the expire
 * statement uses (IN ('') when nothing matched).
 */
function dryRunDiagnostics(matchedCodesList, checkedAt) {
  return `-- READ-ONLY DIAGNOSTICS (dry-run): three SELECT statements, zero writes
-- (1) before-counts: current mtr:% trade_notification rows by status
SELECT status, COUNT(*) AS row_count FROM company_verifications
WHERE type = 'trade_notification'
  AND sourceDataset LIKE 'mtr:%'
GROUP BY status;

-- (2) expiry projection: rows the real expire UPDATE would flip to 'invalid' (same WHERE clause)
SELECT COUNT(*) AS would_expire FROM company_verifications
WHERE type = 'trade_notification'
  AND sourceDataset LIKE 'mtr:%'
  AND checkedAt < '${checkedAt}'
  AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_verifications.companyId
      AND c.registrationIdentifier IN (${matchedCodesList})
  );

-- (3) matched companies present: upserts that will actually land (the rest are no-ops)
SELECT COUNT(*) AS matched_companies FROM companies
WHERE registrationIdentifier IN (${matchedCodesList});`;
}

/**
 * Parse an MTR/Tarvik open-data XML export into an executable import plan.
 *
 * @param {string} xmlString the raw XML document text
 * @param {object} [opts]
 * @param {string} [opts.dataset] dataset label (DEFAULT_DATASET)
 * @param {string} [opts.licence] source-licence string (DEFAULT_LICENCE)
 * @param {string} [opts.today] injectable "today" (YYYY-MM-DD) for the
 *   end-date validity rule; defaults to the current UTC date
 * @param {string} [opts.now] injectable "now" (ISO timestamp) stamped into
 *   checkedAt and the header; defaults to the current UTC time
 * @param {boolean} [opts.forceExpire] emit the expire-all UPDATE even when
 *   zero upserts were produced (explicit override; adds a warning)
 * @param {boolean} [opts.dryRun] render a READ-ONLY plan instead: the plan
 *   carries dryRun/dryRunSql and planToSql emits only the header, the
 *   diagnostics SELECTs, warnings, and a projection summary — never an
 *   INSERT/UPDATE; forceExpire is ignored with an explicit warning
 * @returns the import plan consumed by planToSql
 * @throws when no undertaker entries can be located (unparseable file)
 */
export function buildImportPlan(xmlString, opts = {}) {
  const dataset = opts.dataset ?? DEFAULT_DATASET;
  const licence = opts.licence ?? DEFAULT_LICENCE;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const now = opts.now ?? new Date().toISOString();
  const forceExpire = opts.forceExpire === true;
  const dryRun = opts.dryRun === true;

  const doc = makeParser().parse(xmlString);
  const undertakers = findUndertakers(doc);
  if (!undertakers) {
    throw new Error("could not locate undertaker entries (looked for *ettevotja* elements)");
  }

  const checkedAt = now.replace(/'/g, "''");
  const ds = dataset.replace(/'/g, "''");

  // (registryCode, trade) → valid?
  const perCompany = new Map();
  let noticesSeen = 0;
  for (const entry of undertakers) {
    const code = firstString(entry, ["registri?kood", "^kood$", "regcode"]);
    if (!code) continue;
    const trades = new Map(); // trade → anyValid
    for (const notice of noticesOf(entry)) {
      noticesSeen++;
      const mapped = new Set();
      for (const code4 of emtakCodesOf(notice)) {
        for (const trade of tradesForEmtak(code4)) mapped.add(trade);
      }
      if (mapped.size === 0) continue;
      const valid = noticeValid(notice, today);
      for (const trade of mapped) {
        trades.set(trade, (trades.get(trade) ?? false) || valid);
      }
    }
    if (trades.size > 0) perCompany.set(code, trades);
  }

  const upserts = [];
  for (const [code, trades] of perCompany) {
    for (const [trade, anyValid] of trades) {
      upserts.push({ registrationIdentifier: code, trade, status: anyValid ? "valid" : "invalid" });
    }
  }

  const warnings = [];
  const matchedCodesList =
    [...perCompany.keys()].map((c) => `'${sqlEscape(c)}'`).join(",") || "''";
  let expireStatement = null;
  let guarded = false;
  if (upserts.length > 0 || forceExpire) {
    expireStatement = `-- Expire trade notifications for companies whose current import no longer lists them
UPDATE company_verifications
SET status = 'invalid', checkedAt = '${checkedAt}', sourceDataset = '${ds}'
WHERE type = 'trade_notification'
  AND sourceDataset LIKE 'mtr:%'
  AND checkedAt < '${checkedAt}'
  AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_verifications.companyId
      AND c.registrationIdentifier IN (${matchedCodesList})
  );`;
  } else {
    guarded = true;
    warnings.push(
      undertakers.length > 0 && noticesSeen === 0
        ? `GUARD: extracted 0 trade notices from ${undertakers.length} undertakers — the export format has likely drifted from every known layout (legacy teatis*/teatised, current load/luba); refusing to expire existing mtr:% rows`
        : `GUARD: extracted ${noticesSeen} trade notice(s) but none mapped to a cockpit trade (EMTAK prefixes 4321/4322/4331/4332/4333/4334) — refusing to expire existing mtr:% rows`,
    );
  }
  if (forceExpire && dryRun) {
    warnings.push(
      "OVERRIDE IGNORED: --force-expire has no effect under --dry-run — a dry run never emits INSERT/UPDATE; re-run without --dry-run to emit the real import SQL",
    );
  } else if (forceExpire && upserts.length === 0) {
    warnings.push("OVERRIDE: --force-expire active — emitting the expire-all UPDATE despite zero upserts");
  }

  const headerComment = `-- MTR/Tarvik import ${now}: dataset ${ds}, ${undertakers.length} undertakers read, ${perCompany.size} with relevant notices, licence ${licence}`;
  const summaryComment = dryRun
    ? `-- summary: ${upserts.length} trade-notification rows would be upserted across ${perCompany.size} undertakers (dry-run — no writes emitted)`
    : `-- summary: ${upserts.length} trade-notification rows upserted across ${perCompany.size} undertakers`;
  const dryRunSql = dryRun
    ? [headerComment, dryRunDiagnostics(matchedCodesList, checkedAt), summaryComment].join("\n\n") + "\n"
    : null;

  return {
    undertakersRead: undertakers.length,
    matchedUndertakers: perCompany.size,
    upserts,
    expireStatement,
    warnings,
    guarded,
    dryRun,
    dryRunSql,
    checkedAt,
    dataset: ds,
    licence,
    headerComment,
    summaryComment,
  };
}

/**
 * Render a plan as the exact SQL text the CLI writes to stdout: header
 * comment, one INSERT ... ON CONFLICT upsert per (company, trade), the
 * expire-all UPDATE (when present), WARNING comments, summary comment.
 *
 * A dry-run plan renders as header + diagnostics + warnings + projection
 * summary — never the upsert rows, never the expire UPDATE (SUBC-029).
 *
 * @param {ReturnType<typeof buildImportPlan>} plan
 * @returns {string}
 */
export function planToSql(plan) {
  if (plan.dryRun) {
    // dryRunSql is header + diagnostics + summary (no warnings); splice the
    // warnings in before the trailing summary block so it stays last.
    const blocks = plan.dryRunSql.trimEnd().split("\n\n");
    const summary = blocks.pop();
    const parts = [...blocks];
    for (const warning of plan.warnings) parts.push(`-- ${warning}`);
    parts.push(summary);
    return parts.join("\n\n") + "\n";
  }
  const parts = [plan.headerComment];
  for (const upsert of plan.upserts) {
    parts.push(`INSERT INTO company_verifications
  (id, companyId, type, trade, status, checkedAt, sourceDataset, sourceLicence, detailJson)
SELECT lower(hex(randomblob(16))), c.id, 'trade_notification', '${sqlEscape(upsert.trade)}', '${upsert.status}', '${plan.checkedAt}', '${plan.dataset}', '${sqlEscape(plan.licence)}', NULL
FROM companies c WHERE c.registrationIdentifier = '${sqlEscape(upsert.registrationIdentifier)}'
ON CONFLICT (companyId, type, COALESCE(trade, '')) DO UPDATE SET
  status = excluded.status,
  checkedAt = excluded.checkedAt,
  sourceDataset = excluded.sourceDataset,
  sourceLicence = excluded.sourceLicence,
  detailJson = excluded.detailJson;`);
  }
  if (plan.expireStatement) parts.push(plan.expireStatement);
  for (const warning of plan.warnings) parts.push(`-- ${warning}`);
  parts.push(plan.summaryComment);
  return parts.join("\n\n") + "\n";
}

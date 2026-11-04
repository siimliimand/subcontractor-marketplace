/**
 * SUBC-015 — MTR/Tarvik import: file → plan → SQL → D1 semantics.
 *
 * Covers the two known export layouts plus the drifted one:
 *   - scripts/fixtures/mtr-sample.xml        (legacy teatised/teatis layout)
 *   - scripts/fixtures/mtr-luba-sample.xml   (current load/luba layout)
 *   - scripts/fixtures/mtr-format-drift.xml  (undertakers, no known notices)
 *
 * The lib (scripts/import-mtr-lib.mjs) is pure and workerd-pool safe, so the
 * same planToSql output the CLI emits is executed here against real miniflare
 * D1 — pinning the zero-upsert guard that keeps a format-drifted export from
 * ever flipping every mtr:% trade_notification row to 'invalid' (SUBC-015).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { companies, companyVerifications } from "../src/worker/db/schema";
import legacyFixture from "../scripts/fixtures/mtr-sample.xml?raw";
import lubaFixture from "../scripts/fixtures/mtr-luba-sample.xml?raw";
import driftFixture from "../scripts/fixtures/mtr-format-drift.xml?raw";
import { buildImportPlan, planToSql, DEFAULT_DATASET } from "../scripts/import-mtr-lib.mjs";

// Injected clock: end dates in fixtures are chosen relative to this date.
const TODAY = "2026-11-04";
const NOW = "2026-11-04T12:00:00.000Z";
const planOpts = { today: TODAY, now: NOW, dataset: "mtr:test" };

describe("legacy teatised/teatis layout (scripts/fixtures/mtr-sample.xml)", () => {
  it("produces exactly the three expected upserts with their statuses", () => {
    const plan = buildImportPlan(legacyFixture, planOpts);
    expect(plan.undertakersRead).toBe(2);
    expect(plan.matchedUndertakers).toBe(2);
    expect(plan.upserts).toEqual([
      { registrationIdentifier: "12345678", trade: "electrical", status: "valid" },
      { registrationIdentifier: "12345678", trade: "painting", status: "valid" },
      { registrationIdentifier: "34567890", trade: "flooring", status: "invalid" },
    ]);
  });

  it("keeps the expire-all UPDATE and byte-faithful summary/header text", () => {
    const plan = buildImportPlan(legacyFixture, planOpts);
    expect(plan.expireStatement).toMatch(
      /^-- Expire trade notifications[\s\S]*UPDATE company_verifications[\s\S]*registrationIdentifier IN \('12345678','34567890'\)/,
    );
    expect(plan.summaryComment).toBe(
      "-- summary: 3 trade-notification rows upserted across 2 undertakers",
    );
    expect(plan.headerComment).toBe(
      `-- MTR/Tarvik import ${NOW}: dataset mtr:test, 2 undertakers read, 2 with relevant notices, licence ${
        buildImportPlan(legacyFixture, { today: TODAY, now: NOW }).licence
      }`,
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.guarded).toBe(false);
  });

  it("renders the plan as three INSERTs + one expire UPDATE + summary", () => {
    const sql = planToSql(buildImportPlan(legacyFixture, planOpts));
    expect((sql.match(/INSERT INTO company_verifications/g) ?? []).length).toBe(3);
    expect((sql.match(/UPDATE company_verifications/g) ?? []).length).toBe(1);
    expect(sql).toContain("'electrical', 'valid', '2026-11-04T12:00:00.000Z', 'mtr:test'");
    expect(sql).toContain("'flooring', 'invalid', '2026-11-04T12:00:00.000Z', 'mtr:test'");
    expect(sql.trimEnd().endsWith(
      "-- summary: 3 trade-notification rows upserted across 2 undertakers",
    )).toBe(true);
  });

  it("defaults the dataset label to the open-data name", () => {
    const plan = buildImportPlan(legacyFixture, { today: TODAY, now: NOW });
    expect(plan.dataset).toBe(DEFAULT_DATASET);
  });

  it("throws for a document without undertaker entries", () => {
    expect(() => buildImportPlan("<foo><bar>nope</bar></foo>", planOpts)).toThrow(
      /could not locate undertaker entries/,
    );
  });
});

describe("current load/luba layout (scripts/fixtures/mtr-luba-sample.xml)", () => {
  // Expected outcome stated explicitly per (company, trade), today = 2026-11-04:
  //  11111111 electrical  valid   (kehtiv + nil end + emtak bare-string form)
  //  22222222 plumbing    valid   (kehtiv 43220; esitatud 43221 keeps anyValid)
  //  22222222 hvac        valid   (same 43220 luba — multi-trade prefix)
  //  33333333 drywall     invalid (peatatud despite nil end; other luba expired 2020)
  //  44444444 flooring    valid   (kehtiv_kuni == today counts as >= today)
  //  55555555 painting    valid   (mapped only via emtak2025)
  //  four foreign-code companies: electrical valid upserts (harmless no-op SQL)
  //  88888888 (unmapped EMTAK) and 99999999 (no load) → no upserts at all
  const expectedUpserts = [
    { registrationIdentifier: "11111111", trade: "electrical", status: "valid" },
    { registrationIdentifier: "22222222", trade: "plumbing", status: "valid" },
    { registrationIdentifier: "22222222", trade: "hvac", status: "valid" },
    { registrationIdentifier: "33333333", trade: "drywall", status: "invalid" },
    { registrationIdentifier: "44444444", trade: "flooring", status: "valid" },
    { registrationIdentifier: "55555555", trade: "painting", status: "valid" },
    { registrationIdentifier: "(SIRET) 841 489 123 00015", trade: "electrical", status: "valid" },
    { registrationIdentifier: "(SIRET) 841'489 123 00015", trade: "electrical", status: "valid" },
    { registrationIdentifier: "0146519-2", trade: "electrical", status: "valid" },
    { registrationIdentifier: "1000000012", trade: "electrical", status: "valid" },
  ];

  it("produces the exact expected ten upserts across nine matched undertakers", () => {
    const plan = buildImportPlan(lubaFixture, planOpts);
    expect(plan.undertakersRead).toBe(11);
    expect(plan.matchedUndertakers).toBe(9);
    expect(plan.upserts).toEqual(expectedUpserts);
    expect(plan.summaryComment).toBe(
      "-- summary: 10 trade-notification rows upserted across 9 undertakers",
    );
  });

  it("skips companies whose licences map to no cockpit trade or hold no load", () => {
    const plan = buildImportPlan(lubaFixture, planOpts);
    const codes = new Set(plan.upserts.map((u) => u.registrationIdentifier));
    expect(codes.has("88888888")).toBe(false);
    expect(codes.has("99999999")).toBe(false);
  });

  it("keeps the healthy-path expire UPDATE and lists every matched code in it", () => {
    const plan = buildImportPlan(lubaFixture, planOpts);
    expect(plan.expireStatement).not.toBeNull();
    expect(plan.expireStatement).toContain("IN ('11111111'");
    expect(plan.expireStatement).toContain("'(SIRET) 841''489 123 00015'");
    expect(plan.expireStatement).toContain("'0146519-2','1000000012')");
    expect(plan.expireStatement).not.toContain("'88888888'");
    expect(plan.warnings).toEqual([]);
    expect(plan.guarded).toBe(false);
  });

  it("sql-escapes apostrophes in registry codes within the emitted SQL", () => {
    const sql = planToSql(buildImportPlan(lubaFixture, planOpts));
    expect(sql).toContain(
      "c.registrationIdentifier = '(SIRET) 841''489 123 00015'",
    );
    expect(sql).not.toContain("841'489");
  });

  it("extracts both layouts from a single hybrid document", () => {
    const hybrid = `<?xml version="1.0" encoding="UTF-8"?>
<ettevotjad xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ettevotja>
    <registriKood>12345678</registriKood>
    <teatised>
      <teatis><tegevusala><kood>43210</kood></tegevusala></teatis>
    </teatised>
  </ettevotja>
  <ettevotja>
    <registrikood>11111111</registrikood>
    <load><luba><staatus>kehtiv</staatus><emtak><kood>43211</kood></emtak></luba></load>
  </ettevotja>
</ettevotjad>`;
    const plan = buildImportPlan(hybrid, planOpts);
    expect(plan.matchedUndertakers).toBe(2);
    expect(plan.upserts).toEqual([
      { registrationIdentifier: "12345678", trade: "electrical", status: "valid" },
      { registrationIdentifier: "11111111", trade: "electrical", status: "valid" },
    ]);
  });
});

describe("zero-upsert format-drift guard (scripts/fixtures/mtr-format-drift.xml)", () => {
  it("produces zero upserts, a null expire statement, and an extraction-drift warning", () => {
    const plan = buildImportPlan(driftFixture, planOpts);
    expect(plan.undertakersRead).toBe(2);
    expect(plan.matchedUndertakers).toBe(0);
    expect(plan.upserts).toEqual([]);
    expect(plan.expireStatement).toBeNull();
    expect(plan.guarded).toBe(true);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(
      /GUARD: extracted 0 trade notices from 2 undertakers.*drifted/s,
    );
  });

  it("renders a guarded plan with NO INSERT and NO UPDATE statements", () => {
    const sql = planToSql(buildImportPlan(driftFixture, planOpts));
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).not.toContain("UPDATE company_verifications");
    expect(sql).toContain("-- GUARD:");
    expect(sql).toContain(
      "-- summary: 0 trade-notification rows upserted across 0 undertakers",
    );
  });

  it("distinguishes mapping drift (notices found, none mapped) from extraction drift", () => {
    const mappingDrift = `<?xml version="1.0" encoding="UTF-8"?>
<ettevotjad xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ettevotja>
    <registrikood>11111111</registrikood>
    <nimi>OÜ Sideteenus</nimi>
    <load>
      <luba>
        <staatus>kehtiv</staatus>
        <emtak><kood>61109</kood></emtak>
      </luba>
    </load>
  </ettevotja>
</ettevotjad>`;
    const plan = buildImportPlan(mappingDrift, planOpts);
    expect(plan.guarded).toBe(true);
    expect(plan.expireStatement).toBeNull();
    expect(plan.warnings[0]).toMatch(/extracted 1 trade notice\(s\) but none mapped/);
  });

  it("emits the expire UPDATE with an override warning when forceExpire is set", () => {
    const plan = buildImportPlan(driftFixture, { ...planOpts, forceExpire: true });
    expect(plan.upserts).toEqual([]);
    expect(plan.expireStatement).not.toBeNull();
    expect(plan.guarded).toBe(false);
    expect(plan.warnings.some((w) => /OVERRIDE: --force-expire active/.test(w))).toBe(true);
    expect(plan.expireStatement).toContain("IN ('')"); // no matched companies at all
    const sql = planToSql(plan);
    expect(sql).toContain("UPDATE company_verifications");
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).toContain("-- OVERRIDE:");
  });

  it("keeps healthy imports unguarded (legacy and luba fixtures still expire)", () => {
    expect(buildImportPlan(legacyFixture, planOpts).expireStatement).not.toBeNull();
    expect(buildImportPlan(lubaFixture, planOpts).expireStatement).not.toBeNull();
    expect(buildImportPlan(legacyFixture, planOpts).guarded).toBe(false);
    expect(buildImportPlan(lubaFixture, planOpts).guarded).toBe(false);
  });
});

describe("read-only dry-run diagnostics (SUBC-029)", () => {
  it("(a) luba fixture: diagnostics with the matched IN list, zero writes, comments intact", () => {
    const plan = buildImportPlan(lubaFixture, { ...planOpts, dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.guarded).toBe(false);
    expect(plan.dryRunSql).not.toBeNull();
    const sql = planToSql(plan);
    // read-only guarantee
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).not.toContain("UPDATE company_verifications");
    // diagnostics: the three SELECTs with the matched codes in the IN lists
    expect(sql).toContain("SELECT status, COUNT(*) AS row_count");
    expect(sql).toContain("SELECT COUNT(*) AS would_expire");
    expect(sql).toContain("SELECT COUNT(*) AS matched_companies");
    expect((sql.match(/IN \('11111111'/g) ?? []).length).toBe(2);
    expect(sql).toContain("'0146519-2','1000000012')");
    expect(sql).toContain("'(SIRET) 841''489 123 00015'");
    // header and projection summary intact
    expect(sql).toContain(plan.headerComment);
    expect(
      sql.trimEnd().endsWith(
        "-- summary: 10 trade-notification rows would be upserted across 9 undertakers (dry-run — no writes emitted)",
      ),
    ).toBe(true);
    // structurally: only the three diagnostics SELECTs are executable
    const statements = toStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements.every((s) => /^SELECT/i.test(s))).toBe(true);
  });

  it("(b) legacy fixture: both layouts flow through dry-run with the same shape", () => {
    const plan = buildImportPlan(legacyFixture, { ...planOpts, dryRun: true });
    expect(plan.dryRun).toBe(true);
    const sql = planToSql(plan);
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).not.toContain("UPDATE company_verifications");
    expect((sql.match(/IN \('12345678','34567890'\)/g) ?? []).length).toBe(2);
    expect(
      sql.trimEnd().endsWith(
        "-- summary: 3 trade-notification rows would be upserted across 2 undertakers (dry-run — no writes emitted)",
      ),
    ).toBe(true);
    const statements = toStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements.every((s) => /^SELECT/i.test(s))).toBe(true);
  });

  it("(c) drift fixture: guard warning present, diagnostics still emitted with IN ('')", () => {
    const plan = buildImportPlan(driftFixture, { ...planOpts, dryRun: true });
    expect(plan.guarded).toBe(true);
    expect(plan.dryRunSql).not.toBeNull();
    const sql = planToSql(plan);
    expect(sql).toContain("-- GUARD:");
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).not.toContain("UPDATE company_verifications");
    expect((sql.match(/IN \(''\)/g) ?? []).length).toBe(2);
    expect(
      sql.trimEnd().endsWith(
        "-- summary: 0 trade-notification rows would be upserted across 0 undertakers (dry-run — no writes emitted)",
      ),
    ).toBe(true);
    const statements = toStatements(sql);
    expect(statements).toHaveLength(3); // before-counts still reach D1 for a drifted file
  });

  it("(d) dry-run + force-expire: no write statements; the override is ignored with a warning", () => {
    const plan = buildImportPlan(driftFixture, { ...planOpts, dryRun: true, forceExpire: true });
    expect(plan.guarded).toBe(false);
    const sql = planToSql(plan);
    expect(sql).not.toContain("INSERT INTO company_verifications");
    expect(sql).not.toContain("UPDATE company_verifications");
    expect(sql).toContain("-- OVERRIDE IGNORED:");
    expect(sql).not.toContain("-- OVERRIDE: --force-expire active");
    expect(toStatements(sql)).toHaveLength(3); // dry-run wins unconditionally
  });

  it("emits no write statements on ANY fixture, in both dryRunSql and planToSql", () => {
    const fixtures = [
      ["legacy", legacyFixture],
      ["luba", lubaFixture],
      ["drift", driftFixture],
    ] as const;
    for (const [name, fixture] of fixtures) {
      const plan = buildImportPlan(fixture, { ...planOpts, dryRun: true });
      const texts = [plan.dryRunSql, planToSql(plan)].filter(
        (t): t is string => t !== null,
      );
      expect(texts, name).toHaveLength(2);
      for (const text of texts) {
        expect(text, name).not.toContain("INSERT INTO company_verifications");
        expect(text, name).not.toContain("UPDATE company_verifications");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: file → plan → planToSql → real miniflare D1 (cloudflare:test).
// Executes the exact SQL the CLI emits and asserts the resulting rows.
// ---------------------------------------------------------------------------

const db = () => drizzle(env.DB);

/** Quote/comment-aware statement splitter (same approach as apply-migrations). */
function toStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let inString = false;
  let inComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inComment) {
      buf += ch;
      if (ch === "\n") inComment = false;
      continue;
    }
    if (ch === "'") {
      inString = !inString; // '' escapes toggle twice → stay inside the string
      buf += ch;
      continue;
    }
    if (!inString && ch === "-" && sql[i + 1] === "-") {
      inComment = true;
      buf += ch;
      continue;
    }
    buf += ch;
    if (ch === ";" && !inString) {
      statements.push(buf);
      buf = "";
    }
  }
  statements.push(buf);
  return statements
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

async function runImportSql(sql: string) {
  for (const stmt of toStatements(sql)) {
    await env.DB.prepare(stmt).run();
  }
}

type SeededCompany = { id: string; registrationIdentifier: string };

const SEED_COMPANIES: { legalName: string; registrationIdentifier: string }[] = [
  { legalName: "OÜ Test Electric AS", registrationIdentifier: "12345678" }, // legacy fixture
  { legalName: "OÜ Fresh Painting", registrationIdentifier: "34567890" }, // legacy fixture
  { legalName: "OÜ Elektrikesk", registrationIdentifier: "11111111" }, // luba fixture
  { legalName: "OÜ Torumees", registrationIdentifier: "22222222" }, // luba fixture
  { legalName: "OÜ Kipsmeister", registrationIdentifier: "33333333" }, // luba fixture
  { legalName: "OÜ Põrandaja", registrationIdentifier: "44444444" }, // luba fixture
  { legalName: "OÜ Värvikas", registrationIdentifier: "55555555" }, // luba fixture
  { legalName: "OÜ Vanamoodne", registrationIdentifier: "77777777" }, // in NO fixture
];

const PAST_CHECKED_AT = "2026-10-01T00:00:00.000Z";

async function seed(): Promise<Record<string, string>> {
  const seeded: SeededCompany[] = [];
  for (const c of SEED_COMPANIES) {
    const id = crypto.randomUUID();
    seeded.push({ id, registrationIdentifier: c.registrationIdentifier });
    await db().insert(companies).values({
      id,
      legalName: c.legalName,
      registrationIdentifier: c.registrationIdentifier,
      contactEmail: `${c.registrationIdentifier}@x.ee`,
    });
  }
  const byCode = Object.fromEntries(seeded.map((s) => [s.registrationIdentifier, s.id]));
  // Pre-existing state the import must reason about:
  //  - an mtr:% trade_notification row for a company absent from every fixture
  //    (checkedAt clearly in the past → the expire path's target)
  //  - a registry_active row that must survive every import (type-scoped UPDATE)
  await db().insert(companyVerifications).values([
    {
      id: crypto.randomUUID(),
      companyId: byCode["77777777"]!,
      type: "trade_notification",
      trade: "electrical",
      status: "valid",
      checkedAt: PAST_CHECKED_AT,
      sourceDataset: "mtr:avaandmed_ettevotjad",
      sourceLicence: "CC BY-SA 3.0 (per open-data metadata) — TTJA",
    },
    {
      id: crypto.randomUUID(),
      companyId: byCode["77777777"]!,
      type: "registry_active",
      trade: null,
      status: "valid",
      checkedAt: PAST_CHECKED_AT,
      sourceDataset: "ariregister:ettevotja_rekvisiidid",
      sourceLicence: "CC BY 4.0 — RIK",
    },
  ]);
  return byCode;
}

type Row = {
  companyId: string;
  type: string;
  trade: string | null;
  status: string;
  checkedAt: string;
  sourceDataset: string;
  sourceLicence: string;
};

const tradeRows = () =>
  db()
    .select()
    .from(companyVerifications)
    .where(eq(companyVerifications.type, "trade_notification"))
    .orderBy(companyVerifications.companyId, companyVerifications.trade);

const registryRows = () =>
  db()
    .select()
    .from(companyVerifications)
    .where(eq(companyVerifications.type, "registry_active"));

/** (companyId, trade) → status map for compact assertions. */
async function tradeStatusMap(byCode: Record<string, string>) {
  const rows = (await tradeRows()) as Row[];
  const byCompanyToTrade = new Map(Object.entries(byCode).map(([code, id]) => [id, code]));
  return new Map(
    rows.map((r) => [
      `${byCompanyToTrade.get(r.companyId) ?? r.companyId}:${r.trade}`,
      r.status,
    ]),
  );
}

describe("integration: luba-format import SQL against miniflare D1", () => {
  beforeEach(async () => {
    await db().delete(companyVerifications);
    await db().delete(companies);
  });

  it("upserts the exact per-(company, trade) rows, with statuses and stamps", async () => {
    const byCode = await seed();
    await runImportSql(planToSql(buildImportPlan(lubaFixture, planOpts)));

    const statuses = await tradeStatusMap(byCode);
    expect(statuses.get("11111111:electrical")).toBe("valid"); // kehtiv + nil end
    expect(statuses.get("22222222:plumbing")).toBe("valid");
    expect(statuses.get("22222222:hvac")).toBe("valid"); // 4322 prefix → two trades
    expect(statuses.get("33333333:drywall")).toBe("invalid"); // peatatud / expired
    expect(statuses.get("44444444:flooring")).toBe("valid"); // end == today
    expect(statuses.get("55555555:painting")).toBe("valid"); // via emtak2025
    expect(statuses.size).toBe(7); // 6 upserted + 1 pre-existing (expired below)

    const upserted = (await tradeRows()) as Row[];
    const electrical = upserted.find(
      (r) => r.companyId === byCode["11111111"] && r.trade === "electrical",
    )!;
    expect(electrical.checkedAt).toBe(NOW);
    expect(electrical.sourceDataset).toBe("mtr:test");
    expect(electrical.sourceLicence).toContain("display pending TTJA licence confirmation");

    // Foreign-format registry codes matched no company → no rows created for them.
    expect(upserted.some((r) => r.sourceDataset === "mtr:test" && r.checkedAt !== NOW)).toBe(
      false,
    );
  });

  it("expires the absent company's stale valid row but leaves registry_active alone", async () => {
    const byCode = await seed();
    await runImportSql(planToSql(buildImportPlan(lubaFixture, planOpts)));

    const expired = (await tradeRows()) as Row[];
    const absentRow = expired.find((r) => r.companyId === byCode["77777777"])!;
    expect(absentRow.trade).toBe("electrical");
    expect(absentRow.status).toBe("invalid"); // flipped: absent from this import
    expect(absentRow.checkedAt).toBe(NOW); // re-stamped by the expire UPDATE

    const registry = (await registryRows()) as Row[];
    expect(registry).toHaveLength(1);
    expect(registry[0]!.status).toBe("valid");
    expect(registry[0]!.checkedAt).toBe(PAST_CHECKED_AT); // untouched
  });

  it("is idempotent: re-running the same SQL changes nothing; a fresh pass re-stamps only", async () => {
    const byCode = await seed();
    const sqlPass1 = planToSql(buildImportPlan(lubaFixture, planOpts));
    await runImportSql(sqlPass1);
    const afterPass1 = await tradeStatusMap(byCode);

    // Same text again: no duplicates, no status churn.
    await runImportSql(sqlPass1);
    const afterSameText = await tradeStatusMap(byCode);
    expect(afterSameText.size).toBe(afterPass1.size);
    expect([...afterSameText.entries()].sort()).toEqual([...afterPass1.entries()].sort());

    // Fresh plan later the same day: identical statuses (same injected today),
    // newer stamps — a pure re-import changes nothing but checkedAt.
    const pass2Opts = { today: TODAY, now: "2026-11-04T23:59:59.000Z", dataset: "mtr:test" };
    await runImportSql(planToSql(buildImportPlan(lubaFixture, pass2Opts)));
    const afterPass2 = await tradeStatusMap(byCode);
    expect([...afterPass2.entries()].sort()).toEqual([...afterPass1.entries()].sort());

    const rows = (await tradeRows()) as Row[];
    expect(rows.every((r) => r.checkedAt === "2026-11-04T23:59:59.000Z")).toBe(true);
    const dup = await env.DB.prepare(
      `SELECT companyId, type, COALESCE(trade, '') AS t, COUNT(*) AS n
       FROM company_verifications GROUP BY 1, 2, 3 HAVING n > 1`,
    ).all();
    expect(dup.results).toHaveLength(0); // unique index holds across passes
  });

  it("faithfully expires a trade whose licence end date passed between imports", async () => {
    const byCode = await seed();
    await runImportSql(planToSql(buildImportPlan(lubaFixture, planOpts))); // today = 2026-11-04
    const nextDay = { today: "2026-11-05", now: "2026-11-05T09:00:00.000Z", dataset: "mtr:test" };
    await runImportSql(planToSql(buildImportPlan(lubaFixture, nextDay)));

    const statuses = await tradeStatusMap(byCode);
    // 44444444's flooring licence ended 2026-11-04 — still valid that day,
    // expired the next. Everything else keeps its status from pass 1.
    expect(statuses.get("44444444:flooring")).toBe("invalid");
    expect(statuses.get("11111111:electrical")).toBe("valid");
    expect(statuses.get("22222222:hvac")).toBe("valid");
    expect(statuses.get("33333333:drywall")).toBe("invalid");
    const rows = (await tradeRows()) as Row[];
    expect(rows.every((r) => r.checkedAt === "2026-11-05T09:00:00.000Z")).toBe(true);
  });

  it("guard at the DB level: a drifted import cannot flip valid rows to invalid", async () => {
    const byCode = await seed();
    const guardedSql = planToSql(buildImportPlan(driftFixture, planOpts));

    // The guarded plan is comments only — nothing executable reaches D1.
    expect(toStatements(guardedSql)).toEqual([]);
    await runImportSql(guardedSql);

    const rows = (await tradeRows()) as Row[];
    const absentRow = rows.find((r) => r.companyId === byCode["77777777"])!;
    expect(absentRow.status).toBe("valid"); // the pre-SUBC-015 destructive outcome
    expect(absentRow.checkedAt).toBe(PAST_CHECKED_AT); // is now impossible
    expect(rows).toHaveLength(1); // and no upsert rows were created
    const registry = (await registryRows()) as Row[];
    expect(registry[0]!.status).toBe("valid");
  });

  it("(e) dry-run bundle at the D1 level: correct projections, zero row changes", async () => {
    await seed();
    const sql = planToSql(buildImportPlan(lubaFixture, { ...planOpts, dryRun: true }));

    // Structurally read-only: exactly the three diagnostics SELECTs.
    const statements = toStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements.every((s) => /^SELECT/i.test(s))).toBe(true);

    // (1) before-counts: exactly the seeded mtr:% trade row (77777777, valid);
    // the registry_active row is ariregister:… so it stays outside the counts.
    const before = await env.DB.prepare(statements[0]!).all<{ status: string; row_count: number }>();
    expect(before.results).toEqual([{ status: "valid", row_count: 1 }]);

    // (2) expiry projection: 77777777 is absent from the luba matched set and
    // its checkedAt is past the plan stamp — the one row the UPDATE would flip.
    const projection = await env.DB.prepare(statements[1]!).all<{ would_expire: number }>();
    expect(projection.results[0]!.would_expire).toBe(1);

    // (3) matched companies present: five of the nine luba codes exist in
    // companies (the four foreign codes match no company row → no-op upserts).
    const matched = await env.DB.prepare(statements[2]!).all<{ matched_companies: number }>();
    expect(matched.results[0]!.matched_companies).toBe(5);

    // Executing the whole bundle changes zero rows in either table.
    const tradeBefore = await tradeRows();
    const companiesBefore = await db().select().from(companies);
    await runImportSql(sql);
    expect(await tradeRows()).toEqual(tradeBefore);
    expect(await db().select().from(companies)).toEqual(companiesBefore);
  });

  it("legacy-format import SQL still lands its three rows and expires the absent company", async () => {
    const byCode = await seed();
    await runImportSql(planToSql(buildImportPlan(legacyFixture, planOpts)));

    const statuses = await tradeStatusMap(byCode);
    expect(statuses.get("12345678:electrical")).toBe("valid");
    expect(statuses.get("12345678:painting")).toBe("valid");
    expect(statuses.get("34567890:flooring")).toBe("invalid");
    expect(statuses.get("77777777:electrical")).toBe("invalid"); // expired (absent)
    expect(statuses.size).toBe(4);
  });
});

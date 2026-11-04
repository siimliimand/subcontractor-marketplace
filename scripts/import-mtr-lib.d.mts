/**
 * Type declarations for scripts/import-mtr-lib.mjs (SUBC-015).
 * Consumed by test/import-mtr.test.ts under strict tsc.
 */

/** Default dataset label (matches the open-data file name). */
export declare const DEFAULT_DATASET: string;

/** Licence string surfaced with every imported row (founder-owned text). */
export declare const DEFAULT_LICENCE: string;

/** EMTAK digit-prefix → cockpit trade mapping (construction F section). */
export declare const EMTAK_TO_TRADES: Readonly<Record<string, readonly string[]>>;

/** Map one EMTAK code (any punctuation tolerated) to cockpit trades. */
export declare function tradesForEmtak(
  code: string | number | null | undefined,
): string[];

/** Locate the undertaker array anywhere in a parsed document; null if absent. */
export declare function findUndertakers(
  node: unknown,
): Record<string, unknown>[] | null;

/** Extract notice/licence objects from one undertaker across both layouts. */
export declare function noticesOf(entry: unknown): Record<string, unknown>[];

/** One generated (company, trade) upsert row. */
export declare type ImportUpsert = {
  registrationIdentifier: string;
  trade: string;
  status: "valid" | "invalid";
};

/** The executable import plan produced by buildImportPlan. */
export declare type ImportPlan = {
  undertakersRead: number;
  matchedUndertakers: number;
  upserts: ImportUpsert[];
  expireStatement: string | null;
  warnings: string[];
  guarded: boolean;
  checkedAt: string;
  dataset: string;
  licence: string;
  headerComment: string;
  summaryComment: string;
};

/** Options for buildImportPlan; every member is injectable for determinism. */
export declare type BuildImportPlanOptions = {
  dataset?: string;
  licence?: string;
  today?: string;
  now?: string;
  forceExpire?: boolean;
};

/** Parse an MTR/Tarvik open-data XML export into an executable import plan. */
export declare function buildImportPlan(
  xmlString: string,
  opts?: BuildImportPlanOptions,
): ImportPlan;

/** Render a plan as the exact SQL text the CLI writes to stdout. */
export declare function planToSql(plan: ImportPlan): string;

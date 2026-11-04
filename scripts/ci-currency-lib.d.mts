/**
 * Type declarations for scripts/ci-currency-lib.mjs (SUBC-008).
 * Consumed by test/ci-currency-guard.test.ts under strict tsc.
 */

/** A lock older than this (or held by a dead pid) is considered stale and may be stolen. */
export declare const LOCK_STALE_MS: number;

/**
 * The only ref this mechanism may ever act on. Throws for anything else.
 */
export declare function assertMainRef(ref: string): asserts ref is "main";

export declare type DecideResult = {
  action: "push" | "noop" | "refuse";
  reason: string;
};

/** Decide what to do given ahead/behind counts between local main and origin/main. */
export declare function decideAction(ahead: number, behind: number): DecideResult;

/** Extract the sha of `refs/heads/main` from `git ls-remote` output; null when absent. */
export declare function parseLsRemoteMain(output: string): string | null;

/** Scrub credential material from any string destined for logs or alerts. */
export declare function redactLogLine(line: string): string;

/** Case-insensitive full-sha comparison. */
export declare function shasEqual(a: string, b: string): boolean;

/** Lock-steal decision: stale when the pid is dead or the lock is >= LOCK_STALE_MS old. */
export declare function isLockStale(ageMs: number, pidAlive: boolean): boolean;

export declare type GateEvidenceKind = "push-ok" | "noop-ok" | "fail" | "check" | "other";

export declare type GateEvidenceLine = {
  ts: string | null;
  kind: GateEvidenceKind;
  tip: string | null;
  runId: string | null;
};

/** Classify one auto-push.log line against the gate's evidence grammar (SUBC-028). */
export declare function parseGateEvidenceLine(line: string): GateEvidenceLine;

export declare type LandingEvidence = GateEvidenceLine & { line: string };

export declare type FindLandingEvidenceResult = {
  found: boolean;
  evidence: LandingEvidence | null;
  reason: string;
};

/**
 * Decide whether the watchdog log proves the landing gate ran for `tip`
 * (newest-first scan; strict mode accepts only tip-named push-ok evidence).
 */
export declare function findLandingEvidence(
  lines: string[],
  tip: string,
  opts: { committedAtIso: string | null; allowNoopFallback: boolean }
): FindLandingEvidenceResult;

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

/** True only for a string of exactly 40 hexadecimal characters (full sha). */
export declare function isFullSha(value: unknown): boolean;

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

/**
 * How the accepted evidence matched the audited tip (SUBC-044):
 * "exact-tip" — a push-ok line naming the audited tip itself;
 * "descendant-tip" — a push-ok line whose pushed tip provably descends from
 * the audited tip (ancestry proven by the injected isTipDescendant predicate);
 * "noop-fallback" — the noop-ok fallback in default mode;
 * null — nothing was found.
 */
export declare type LandingEvidenceMatchKind =
  | "exact-tip"
  | "descendant-tip"
  | "noop-fallback";

export declare type FindLandingEvidenceResult = {
  found: boolean;
  evidence: LandingEvidence | null;
  reason: string;
  matchKind: LandingEvidenceMatchKind | null;
};

/**
 * Decide whether the watchdog log proves the landing gate ran for `tip`
 * (newest-first scan; strict mode accepts tip-named push-ok evidence — exact
 * or, when isTipDescendant is injected and returns true, a proven descendant
 * tip). Default mode additionally accepts the noop-ok fallback.
 */
export declare function findLandingEvidence(
  lines: string[],
  tip: string,
  opts: {
    committedAtIso: string | null;
    allowNoopFallback: boolean;
    /** Prove `auditedTip` is an ancestor of `pushedTip` (SUBC-044). Must be
     * a function when present; a wrong-typed value throws (fail-safe). */
    isTipDescendant?: (auditedTip: string, pushedTip: string) => boolean;
  }
): FindLandingEvidenceResult;

export declare type RefineResult = {
  action: "adopt-origin" | "refuse";
  reason: string;
};

/**
 * Refine a diverged refusal with proven tree identity (SUBC-027): identical
 * trees → adopt-origin (compare-and-swap update-ref of the local ref);
 * every other shape stays a refusal. Never returns push or noop.
 */
export declare function refineRefusalWithTreeIdentity(
  ahead: number,
  behind: number,
  treesIdentical: boolean
): RefineResult;

/** Build the pinned reflog message for a tree-identity adoption (SUBC-027). */
export declare function buildAdoptionReflogMessage(tips: {
  originTip: string;
  localTip: string;
  originTree: string;
  localTree: string;
}): string;

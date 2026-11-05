/**
 * Unit tests for the SUBC-028 landing-gate evidence grammar
 * (scripts/ci-currency-lib.mjs — pure, zero-import, workerd-pool safe).
 *
 * The fixtures below are the watchdog's own line shapes, taken verbatim from
 * ~/.local/state/ci-currency/auto-push.log (SUBC-020/SUBC-019 flush lines).
 * They pin the grammar so that a skipped landing gate can never again pass
 * verification silently: only the two OK success shapes count as evidence,
 * and only under the ordering rules encoded in findLandingEvidence.
 */
import { describe, expect, it } from "vitest";
import {
  findLandingEvidence,
  parseGateEvidenceLine,
} from "../scripts/ci-currency-lib.mjs";
// Imported as TEXT only (?raw — same pattern as test/ci-currency-guard.test.ts
// imports push-main-when-ahead.mjs): the checker's module top level exits, so
// a runtime import would kill the test pool. All pins below are source-text.
import checkerSource from "../scripts/verify-landing-gate.mjs?raw";

const TIP_F07 = "f07eb9304d21b05be5d6a11dcdaccfca5c574612";
const TIP_530 = "530360c7cacf35703a7307a4626372a24a68198e";

// SUBC-044 real-sha fixtures (live gate-log facts):
// TIP_504 — the SUBC-026 landing; never named by a push-ok line, published to
//   origin only as an ancestor of the later gate-pushed tip TIP_9A7 (SUBC-031
//   flush, Actions run #29 id=41907815753).
// TIP_9A7 — that later gate-pushed tip.
// TIP_7BF — the rescue/subc-023-old-main pin; not in main history, so not an
//   ancestor of any gate-pushed tip: the durable negative control.
const TIP_504 = "50433302f9926829ce4ebbc48871ed2391da0fd1";
const TIP_9A7 = "9a749b4461886aff0d2723aab97cfc5274a43be5";
const TIP_7BF = "7bfab347738c1d7dd59b4b97067bbdaf9633ae26";

const pushOkF07 = (ts: string): string =>
  `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_F07}, run id=41825457594)`;
const pushOk530 = (ts: string): string =>
  `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_530}, run id=41859159358)`;
const pushOk9A7 = (ts: string): string =>
  `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_9A7}, run id=41907815753)`;
const noopOk = (ts: string): string =>
  `${ts} push-main-when-ahead: OK currency current (main == origin/main); nothing to push`;
const checkLine = (ts: string): string =>
  `${ts} push-main-when-ahead --check: ahead=0 behind=0 → noop (local main == origin/main; nothing to push)`;

describe("parseGateEvidenceLine", () => {
  it("parses a timestamped push-ok line: tip lowercased, run id captured", () => {
    const parsed = parseGateEvidenceLine(pushOkF07("2026-11-04T12:01:09.825Z"));
    expect(parsed).toEqual({
      ts: "2026-11-04T12:01:09.825Z",
      kind: "push-ok",
      tip: TIP_F07,
      runId: "41825457594",
    });
  });

  it("parses a bare push-ok line without the ISO timestamp prefix", () => {
    const parsed = parseGateEvidenceLine(
      `push-main-when-ahead: OK main pushed and green (tip ${TIP_530}, run id=41859159358)`
    );
    expect(parsed).toEqual({
      ts: null,
      kind: "push-ok",
      tip: TIP_530,
      runId: "41859159358",
    });
  });

  it("normalizes an uppercase/mixed-case tip to lowercase", () => {
    const parsed = parseGateEvidenceLine(
      `push-main-when-ahead: OK main pushed and green (tip ${TIP_530.toUpperCase()}, run id=1)`
    );
    expect(parsed.kind).toBe("push-ok");
    expect(parsed.tip).toBe(TIP_530);
    expect(parsed.runId).toBe("1");
  });

  it("parses a noop-ok line with its timestamp", () => {
    const parsed = parseGateEvidenceLine(noopOk("2026-11-04T09:56:19.926Z"));
    expect(parsed).toEqual({
      ts: "2026-11-04T09:56:19.926Z",
      kind: "noop-ok",
      tip: null,
      runId: null,
    });
  });

  it("classifies a FAIL line as fail (tip/runId stay null)", () => {
    const parsed = parseGateEvidenceLine(
      "2026-11-04T12:00:00.000Z push-main-when-ahead: FAIL git push origin main failed: remote rejected"
    );
    expect(parsed.kind).toBe("fail");
    expect(parsed.ts).toBe("2026-11-04T12:00:00.000Z");
    expect(parsed.tip).toBeNull();
    expect(parsed.runId).toBeNull();
  });

  it("classifies a --check probe line as check, never as success evidence", () => {
    const parsed = parseGateEvidenceLine(checkLine("2026-11-04T15:42:36.432Z"));
    expect(parsed.kind).toBe("check");
    expect(parsed.ts).toBe("2026-11-04T15:42:36.432Z");
    expect(parsed.tip).toBeNull();
    expect(parsed.runId).toBeNull();
  });

  it("classifies the gate's intermediate narration lines as other with all fields null", () => {
    const narrations = [
      `2026-11-04T11:59:46.953Z push-main-when-ahead: pushing main (${TIP_F07}) to origin/main (single hardcoded refspec, no --force)`,
      `2026-11-04T11:59:49.008Z push-main-when-ahead: pushed; origin/main tip is now ${TIP_F07}; polling for the Actions run on it`,
      `2026-11-04T12:01:08.136Z push-main-when-ahead: tip ${TIP_F07} found on poll #6: run id=41825457594`,
      "2026-11-04T12:00:00.000Z push-main-when-ahead: ahead=3 behind=0 → push (local main is ahead by 3 commit(s); pushing to origin/main)",
    ];
    for (const line of narrations) {
      expect(parseGateEvidenceLine(line)).toEqual({
        ts: null,
        kind: "other",
        tip: null,
        runId: null,
      });
    }
  });

  it("classifies unrelated and empty lines as other", () => {
    expect(parseGateEvidenceLine("")).toEqual({ ts: null, kind: "other", tip: null, runId: null });
    expect(parseGateEvidenceLine("random cron chatter with no gate marker")).toEqual({
      ts: null,
      kind: "other",
      tip: null,
      runId: null,
    });
    expect(parseGateEvidenceLine("2026-11-04T12:00:00.000Z totally unrelated message")).toEqual({
      ts: null,
      kind: "other",
      tip: null,
      runId: null,
    });
  });

  it("rejects a push-ok lookalike whose tip is not a full 40-hex sha (grammar pinning)", () => {
    const parsed = parseGateEvidenceLine(
      "2026-11-04T12:00:00.000Z push-main-when-ahead: OK main pushed and green (tip b23ddf4, run id=123)"
    );
    expect(parsed.kind).toBe("other");
    expect(parsed.tip).toBeNull();
    expect(parsed.ts).toBeNull();
  });

  it("still parses a line carrying a [REDACTED_TOKEN] placeholder (redacted logs stay readable)", () => {
    const parsed = parseGateEvidenceLine(
      "2026-11-04T12:00:00.000Z push-main-when-ahead: FAIL fatal: unable to access " +
        "'https://x-access-token:[REDACTED]@github.com/owner/repo/': [REDACTED_TOKEN] rejected"
    );
    expect(parsed.kind).toBe("fail");
    expect(parsed.ts).toBe("2026-11-04T12:00:00.000Z");
  });
});

describe("findLandingEvidence", () => {
  it("finds the tip-named push-ok evidence out of multiple OK lines, newest-first", () => {
    const lines = [
      pushOkF07("2026-11-04T12:01:09.825Z"),
      "2026-11-04T12:30:00.000Z push-main-when-ahead: FAIL transient poll error",
      noopOk("2026-11-04T14:00:00.000Z"),
      pushOk530("2026-11-04T15:35:48.261Z"),
      checkLine("2026-11-04T15:42:36.432Z"),
    ];
    const result = findLandingEvidence(lines, TIP_530, {
      committedAtIso: null,
      allowNoopFallback: true,
    });
    expect(result.found).toBe(true);
    expect(result.evidence?.kind).toBe("push-ok");
    expect(result.evidence?.tip).toBe(TIP_530);
    expect(result.evidence?.runId).toBe("41859159358");
    expect(result.evidence?.line).toBe(pushOk530("2026-11-04T15:35:48.261Z"));
  });

  it("picks the NEWEST push-ok line when the same tip was gate-run twice (re-run)", () => {
    const lines = [
      "2026-11-04T10:00:00.000Z push-main-when-ahead: OK main pushed and green " +
        `(tip ${TIP_530}, run id=111)`,
      "2026-11-04T11:00:00.000Z push-main-when-ahead: OK main pushed and green " +
        `(tip ${TIP_530}, run id=222)`,
    ];
    const result = findLandingEvidence(lines, TIP_530, {
      committedAtIso: null,
      allowNoopFallback: true,
    });
    expect(result.found).toBe(true);
    expect(result.evidence?.runId).toBe("222");
    expect(result.evidence?.ts).toBe("2026-11-04T11:00:00.000Z");
  });

  it("matches the tip case-insensitively", () => {
    const lines = [pushOkF07("2026-11-04T12:01:09.825Z")];
    const result = findLandingEvidence(lines, TIP_F07.toUpperCase(), {
      committedAtIso: null,
      allowNoopFallback: false,
    });
    expect(result.found).toBe(true);
    expect(result.evidence?.kind).toBe("push-ok");
    expect(result.evidence?.tip).toBe(TIP_F07);
  });

  it("accepts the noop-ok fallback when it postdates the tip commit time", () => {
    const lines = [noopOk("2026-11-04T12:00:00.000Z")];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: "2026-11-04T11:09:43.000Z",
      allowNoopFallback: true,
    });
    expect(result.found).toBe(true);
    expect(result.evidence?.kind).toBe("noop-ok");
    expect(result.reason).toContain("at/after the tip commit time");
  });

  it("rejects the noop-ok fallback when it predates the tip commit time", () => {
    const lines = [noopOk("2026-11-04T10:00:00.000Z")];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: "2026-11-04T11:09:43.000Z",
      allowNoopFallback: true,
    });
    expect(result.found).toBe(false);
    expect(result.evidence).toBeNull();
    expect(result.reason).toContain("predates the tip commit time");
  });

  it("suppresses the noop-ok fallback entirely in strict mode", () => {
    const lines = [noopOk("2026-11-04T12:00:00.000Z")];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: "2026-11-04T11:09:43.000Z",
      allowNoopFallback: false,
    });
    expect(result.found).toBe(false);
    expect(result.reason).toContain("strict mode");
  });

  it("does not accept the noop-ok fallback when the tip commit time is unknown", () => {
    const lines = [noopOk("2026-11-04T12:00:00.000Z")];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: null,
      allowNoopFallback: true,
    });
    expect(result.found).toBe(false);
    expect(result.reason).toContain("tip commit time is unknown");
  });

  it("does not accept a timestamp-less noop-ok line as fallback evidence", () => {
    const lines = [
      "push-main-when-ahead: OK currency current (main == origin/main); nothing to push",
    ];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: "2026-11-04T11:09:43.000Z",
      allowNoopFallback: true,
    });
    expect(result.found).toBe(false);
    expect(result.reason).toContain("lacks a parseable timestamp");
  });

  it("returns not found with a reason for a FAIL-only log", () => {
    const lines = [
      "2026-11-04T10:00:00.000Z push-main-when-ahead: FAIL git push origin main failed",
      checkLine("2026-11-04T10:05:00.000Z"),
      "2026-11-04T10:10:00.000Z push-main-when-ahead: FAIL no completed Actions run",
    ];
    const result = findLandingEvidence(lines, TIP_F07, {
      committedAtIso: "2026-11-04T09:00:00.000Z",
      allowNoopFallback: true,
    });
    expect(result.found).toBe(false);
    expect(result.evidence).toBeNull();
    expect(result.reason).toContain("no gate success evidence");
    expect(result.reason).toContain("scanned 3 line(s)");
  });

  it("returns not found with a reason for an empty log", () => {
    const result = findLandingEvidence([], TIP_F07, {
      committedAtIso: "2026-11-04T11:09:43.000Z",
      allowNoopFallback: true,
    });
    expect(result.found).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("refuses a non-40-hex tip argument instead of guessing", () => {
    const result = findLandingEvidence([pushOkF07("2026-11-04T12:01:09.825Z")], "b23ddf4", {
      committedAtIso: null,
      allowNoopFallback: false,
    });
    expect(result.found).toBe(false);
    expect(result.reason).toContain("invalid tip argument");
  });

  // SUBC-044: descendant-tip acceptance via the injected isTipDescendant
  // predicate. Fixtures are real shas from the live gate log: TIP_504 (the
  // SUBC-026 landing published to origin only as an ancestor of the later
  // gate-pushed tip TIP_9A7, Actions run #29 id 41907815753) and TIP_7BF (the
  // rescue/subc-023-old-main pin — never pushed, the durable negative).
  it("strict mode accepts a descendant-tip push-ok line when the predicate proves ancestry", () => {
    const lines = [pushOk9A7("2026-11-05T15:35:48.261Z")];
    const result = findLandingEvidence(lines, TIP_504, {
      committedAtIso: null,
      allowNoopFallback: false,
      isTipDescendant: (auditedTip, pushedTip) =>
        auditedTip === TIP_504 && pushedTip === TIP_9A7,
    });
    expect(result.found).toBe(true);
    expect(result.evidence?.kind).toBe("push-ok");
    expect(result.evidence?.tip).toBe(TIP_9A7);
    expect(result.evidence?.runId).toBe("41907815753");
    expect(result.matchKind).toBe("descendant-tip");
    expect(result.reason).toContain("descendant");
    expect(result.reason).toContain(TIP_9A7);
    expect(result.reason).toContain(TIP_504);
    expect(result.reason).toContain("run id=41907815753");
  });

  it("strict mode rejects a different tip when the predicate does not prove ancestry", () => {
    const lines = [pushOk9A7("2026-11-05T15:35:48.261Z")];
    const result = findLandingEvidence(lines, TIP_7BF, {
      committedAtIso: null,
      allowNoopFallback: false,
      isTipDescendant: () => false,
    });
    expect(result.found).toBe(false);
    expect(result.evidence).toBeNull();
    expect(result.matchKind).toBeNull();
    expect(result.reason).toContain("no gate success evidence");
    expect(result.reason).toContain("strict mode");
  });

  it("stays exact-only in strict mode when no predicate is supplied (backward compat)", () => {
    const lines = [pushOk9A7("2026-11-05T15:35:48.261Z")];
    const result = findLandingEvidence(lines, TIP_504, {
      committedAtIso: null,
      allowNoopFallback: false,
    });
    expect(result.found).toBe(false);
    expect(result.matchKind).toBeNull();
    expect(result.reason).toContain("none naming this tip");
  });

  it("reports exact-tip via the exact arm even when the predicate would also return true", () => {
    const lines = [pushOk9A7("2026-11-05T15:35:48.261Z")];
    const predicateCalls: string[][] = [];
    const result = findLandingEvidence(lines, TIP_9A7, {
      committedAtIso: null,
      allowNoopFallback: false,
      isTipDescendant: (auditedTip, pushedTip) => {
        predicateCalls.push([auditedTip, pushedTip]);
        return true;
      },
    });
    expect(result.found).toBe(true);
    expect(result.matchKind).toBe("exact-tip");
    expect(predicateCalls).toEqual([]); // the exact arm never consults the predicate
  });

  it("scan-order pin: a NEWER descendant push-ok wins over an OLDER exact push-ok", () => {
    const exact504 = (ts: string): string =>
      `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_504}, run id=1)`;
    const lines = [
      exact504("2026-11-05T10:00:00.000Z"),
      pushOk9A7("2026-11-05T15:35:48.261Z"),
    ];
    const result = findLandingEvidence(lines, TIP_504, {
      committedAtIso: null,
      allowNoopFallback: false,
      isTipDescendant: (auditedTip, pushedTip) =>
        auditedTip === TIP_504 && pushedTip === TIP_9A7,
    });
    expect(result.found).toBe(true);
    expect(result.matchKind).toBe("descendant-tip");
    expect(result.evidence?.tip).toBe(TIP_9A7); // newest acceptable line returned first
  });

  it("default-mode shadowing pin: a qualifying newer noop-ok still shadows an older descendant push-ok", () => {
    const lines = [
      pushOk9A7("2026-11-05T10:00:00.000Z"),
      noopOk("2026-11-05T15:35:48.261Z"),
    ];
    const result = findLandingEvidence(lines, TIP_504, {
      committedAtIso: "2026-11-05T09:00:00.000Z",
      allowNoopFallback: true,
      isTipDescendant: () => true,
    });
    expect(result.found).toBe(true);
    expect(result.matchKind).toBe("noop-fallback");
    expect(result.evidence?.kind).toBe("noop-ok");
  });

  it("throws when isTipDescendant is provided but is not a function (fail-safe)", () => {
    const lines = [pushOk9A7("2026-11-05T15:35:48.261Z")];
    expect(() =>
      findLandingEvidence(lines, TIP_504, {
        committedAtIso: null,
        allowNoopFallback: false,
        isTipDescendant: true as unknown as (a: string, p: string) => boolean,
      })
    ).toThrow(/isTipDescendant/);
  });
});

// ---------------------------------------------------------------------------
// SUBC-044: wiring pins for scripts/verify-landing-gate.mjs (source-text only;
// the checker itself is NEVER imported at runtime — its module top level
// exits). These pin that the descendant evidence decision is actually wired
// to git ancestry in the checker, not just implemented in the pure lib.
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("verify-landing-gate.mjs ancestry wiring (source-text pins)", () => {
  it("builds the ancestry predicate from git merge-base --is-ancestor with a cat-file object guard", () => {
    // Invariant: the checker-side predicate runs git itself (the lib stays
    // zero-import) — the ancestry probe plus the missing-object guard that
    // keeps un-fetchable tips from ever proving ancestry.
    expect(checkerSource).toContain("merge-base");
    expect(checkerSource).toContain("--is-ancestor");
    expect(checkerSource).toContain("cat-file");
    expect(checkerSource).toContain("makeAncestryPredicate(tip)");
  });

  it("passes isTipDescendant into the single findLandingEvidence call site", () => {
    // Invariant: descendant acceptance is injected at the one call site and
    // shared by BOTH modes (strict/default differ only by allowNoopFallback).
    const callIdx = checkerSource.indexOf("findLandingEvidence(");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(countOccurrences(checkerSource, "findLandingEvidence(")).toBe(1);
    const optsIdx = checkerSource.indexOf("isTipDescendant: predicate", callIdx);
    expect(optsIdx).toBeGreaterThan(callIdx);
  });

  it("the OK receipt names the match kind and, for descendant matches, the full pushed tip", () => {
    expect(checkerSource).toContain("match descendant-tip via pushed tip");
    expect(checkerSource).toContain("match ${evidence.matchKind}");
  });

  it("failure diagnostics name non-ancestry and non-evaluable pushed-tip verdicts", () => {
    expect(checkerSource).toContain("not an ancestor of the audited tip");
    expect(checkerSource).toContain("ancestry not evaluable");
    expect(checkerSource).toContain("pushedTips.length < 8"); // bounded, newest-first
    expect(checkerSource).toContain('run "node scripts/push-main-when-ahead.mjs" for'); // remediation kept
  });

  it("stays strictly read-only: no push argv anywhere in the checker", () => {
    expect(checkerSource).not.toMatch(/"push",/);
    expect(checkerSource).not.toContain('"--force"');
  });
});

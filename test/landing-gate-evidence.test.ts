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

const TIP_F07 = "f07eb9304d21b05be5d6a11dcdaccfca5c574612";
const TIP_530 = "530360c7cacf35703a7307a4626372a24a68198e";

const pushOkF07 = (ts: string): string =>
  `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_F07}, run id=41825457594)`;
const pushOk530 = (ts: string): string =>
  `${ts} push-main-when-ahead: OK main pushed and green (tip ${TIP_530}, run id=41859159358)`;
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
});

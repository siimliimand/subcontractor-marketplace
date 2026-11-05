/**
 * Unit tests for the SUBC-008 CI currency guard library
 * (scripts/ci-currency-lib.mjs — pure, zero-import, workerd-pool safe).
 *
 * Each test names concrete input → action → expected observable:
 * these are the guards that keep the push automation from ever pushing a
 * fusion/* branch, force-pushing behind/diverged state, or leaking tokens.
 */
import { describe, expect, it } from "vitest";
import {
  LOCK_STALE_MS,
  assertMainRef,
  buildAdoptionReflogMessage,
  decideAction,
  isFullSha,
  isLockStale,
  parseLsRemoteMain,
  redactLogLine,
  refineRefusalWithTreeIdentity,
  shasEqual,
} from "../scripts/ci-currency-lib.mjs";
// Imported as TEXT only (?raw — same pattern as test/ci-alert-branch.test.ts
// imports ci.yml): the orchestrator's module top level runs the gate, so a
// runtime import would execute it inside the test pool.
import gateSource from "../scripts/push-main-when-ahead.mjs?raw";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("assertMainRef", () => {
  it('accepts the branch name "main"', () => {
    expect(() => assertMainRef("main")).not.toThrow();
  });

  it('throws for fusion worktree branch "fusion/subc-008"', () => {
    expect(() => assertMainRef("fusion/subc-008")).toThrow(/only "main" may ever be/);
  });

  it('throws for fusion worktree branch "fusion/x"', () => {
    expect(() => assertMainRef("fusion/x")).toThrow(/fusion\/x/);
  });

  it('throws for symbolic ref "HEAD"', () => {
    expect(() => assertMainRef("HEAD")).toThrow(/HEAD/);
  });

  it('throws for full ref path "refs/heads/develop"', () => {
    expect(() => assertMainRef("refs/heads/develop")).toThrow(/refs\/heads\/develop/);
  });

  it('throws even for full ref path "refs/heads/main" (refspec argument must be the branch name)', () => {
    expect(() => assertMainRef("refs/heads/main")).toThrow(/only "main" may ever be/);
  });

  it("throws for empty ref", () => {
    expect(() => assertMainRef("")).toThrow(/only "main" may ever be/);
  });
});

describe("decideAction", () => {
  it("(1, 0) → push with a reason naming the push", () => {
    const result = decideAction(1, 0);
    expect(result.action).toBe("push");
    expect(result.reason).toMatch(/ahead by 1/);
  });

  it("(5, 0) → push", () => {
    const result = decideAction(5, 0);
    expect(result.action).toBe("push");
    expect(result.reason).toMatch(/ahead by 5/);
  });

  it("(0, 0) → noop (current, nothing to do)", () => {
    const result = decideAction(0, 0);
    expect(result.action).toBe("noop");
    expect(result.reason).toMatch(/nothing to push/);
  });

  it("(0, 3) → refuse behind-only, naming the required manual action", () => {
    const result = decideAction(0, 3);
    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(/BEHIND origin\/main by 3/);
    expect(result.reason).toMatch(/git fetch origin main/);
  });

  it("(2, 2) → refuse diverged, naming the required manual action", () => {
    const result = decideAction(2, 2);
    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(/DIVERGED \(ahead 2, behind 2\)/);
    expect(result.reason).toMatch(/git fetch origin main/);
  });

  it("refuses negative or non-integer counts instead of guessing", () => {
    expect(() => decideAction(-1, 0)).toThrow(/invalid ahead count/);
    expect(() => decideAction(0, -2)).toThrow(/invalid behind count/);
    expect(() => decideAction(1.5, 0)).toThrow(/invalid ahead count/);
  });
});

describe("parseLsRemoteMain", () => {
  it("parses a single-line listing", () => {
    const out = "82aa7efa925249814e0b2544973c6a8dc3b7e493\trefs/heads/main\n";
    expect(parseLsRemoteMain(out)).toBe("82aa7efa925249814e0b2544973c6a8dc3b7e493");
  });

  it("parses a multi-line listing containing refs/heads/main among other refs", () => {
    const out = [
      "c149faa111111111111111111111111111111111\trefs/heads/archive/phase2",
      "274053d222222222222222222222222222222222\trefs/heads/subc-007-work",
      "82aa7efa925249814e0b2544973c6a8dc3b7e493\trefs/heads/main",
      "41ce310333333333333333333333333333333333\trefs/tags/v1",
      "",
    ].join("\n");
    expect(parseLsRemoteMain(out)).toBe("82aa7efa925249814e0b2544973c6a8dc3b7e493");
  });

  it("does not match a similarly-named ref (refs/heads/mainx)", () => {
    const out = "82aa7efa925249814e0b2544973c6a8dc3b7e493\trefs/heads/mainx\n";
    expect(parseLsRemoteMain(out)).toBeNull();
  });

  it("ignores the symref hint line (ref: refs/heads/main<TAB>HEAD)", () => {
    const out = "ref: refs/heads/main\tHEAD\n82aa7efa925249814e0b2544973c6a8dc3b7e493\trefs/heads/main\n";
    expect(parseLsRemoteMain(out)).toBe("82aa7efa925249814e0b2544973c6a8dc3b7e493");
  });

  it("returns null for empty output", () => {
    expect(parseLsRemoteMain("")).toBeNull();
    expect(parseLsRemoteMain("\n")).toBeNull();
  });

  it("returns null when refs/heads/main is absent", () => {
    const out = "82aa7efa925249814e0b2544973c6a8dc3b7e493\trefs/heads/develop\n";
    expect(parseLsRemoteMain(out)).toBeNull();
  });
});

describe("redactLogLine", () => {
  it("scrubs a synthetic classic ghp_ token", () => {
    const line = "push failed with https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456@github.com/siimliimand/subcontractor-marketplace";
    const redacted = redactLogLine(line);
    expect(redacted).not.toMatch(/ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/);
    expect(redacted).toContain("github.com/siimliimand/subcontractor-marketplace");
  });

  it("scrubs a standalone gho_ token", () => {
    const line = "credential rejected: gho_abcdefghijklmnopqrstuvwxyz012345";
    expect(redactLogLine(line)).not.toMatch(/gho_abcdefghijklmnopqrstuvwxyz012345/);
  });

  it("scrubs a fine-grained github_pat_ token", () => {
    const line = "auth failed for github_pat_11ABCDEFGH0123456789abcdefghijklmnopqrstuv";
    expect(redactLogLine(line)).not.toMatch(/github_pat_11ABCDEFGH0123456789/);
  });

  it("scrubs x-access-token userinfo while preserving URL structure", () => {
    const line = "fatal: unable to access https://x-access-token:sup3rs3cret@github.com/owner/repo/";
    const redacted = redactLogLine(line);
    expect(redacted).not.toMatch(/sup3rs3cret/);
    expect(redacted).toContain("https://x-access-token:[REDACTED]@github.com/owner/repo/");
  });

  it("preserves normal text verbatim", () => {
    const line = "2026-11-03T10:00:00Z OK pushed main 274053d (1 ahead -> 0)";
    expect(redactLogLine(line)).toBe(line);
  });
});

describe("shasEqual", () => {
  it("compares case-insensitively", () => {
    expect(shasEqual("82AA7EFA925249814E0B2544973C6A8DC3B7E493", "82aa7efa925249814e0b2544973c6a8dc3b7e493")).toBe(true);
  });

  it("compares equal lowercase shas", () => {
    expect(shasEqual("274053d0000000000000000000000000000000aa", "274053d0000000000000000000000000000000aa")).toBe(true);
  });

  it("rejects different shas of equal length", () => {
    expect(shasEqual("82aa7efa925249814e0b2544973c6a8dc3b7e493", "82aa7efa925249814e0b2544973c6a8dc3b7e494")).toBe(false);
  });

  it("rejects length mismatches", () => {
    expect(shasEqual("82aa7efa", "82aa7efa925249814e0b2544973c6a8dc3b7e493")).toBe(false);
  });
});

describe("isLockStale", () => {
  it("fresh lock with live pid is not stale", () => {
    expect(isLockStale(0, true)).toBe(false);
    expect(isLockStale(60_000, true)).toBe(false);
  });

  it("lock just under 15 minutes with live pid is not stale", () => {
    expect(isLockStale(LOCK_STALE_MS - 1, true)).toBe(false);
  });

  it("lock held for a full 15 minutes is stale even with live pid", () => {
    expect(isLockStale(LOCK_STALE_MS, true)).toBe(true);
    expect(isLockStale(LOCK_STALE_MS + 1, true)).toBe(true);
  });

  it("dead pid makes any lock stale", () => {
    expect(isLockStale(0, false)).toBe(true);
    expect(isLockStale(1000, false)).toBe(true);
  });
});

describe("isFullSha", () => {
  it("accepts a 40-hex lowercase sha", () => {
    expect(isFullSha("82aa7efa925249814e0b2544973c6a8dc3b7e493")).toBe(true);
  });

  it("accepts a 40-hex uppercase sha", () => {
    expect(isFullSha("82AA7EFA925249814E0B2544973C6A8DC3B7E493")).toBe(true);
  });

  it("rejects 39- and 41-character strings", () => {
    expect(isFullSha("82aa7efa925249814e0b2544973c6a8dc3b7e49")).toBe(false);
    expect(isFullSha("82aa7efa925249814e0b2544973c6a8dc3b7e4933")).toBe(false);
  });

  it("rejects non-hex characters at sha length", () => {
    expect(isFullSha("zzzz7efa925249814e0b2544973c6a8dc3b7e493")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isFullSha(42)).toBe(false);
    expect(isFullSha(null)).toBe(false);
    expect(isFullSha(undefined)).toBe(false);
    expect(isFullSha({ length: 40 })).toBe(false);
  });
});

describe("refineRefusalWithTreeIdentity", () => {
  it("(1, 3, true) → adopt-origin — the SUBC-018 live shape (identical trees)", () => {
    const result = refineRefusalWithTreeIdentity(1, 3, true);
    expect(result.action).toBe("adopt-origin");
    expect(result.reason).toMatch(/DIVERGED \(ahead 1, behind 3\)/);
    expect(result.reason).toMatch(/IDENTICAL trees/);
    expect(result.reason).toMatch(/compare-and-swap update-ref of refs\/heads\/main/);
    expect(result.reason).toMatch(/no push, no merge, no force, no content change/);
  });

  it("(2, 2, true) → adopt-origin (symmetric diverged shape)", () => {
    const result = refineRefusalWithTreeIdentity(2, 2, true);
    expect(result.action).toBe("adopt-origin");
    expect(result.reason).toMatch(/ahead 2, behind 2/);
    expect(result.reason).toMatch(/IDENTICAL trees/);
  });

  it("(2, 2, false) → refuse with the trees-differ wording and manual action", () => {
    const result = refineRefusalWithTreeIdentity(2, 2, false);
    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(/DIVERGED \(ahead 2, behind 2\)/);
    expect(result.reason).toMatch(/trees DIFFER/);
    expect(result.reason).toMatch(/requires a provable tree-identical divergence/);
    expect(result.reason).toMatch(/merge or rebase — never force-push/);
  });

  it("(0, 3, true) → refuse (behind-only boundary — adoption is diverged-only)", () => {
    const result = refineRefusalWithTreeIdentity(0, 3, true);
    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(
      /applies only when local main and origin\/main have diverged \(ahead above zero and behind above zero\)/
    );
  });

  it("(1, 0, true) → refuse (ahead-only never adopts — refinement never returns push)", () => {
    const result = refineRefusalWithTreeIdentity(1, 0, true);
    expect(result.action).toBe("refuse");
  });

  it("(0, 0, true) → refuse (equal never adopts — refinement never returns noop)", () => {
    const result = refineRefusalWithTreeIdentity(0, 0, true);
    expect(result.action).toBe("refuse");
  });

  it("throws for invalid ahead counts with decideAction's exact wording", () => {
    expect(() => refineRefusalWithTreeIdentity(-1, 0, true)).toThrow(/invalid ahead count/);
    expect(() => refineRefusalWithTreeIdentity(1.5, 2, true)).toThrow(/invalid ahead count/);
  });

  it("throws for invalid behind counts", () => {
    expect(() => refineRefusalWithTreeIdentity(1, -2, true)).toThrow(/invalid behind count/);
  });

  it("throws unless treesIdentical is strictly boolean (fail-safe on wrong-typed evidence)", () => {
    // Wrong-typed inputs need a cast: the declaration stays strictly `boolean`
    // for real callers; these casts are the point — the runtime guard must
    // throw rather than silently enable/disable adoption.
    expect(() => refineRefusalWithTreeIdentity(1, 2, "yes" as unknown as boolean)).toThrow(
      /treesIdentical/
    );
    expect(() => refineRefusalWithTreeIdentity(1, 2, undefined as unknown as boolean)).toThrow(
      /treesIdentical/
    );
  });
});

describe("buildAdoptionReflogMessage", () => {
  const ORIGIN_TIP = "61f81e8a11111111111111111111111111111111";
  const LOCAL_TIP = "7bfab34b22222222222222222222222222222222";
  const TREE = "4a55ec8433333333333333333333333333333333";

  it("pins the exact reflog message format (both tips, both trees, SUBC-027 tag)", () => {
    expect(
      buildAdoptionReflogMessage({
        originTip: ORIGIN_TIP,
        localTip: LOCAL_TIP,
        originTree: TREE,
        localTree: TREE,
      })
    ).toBe(
      `push-main-when-ahead: adopted origin/main ${ORIGIN_TIP} over tree-identical diverged ` +
        `local main ${LOCAL_TIP} (tree ${TREE} == ${TREE}, SUBC-027)`
    );
  });

  it("is unchanged by redactLogLine (shas and fixed prose only — log-hygiene invariant)", () => {
    const message = buildAdoptionReflogMessage({
      originTip: ORIGIN_TIP,
      localTip: LOCAL_TIP,
      originTree: TREE,
      localTree: TREE,
    });
    expect(redactLogLine(message)).toBe(message);
  });

  it("throws on a 39-character sha, naming the offending field", () => {
    expect(() =>
      buildAdoptionReflogMessage({
        originTip: ORIGIN_TIP.slice(0, 39),
        localTip: LOCAL_TIP,
        originTree: TREE,
        localTree: TREE,
      })
    ).toThrow(/originTip/);
  });

  it("throws on a refname like main where a sha belongs, naming the offending field", () => {
    expect(() =>
      buildAdoptionReflogMessage({
        originTip: ORIGIN_TIP,
        localTip: "main",
        originTree: TREE,
        localTree: TREE,
      })
    ).toThrow(/localTip/);
  });
});

describe("push-main-when-ahead.mjs adoption wiring (source-text pins)", () => {
  it("pins the compare-and-swap argv order: new value (originTip) BEFORE old value (localTip)", () => {
    // Invariant: git update-ref takes <new-value> <old-value>. Swapping the
    // two silently moves main BACK to the pre-adoption tip when re-run from
    // the adopted state (hazard demonstrated in the scratch-repo rehearsal)
    // — this pin is what keeps the order from regressing.
    expect(gateSource).toMatch(
      /update-ref", "-m", reflogMessage, "refs\/heads\/main", originTip, localTip/
    );
  });

  it("pins the tree-identity probe argv and the exit-1 differ mapping", () => {
    // Invariant: `git diff --quiet` exits 1 on DIFFERING trees — expected
    // control flow, not an error — and the probe must keep mapping
    // status === 1 to { identical: false } instead of throwing.
    expect(gateSource).toMatch(/"diff", "--quiet", localTip, originTip/);
    expect(gateSource).toMatch(/status === 1/);
  });

  it("assertMainRef guards BOTH the push path and the adoption path", () => {
    // Invariant: every path that moves refs/heads/main re-asserts the
    // main-only ref contract (defense-in-depth on top of hardcoded names).
    expect(countOccurrences(gateSource, "assertMainRef(")).toBeGreaterThanOrEqual(2);
  });

  it("the authoritative verify chain runs on BOTH the push path and the adoption path", () => {
    // Invariant: an adopted tip must be proven green by verify-ci-currency
    // exactly like a pushed tip — no self-heal may skip the currency check.
    expect(countOccurrences(gateSource, "VERIFY_SCRIPT")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(gateSource, "runVerifyChain()")).toBeGreaterThanOrEqual(2);
  });

  it("the diverged gating ahead > 0 && behind > 0 appears in both the gate refuse branch and --check", () => {
    // Invariant: adoption is scoped to the diverged shape only — behind-only
    // and ahead-only never reach the refinement, in either consumer.
    expect(countOccurrences(gateSource, "ahead > 0 && behind > 0")).toBeGreaterThanOrEqual(2);
  });

  it("never resets, pulls, or force-pushes anywhere in the gate's code paths", () => {
    // Invariant: the adoption path touches ONLY the local refs/heads/main
    // ref via update-ref — no reset --hard, no pull argv, no force flag.
    expect(gateSource).not.toContain("reset --hard");
    expect(gateSource).not.toContain('"pull"');
    expect(gateSource).not.toContain('"--force"');
  });
});

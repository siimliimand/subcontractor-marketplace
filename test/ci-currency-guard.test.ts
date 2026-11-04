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
  decideAction,
  isLockStale,
  parseLsRemoteMain,
  redactLogLine,
  shasEqual,
} from "../scripts/ci-currency-lib.mjs";

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

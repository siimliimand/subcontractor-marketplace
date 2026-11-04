/**
 * Unit tests for the SUBC-018 ci-failure alert branch naming
 * (scripts/ci-alert-branch.mjs — pure, zero-import, workerd-pool safe),
 * plus wiring assertions over the literal text of
 * .github/workflows/ci.yml (imported `?raw` — no YAML parser dependency).
 *
 * Each unit case names concrete input → action → expected observable:
 * the alert names the PR head branch for pull_request runs (the reported
 * symptom had it name the merge ref "1/merge"), while push and
 * workflow_dispatch runs keep `github.ref_name` unchanged. The wiring
 * assertions pin the workflow file to the fallback expression so a revert
 * to bare `github.ref_name` fails here, and guard the env-indirection
 * pattern (the head-ref expression must never be interpolated into the
 * run: script — fork head refs are attacker-influenced input).
 */
import { describe, expect, it } from "vitest";
import { resolveAlertBranch } from "../scripts/ci-alert-branch.mjs";
import ciYaml from "../.github/workflows/ci.yml?raw";

describe("resolveAlertBranch", () => {
  it("(1) reported symptom input: pull_request merge ref + head ref → head ref", () => {
    expect(
      resolveAlertBranch({
        eventName: "pull_request",
        refName: "1/merge",
        headRef: "ci-gate-probe/20261104",
      })
    ).toBe("ci-gate-probe/20261104");
  });

  it("(2) push: no head ref → refName (push behavior unchanged)", () => {
    expect(resolveAlertBranch({ eventName: "push", refName: "main", headRef: undefined })).toBe("main");
  });

  it("(3) workflow_dispatch: no head ref → refName (manual backfill unchanged)", () => {
    expect(resolveAlertBranch({ eventName: "workflow_dispatch", refName: "main", headRef: undefined })).toBe("main");
  });

  it("(4) pull_request with empty head ref → refName (empty string is falsy, mirroring ||)", () => {
    expect(resolveAlertBranch({ eventName: "pull_request", refName: "1/merge", headRef: "" })).toBe("1/merge");
  });

  it("(5) pull_request with missing head ref → refName (fallback)", () => {
    expect(resolveAlertBranch({ eventName: "pull_request", refName: "3/merge", headRef: undefined })).toBe("3/merge");
  });

  it("(6) push with an (impossible) head ref present → refName (head ref never leaks into non-PR events)", () => {
    expect(resolveAlertBranch({ eventName: "push", refName: "feature/x", headRef: "irrelevant" })).toBe("feature/x");
  });
});

describe(".github/workflows/ci.yml wiring", () => {
  it("maps REF to the head-ref-first fallback expression", () => {
    expect(ciYaml).toContain("REF: ${{ github.event.pull_request.head.ref || github.ref_name }}");
  });

  it("keeps the ref_name fallback tail (push/dispatch behavior anchor)", () => {
    expect(ciYaml).toContain("|| github.ref_name");
  });

  it("notify job gate intact: needs test + if failure()", () => {
    expect(ciYaml).toContain("needs: test");
    expect(ciYaml).toContain("if: failure()");
  });

  it('issue title still consumes ${REF} (create path)', () => {
    expect(ciYaml).toContain('gh issue create --title "CI failed on ${REF}"');
  });

  it('issue body still consumes ${REF} (create and comment paths)', () => {
    expect(ciYaml).toContain('body="CI failed on ${REF}');
  });

  it("head-ref expression occurs exactly once, in the env mapping only — never interpolated into run:", () => {
    const occurrences = ciYaml.split("github.event.pull_request.head.ref").length - 1;
    expect(occurrences).toBe(1);
  });
});

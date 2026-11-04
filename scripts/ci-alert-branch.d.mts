/**
 * Type declarations for scripts/ci-alert-branch.mjs (SUBC-018).
 * Consumed by test/ci-alert-branch.test.ts under strict tsc.
 */

export declare type AlertBranchInput = {
  eventName?: string | undefined;
  refName?: string | undefined;
  headRef?: string | undefined;
};

/**
 * Resolve the branch name a ci-failure alert should display. Mirrors the
 * notify job's REF mapping 1:1: PR head ref for pull_request runs with a
 * non-empty head ref, `refName` (github.ref_name) otherwise.
 */
export declare function resolveAlertBranch(input: AlertBranchInput): string;

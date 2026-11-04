/**
 * CI failure-alert branch naming (SUBC-018) — pure, zero-import decision
 * logic mirroring the notify job's REF mapping in .github/workflows/ci.yml:
 *
 *     REF: ${{ github.event.pull_request.head.ref || github.ref_name }}
 *
 * Zero `import` statements: the project's vitest suite runs in the
 * @cloudflare/vitest-pool-workers workerd pool, where Node builtins are
 * unavailable. Everything with I/O lives in the workflow file; the
 * decision logic that must be unit-tested lives here.
 *
 * Why this exists: a pull_request run executes the workflow on the merge
 * ref (refs/pull/N/merge), so `github.ref_name` reads "N/merge" — opaque
 * to the founder triaging a ci-failure alert. The alert must name the
 * branch the change actually lives on (the PR head branch) for
 * pull_request runs, while push and workflow_dispatch runs keep
 * `github.ref_name` byte-for-byte unchanged (their event context has no
 * pull_request object, so the expression's `||` fallback fires).
 */

/**
 * Resolve the branch name a ci-failure alert should display.
 *
 * Mirrors the workflow expression
 * `github.event.pull_request.head.ref || github.ref_name` 1:1: the head ref
 * wins only when the event is `pull_request` AND the head ref is a
 * non-empty string (GitHub expression `||` treats an empty string as
 * falsy); every other event surface — push, workflow_dispatch, a PR event
 * with a missing/empty head ref — falls back to `refName`.
 *
 * @param {{ eventName?: string, refName?: string, headRef?: string }} input
 * @returns {string} the branch name for the alert title/body
 */
export function resolveAlertBranch({ eventName, refName, headRef }) {
  if (eventName === "pull_request" && typeof headRef === "string" && headRef !== "") {
    return headRef;
  }
  return refName;
}

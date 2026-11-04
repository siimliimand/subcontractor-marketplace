/**
 * CI currency guard library — pure, zero-import decision logic shared by
 * scripts/push-main-when-ahead.mjs and test/ci-currency-guard.test.ts.
 *
 * Zero `import` statements: the project's vitest suite runs in the
 * @cloudflare/vitest-pool-workers workerd pool, where `node:child_process`
 * and other Node builtins are unavailable. Everything with I/O lives in the
 * orchestrator script; everything that must be unit-tested lives here.
 *
 * Introduced by SUBC-008: the scheduled/agent-triggered push-when-ahead
 * watchdog that guarantees every landing on local `main` reaches
 * `origin/main` and goes green (see agents.md, "Auto-push on landing").
 *
 * Guarantees encoded here:
 *   - ONLY the branch name `main` is ever a valid ref to operate on
 *     (`fusion/*` task branches are never pushed).
 *   - Never push when behind or diverged (no auto-merge, no force).
 *   - Any string destined for a log or alert file is scrubbed of
 *     credential material before it is written.
 */

/** A lock older than this (or held by a dead pid) is considered stale and may be stolen. */
export const LOCK_STALE_MS = 15 * 60 * 1000;

/**
 * The only ref this mechanism may ever act on. Throws for anything else —
 * `fusion/*` worktree branches, `HEAD`, full ref paths, empty strings.
 *
 * @param {string} ref
 * @returns {asserts ref is "main"}
 */
export function assertMainRef(ref) {
  if (ref !== "main") {
    throw new Error(
      `refusing to operate on ref "${String(ref)}": only "main" may ever be ` +
        `pushed by this mechanism (fusion/* task branches are never pushed)`
    );
  }
}

/**
 * Decide what to do given ahead/behind counts between local main and origin/main.
 *
 * @param {number} ahead commits on local main missing from origin/main
 * @param {number} behind commits on origin/main missing from local main
 * @returns {{ action: "push" | "noop" | "refuse", reason: string }}
 */
export function decideAction(ahead, behind) {
  if (!Number.isInteger(ahead) || ahead < 0) {
    throw new Error(`invalid ahead count: ${String(ahead)} (must be a non-negative integer)`);
  }
  if (!Number.isInteger(behind) || behind < 0) {
    throw new Error(`invalid behind count: ${String(behind)} (must be a non-negative integer)`);
  }
  if (ahead > 0 && behind === 0) {
    return {
      action: "push",
      reason: `local main is ahead by ${ahead} commit(s); pushing to origin/main`,
    };
  }
  if (ahead === 0 && behind === 0) {
    return { action: "noop", reason: "local main == origin/main; nothing to push" };
  }
  if (ahead > 0) {
    return {
      action: "refuse",
      reason:
        `local main and origin/main have DIVERGED (ahead ${ahead}, behind ${behind}); ` +
        `refusing to push (no auto-merge, no force). Required manual action: ` +
        `git fetch origin main, reconcile locally (merge or rebase), then re-run`,
    };
  }
  return {
    action: "refuse",
    reason:
      `local main is BEHIND origin/main by ${behind} commit(s); refusing to push. ` +
      `Required manual action: git fetch origin main, inspect origin/main, ` +
      `reconcile locally if needed, then re-run`,
  };
}

/**
 * Extract the sha of `refs/heads/main` from `git ls-remote` output.
 * Handles single-line and multi-line listings; ignores lines that merely
 * contain similar names (e.g. `refs/heads/mainx`) and symref hint lines
 * (`ref: refs/heads/main<TAB>HEAD`). Returns null when absent or malformed.
 *
 * @param {string} output raw ls-remote stdout
 * @returns {string | null}
 */
export function parseLsRemoteMain(output) {
  const text = typeof output === "string" ? output : "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 2) continue;
    const sha = fields[0];
    const refname = fields[fields.length - 1];
    if (refname !== "refs/heads/main") continue;
    if (typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha)) {
      return sha.toLowerCase();
    }
  }
  return null;
}

/** Matches classic/OAuth/server app token shapes: ghp_/gho_/ghu_/ghs_/ghr_ + hex-ish body. */
const GH_TOKEN_RE = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g;
/** Matches fine-grained personal access tokens: github_pat_ + base62 body. */
const GH_FINEGRAINED_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
/** Matches git HTTPS userinfo carrying a token: x-access-token:<secret>@ */
const X_ACCESS_TOKEN_RE = /x-access-token:[^@\s/]+@/g;
const TOKEN_PLACEHOLDER = "[REDACTED_TOKEN]";

/**
 * Scrub credential material from any string destined for logs, alerts, or
 * commit messages. Removes ghp_/gho_/ghu_/ghs_/ghr_/github_pat_ tokens and
 * `x-access-token:<secret>@` userinfo; all other text is preserved verbatim.
 *
 * @param {string} line
 * @returns {string}
 */
export function redactLogLine(line) {
  let out = typeof line === "string" ? line : String(line ?? "");
  out = out.replace(X_ACCESS_TOKEN_RE, "x-access-token:[REDACTED]@");
  out = out.replace(GH_TOKEN_RE, TOKEN_PLACEHOLDER);
  out = out.replace(GH_FINEGRAINED_RE, TOKEN_PLACEHOLDER);
  return out;
}

/**
 * Case-insensitive full-sha comparison (git may print shas in either case;
 * GitHub API returns lowercase).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function shasEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Lock-steal decision: a lock is stale when its recorded pid is dead, or
 * when it has been held for at least LOCK_STALE_MS (15 minutes). An unknown
 * pid-alive value is treated as stale (fail-safe: prefer stealing a possibly
 * wedged lock over deadlocking the watchdog).
 *
 * @param {number} ageMs how long the lock has existed
 * @param {boolean} pidAlive whether the pid recorded in the lock is alive
 * @returns {boolean}
 */
export function isLockStale(ageMs, pidAlive) {
  if (pidAlive !== true) return true;
  return ageMs >= LOCK_STALE_MS;
}

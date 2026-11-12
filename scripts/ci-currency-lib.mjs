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
 *   - Never push when behind or diverged (no auto-merge, no force). The two
 *     provably harmless non-current shapes are healed instead, each with its
 *     own proof, both via a compare-and-swap update-ref of refs/heads/main
 *     only — still never a push, merge, or force:
 *       - diverged tips with IDENTICAL trees → ADOPT the origin tip locally
 *         (refineRefusalWithTreeIdentity + buildAdoptionReflogMessage,
 *         SUBC-027);
 *       - strictly-behind local main with nothing ahead → FAST-FORWARD the
 *         local ref onto the origin tip (refineRefusalWithFastForward +
 *         buildFastForwardReflogMessage, SUBC-045).
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
 * Should the landing gate loop its push path once more? The SUBC-058
 * mid-flush retry decision. Observed live on SUBC-052: the gate pushed tip
 * 906c1711, its Actions run completed with conclusion=success, and a
 * concurrent engine landing (f961eb0) joined local main during the ~95 s
 * poll — the post-push verify then failed ("local main NOT fully pushed")
 * and the old gate gave up with an alert + exit 1 even though the push had
 * already landed and gone green.
 *
 * When the freshly re-measured counts are STILL strictly ahead-only
 * (behind === 0 && ahead > 0) and the loop bound is not yet reached, the
 * state is exactly "a landing joined mid-flush" and re-running the push
 * path absorbs it. Every other shape must rethrow into the gate's outer
 * catch (alert + FAIL + exit 1):
 *   - behind > 0 (behind-only or diverged) — not strictly ahead-only; the
 *     next invocation's decideAction owns refuse shapes (and SUBC-045 owns
 *     behind-only adoption); the retry loop never adopts mid-loop.
 *   - ahead === 0 && behind === 0 — currency holds; the verify failure is
 *     unrelated to the push and must stay loud.
 *   - attempt >= maxAttempts — the bounded loop is exhausted; the remaining
 *     ahead-only state surfaces through the alert path.
 *
 * Pure and zero-import: takes the counts the gate re-measured after a
 * `git fetch` plus the attempt bookkeeping; no I/O, no clock.
 *
 * @param {{ ahead: number, behind: number, attempt: number, maxAttempts: number }} inputs
 * @param {number} inputs.ahead commits on local main missing from origin/main, re-measured after the failed verify
 * @param {number} inputs.behind commits on origin/main missing from local main, re-measured after the failed verify
 * @param {number} inputs.attempt the 1-based push attempt that just failed its post-push verify
 * @param {number} inputs.maxAttempts the loop bound (MAX_PUSH_ATTEMPTS in the gate script)
 * @returns {{ retry: boolean, reason: string }}
 */
export function shouldLoopPushPath({ ahead, behind, attempt, maxAttempts }) {
  if (!Number.isInteger(ahead) || ahead < 0) {
    throw new Error(`invalid ahead count: ${String(ahead)} (must be a non-negative integer)`);
  }
  if (!Number.isInteger(behind) || behind < 0) {
    throw new Error(`invalid behind count: ${String(behind)} (must be a non-negative integer)`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`invalid attempt: ${String(attempt)} (must be an integer >= 1)`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`invalid maxAttempts: ${String(maxAttempts)} (must be an integer >= 1)`);
  }
  if (behind !== 0) {
    if (ahead > 0) {
      return {
        retry: false,
        reason:
          `local main DIVERGED from origin/main mid-loop (ahead ${ahead}, behind ${behind}): ` +
          `not strictly ahead-only; refusing to auto-retry (no auto-merge, no force) — ` +
          `the next invocation's decideAction owns refuse shapes`,
      };
    }
    return {
      retry: false,
      reason:
        `local main is BEHIND origin/main mid-loop (ahead 0, behind ${behind}): ` +
        `not strictly ahead-only; refusing to auto-retry — ` +
        `the next invocation's decideAction owns refuse shapes`,
    };
  }
  if (ahead === 0) {
    return {
      retry: false,
      reason:
        `currency holds (ahead 0, behind 0): the verify failure is unrelated to the push; ` +
        `not retrying — the failure must stay loud`,
    };
  }
  if (attempt >= maxAttempts) {
    return {
      retry: false,
      reason:
        `push attempt ${attempt} of ${maxAttempts} failed its post-push verify with main ` +
        `still ahead-only (${ahead} commit(s)): retry bound exhausted; not retrying`,
    };
  }
  return {
    retry: true,
    reason:
      `a concurrent landing joined local main mid-flush (ahead ${ahead}, behind ${behind}) ` +
      `after push attempt ${attempt} of ${maxAttempts} failed its post-push verify: ` +
      `re-checking and re-running the push path (next attempt ${attempt + 1} of ${maxAttempts})`,
  };
}

/**
 * True only for a string of exactly 40 hexadecimal characters — a full
 * object id as printed by `git rev-parse` (uppercase accepted; comparisons
 * elsewhere stay case-insensitive). Owns the shape previously inlined in
 * parseLsRemoteMain, and doubles as the input validator for the SUBC-027
 * adoption helpers below.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFullSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
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
    if (isFullSha(sha)) {
      return sha.toLowerCase();
    }
  }
  return null;
}

/**
 * Refine a diverged-shape refusal (ahead > 0 && behind > 0) with proven tree
 * identity — the SUBC-027 automation of the manual repair recipe repeated by
 * hand across the SUBC-018/SUBC-022/SUBC-023-class ops tasks. When the two
 * tips carry the SAME tree (empty `git diff` proof), the landing gate may
 * heal the divergence by adopting the origin tip via a compare-and-swap
 * update-ref of refs/heads/main — content-neutral, local-ref-only.
 *
 * Never returns push or noop: the refinement only ever converts a diverged
 * refusal into adopt-origin, or leaves it a refusal. Behind-only, ahead-only,
 * and equal shapes stay refusals — adoption is scoped to diverged only.
 *
 * @param {number} ahead commits on local main missing from origin/main
 * @param {number} behind commits on origin/main missing from local main
 * @param {boolean} treesIdentical whether an empty-diff probe proved the tips' trees identical
 * @returns {{ action: "adopt-origin" | "refuse", reason: string }}
 */
export function refineRefusalWithTreeIdentity(ahead, behind, treesIdentical) {
  if (!Number.isInteger(ahead) || ahead < 0) {
    throw new Error(`invalid ahead count: ${String(ahead)} (must be a non-negative integer)`);
  }
  if (!Number.isInteger(behind) || behind < 0) {
    throw new Error(`invalid behind count: ${String(behind)} (must be a non-negative integer)`);
  }
  if (typeof treesIdentical !== "boolean") {
    throw new Error(
      `invalid treesIdentical evidence: ${String(treesIdentical)} ` +
        `(must be a boolean — wrong-typed evidence must never silently enable or disable adoption)`
    );
  }
  if (ahead > 0 && behind > 0) {
    if (treesIdentical) {
      return {
        action: "adopt-origin",
        reason:
          `local main and origin/main have DIVERGED (ahead ${ahead}, behind ${behind}) with ` +
          `IDENTICAL trees (empty-diff proof): adopting the origin tip via compare-and-swap ` +
          `update-ref of refs/heads/main (no push, no merge, no force, no content change)`,
      };
    }
    return {
      action: "refuse",
      reason:
        `local main and origin/main have DIVERGED (ahead ${ahead}, behind ${behind}) and the ` +
        `trees DIFFER: adoption requires a provable tree-identical divergence (empty diff). ` +
        `Required manual action: git fetch origin main, reconcile locally (merge or rebase — ` +
        `never force-push), then re-run`,
    };
  }
  return {
    action: "refuse",
    reason:
      `tree-identity adoption applies only when local main and origin/main have diverged ` +
      `(ahead above zero and behind above zero); this shape (ahead ${ahead}, behind ${behind}) ` +
      `keeps the original decision`,
  };
}

/**
 * Refine a behind-only refusal (ahead === 0 && behind > 0) with the strict
 * fast-forward shape — the SUBC-045 automation of the last remaining
 * manual-repair shape the landing gate could not heal itself. When local
 * main has NOTHING ahead of origin/main, the origin tip provably already
 * CONTAINS the local tip (ahead = 0 is the containment proof), so healing
 * is a strict fast-forward: the gate may move the LOCAL ref onto the origin
 * tip via a compare-and-swap update-ref of refs/heads/main —
 * content-neutral, local-ref-only, with the ancestry re-proven again at
 * CAS time in the orchestrator.
 *
 * Never returns push or noop: the refinement only ever converts a
 * behind-only refusal into ffadopt-origin, or leaves it a refusal. Diverged,
 * ahead-only, and equal shapes stay refusals — fast-forward adoption is
 * scoped to strictly-behind only (the diverged shape belongs to
 * refineRefusalWithTreeIdentity; the two refinements are additive siblings
 * and neither ever widens the other's scope).
 *
 * @param {number} ahead commits on local main missing from origin/main
 * @param {number} behind commits on origin/main missing from local main
 * @returns {{ action: "ffadopt-origin" | "refuse", reason: string }}
 */
export function refineRefusalWithFastForward(ahead, behind) {
  if (!Number.isInteger(ahead) || ahead < 0) {
    throw new Error(`invalid ahead count: ${String(ahead)} (must be a non-negative integer)`);
  }
  if (!Number.isInteger(behind) || behind < 0) {
    throw new Error(`invalid behind count: ${String(behind)} (must be a non-negative integer)`);
  }
  if (ahead === 0 && behind > 0) {
    return {
      action: "ffadopt-origin",
      reason:
        `local main is BEHIND origin/main by ${behind} commit(s) with nothing ahead ` +
        `(strict fast-forward shape): fast-forwarding refs/heads/main onto the origin tip ` +
        `via compare-and-swap update-ref (no push, no merge, no force, no content change — ` +
        `the origin tip already contains the local tip)`,
    };
  }
  return {
    action: "refuse",
    reason:
      `fast-forward adoption applies only when local main is strictly behind origin/main ` +
      `(ahead equals zero); this shape (ahead ${ahead}, behind ${behind}) keeps the original decision`,
  };
}

/**
 * Build the reflog message recorded by a tree-identity adoption (SUBC-027).
 * The format is pinned verbatim by a unit test: it is the audit record that
 * names both tips and both trees, and it deliberately carries only shas and
 * fixed prose — redactLogLine leaves it unchanged.
 *
 * @param {{ originTip: string, localTip: string, originTree: string, localTree: string }} tips
 * @returns {string}
 */
export function buildAdoptionReflogMessage({ originTip, localTip, originTree, localTree }) {
  const fields = [
    ["originTip", originTip],
    ["localTip", localTip],
    ["originTree", originTree],
    ["localTree", localTree],
  ];
  for (const [field, value] of fields) {
    if (!isFullSha(value)) {
      throw new Error(`invalid ${field}: ${String(value)} (must be a full 40-hex sha)`);
    }
  }
  return (
    `push-main-when-ahead: adopted origin/main ${originTip} over ` +
    `tree-identical diverged local main ${localTip} ` +
    `(tree ${originTree} == ${localTree}, SUBC-027)`
  );
}

/**
 * Build the reflog message recorded by a behind-only fast-forward adoption
 * (SUBC-045). The format is pinned verbatim by a unit test: it is the audit
 * record that names both tips and the shape proof, and it deliberately
 * carries only shas and fixed prose — redactLogLine leaves it unchanged
 * (mirroring the SUBC-027 log-hygiene pin).
 *
 * @param {{ originTip: string, localTip: string }} tips
 * @returns {string}
 */
export function buildFastForwardReflogMessage({ originTip, localTip }) {
  const fields = [
    ["originTip", originTip],
    ["localTip", localTip],
  ];
  for (const [field, value] of fields) {
    if (!isFullSha(value)) {
      throw new Error(`invalid ${field}: ${String(value)} (must be a full 40-hex sha)`);
    }
  }
  return (
    `push-main-when-ahead: fast-forwarded refs/heads/main onto origin/main ${originTip} ` +
    `over behind-only local main ${localTip} (strict fast-forward, SUBC-045)`
  );
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

/* -------------------------------------------------------------------------
 * Landing-gate evidence grammar (SUBC-028).
 *
 * The watchdog appends every run's outcome to
 * ~/.local/state/ci-currency/auto-push.log as `<ISO-8601 ts> <message>`.
 * Only these message shapes prove a gate SUCCESS, and they are pinned here
 * verbatim so a skipped landing can never pass verification:
 *
 *   push-main-when-ahead: OK main pushed and green (tip <40-hex>, run id <digits>)
 *   push-main-when-ahead: OK adopted origin/main tip <40-hex> (tree-identical diverged local main healed)
 *   push-main-when-ahead: OK fast-forwarded local main onto origin/main tip <40-hex> (behind-only local main healed)
 *   push-main-when-ahead: OK currency current (main == origin/main); nothing to push
 *
 * The adoption-family OK lines (SUBC-045) make both self-heal shapes
 * machine-checkable landings: a gate run that healed main by adopting the
 * origin tip — either via proven tree identity (SUBC-027) or via the
 * strict fast-forward shape — leaves a recognized receipt exactly like a
 * push does. (The SUBC-027 adopt line existed before this grammar was
 * extended: SUBC-028's original two-shape grammar never classified it, so
 * tree-identity adoptions could never earn a strict landing receipt.)
 *
 * Everything else the gate writes (FAIL lines, `--check` probe lines, and the
 * intermediate push/poll/verify narration) is deliberately non-evidence.
 * SUBC-020 diagnosed three landings skipped without a gate run; this grammar
 * is what makes that skip machine-detectable (consumed by
 * scripts/verify-landing-gate.mjs, the read-only landing checker).
 *
 * SUBC-044 extended the ACCEPTANCE rule without touching the grammar: a
 * strict audit now also accepts a push-ok line whose pushed tip provably
 * descends from the audited tip (a later legitimate gate push necessarily
 * carried the audited commit to origin history). The predicate proving
 * ancestry is INJECTED (isTipDescendant in findLandingEvidence opts) so this
 * pure lib stays zero-import; exact-tip matches keep precedence in the
 * newest-first scan and every other rule (noop-ok fallback, strict-mode
 * suppression) is unchanged. SUBC-045 adds the two adoption-family kinds to
 * the tip-named acceptance set with EXACT-tip matching only — the
 * descendant predicate stays scoped to push-ok lines (an adoption naming a
 * different tip carries no pushed-run ancestry story).
 * ------------------------------------------------------------------------- */

/** Leading `<ISO-8601> ` prefix as written by the watchdog's appendLog (Z only). */
const GATE_LOG_TS_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s+(.+)$/;
/** Verbatim success line emitted after a push reached origin and CI went green. */
const GATE_PUSH_OK_RE =
  /^push-main-when-ahead: OK main pushed and green \(tip ([0-9a-f]{40}), run id=(\d+)\)$/i;
/**
 * Verbatim success line emitted when a behind-only local main was healed by
 * a strict fast-forward onto the origin tip (SUBC-045).
 */
const GATE_FFADOPT_OK_RE =
  /^push-main-when-ahead: OK fast-forwarded local main onto origin\/main tip ([0-9a-f]{40}) \(behind-only local main healed\)$/i;
/**
 * Verbatim success line emitted when a tree-identical diverged local main
 * was healed by adopting the origin tip (emitted by the gate since SUBC-027;
 * recognized as landing evidence from SUBC-045 — the SUBC-028 grammar
 * predates the line and never classified it).
 */
const GATE_ADOPT_OK_RE =
  /^push-main-when-ahead: OK adopted origin\/main tip ([0-9a-f]{40}) \(tree-identical diverged local main healed\)$/i;
/** Verbatim success line emitted when currency already held (nothing to push). */
const GATE_NOOP_OK_PREFIX = "push-main-when-ahead: OK currency current";
/** Failure lines start with this prefix followed by a space and the detail. */
const GATE_FAIL_PREFIX = "push-main-when-ahead: FAIL";
/** Report-only probe lines carry the `--check` marker and are never evidence. */
const GATE_CHECK_PREFIX = "push-main-when-ahead --check:";

/** @param {string} iso @returns {number | null} epoch ms, or null when unparseable */
function toEpochMs(iso) {
  if (typeof iso !== "string" || iso === "") return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Classify one line of ~/.local/state/ci-currency/auto-push.log.
 *
 * Recognizes an optional leading ISO-8601 timestamp, then the gate's own
 * grammars: the tip-named push success (→ "push-ok", tip lowercased, run id
 * captured), the tip-named adoption successes (→ "adopt-ok" / "ffadopt-ok",
 * tip lowercased, run id null — SUBC-045), the currency-current success (→
 * "noop-ok"), FAIL lines (→ "fail"), and `--check` probe lines (→ "check").
 * Any other line — including the gate's intermediate push/poll/verify
 * narration and malformed lookalikes — classifies as "other" with ALL
 * fields null.
 *
 * @param {string} line raw log line (timestamped or bare)
 * @returns {{ ts: string | null, kind: "push-ok" | "adopt-ok" | "ffadopt-ok" | "noop-ok" | "fail" | "check" | "other", tip: string | null, runId: string | null }}
 */
export function parseGateEvidenceLine(line) {
  const raw = typeof line === "string" ? line : "";
  const prefixed = GATE_LOG_TS_PREFIX_RE.exec(raw);
  const ts = prefixed !== null ? prefixed[1] : null;
  const body = (prefixed !== null ? prefixed[2] : raw).trim();

  const pushOk = GATE_PUSH_OK_RE.exec(body);
  if (pushOk !== null) {
    return { ts, kind: "push-ok", tip: pushOk[1].toLowerCase(), runId: pushOk[2] };
  }
  const ffadoptOk = GATE_FFADOPT_OK_RE.exec(body);
  if (ffadoptOk !== null) {
    return { ts, kind: "ffadopt-ok", tip: ffadoptOk[1].toLowerCase(), runId: null };
  }
  const adoptOk = GATE_ADOPT_OK_RE.exec(body);
  if (adoptOk !== null) {
    return { ts, kind: "adopt-ok", tip: adoptOk[1].toLowerCase(), runId: null };
  }
  if (body.startsWith(GATE_NOOP_OK_PREFIX)) {
    return { ts, kind: "noop-ok", tip: null, runId: null };
  }
  if (body === GATE_FAIL_PREFIX || body.startsWith(`${GATE_FAIL_PREFIX} `)) {
    return { ts, kind: "fail", tip: null, runId: null };
  }
  if (body.startsWith(GATE_CHECK_PREFIX)) {
    return { ts, kind: "check", tip: null, runId: null };
  }
  return { ts: null, kind: "other", tip: null, runId: null };
}

/**
 * Decide whether the watchdog log proves the landing gate ran for `tip`.
 *
 * Scans newest-first (the log is append-only and chronological); the newest
 * acceptable evidence wins. Strict mode (allowNoopFallback === false)
 * accepts ONLY tip-named push-ok/adopt-ok/ffadopt-ok evidence — a line whose
 * tip EQUALS `tip` case-insensitively (matchKind "exact-tip") and, for
 * push-ok lines alone, one whose pushed tip provably DESCENDS from `tip`
 * when the injected isTipDescendant predicate returns true (matchKind
 * "descendant-tip", SUBC-044: a later legitimate gate push necessarily
 * carried the audited commit to origin history). Adoption-family evidence
 * is exact-tip only by design (SUBC-045): an adoption naming a different
 * tip carries no pushed-run ancestry story, so it can never stand in for
 * another tip. Default mode additionally accepts the newest noop-ok line
 * whose timestamp parses at or after the tip's committer time (matchKind
 * "noop-fallback"): a gate run that observed currency already holding
 * proves the tip was published (paired with the live currency check the
 * read-only verifier chains, this cannot mask an unpublished tip). Because
 * the scan is newest-first and one acceptable line returns immediately,
 * default-mode scan-order semantics are preserved: a qualifying newer
 * noop-ok may shadow an OLDER descendant push-ok, exactly as it already
 * could shadow an older exact push-ok.
 *
 * Ancestry is only ever consulted when the parsed tip differs from the
 * audited tip — exact equality is decided in the exact arm alone and never
 * re-derived through the predicate. The predicate must explicitly return
 * true to prove ancestry; false or a non-evaluable verdict (e.g. the pushed
 * tip object is missing locally) rejects the line. A non-function
 * isTipDescendant value throws immediately (fail-safe, mirroring
 * refineRefusalWithTreeIdentity's evidence validation).
 *
 * Returns `{ found, evidence, reason, matchKind }`; `reason` is a diagnostic
 * string in EVERY case (named failure mode when not found, evidence summary
 * when found) so the checker can print exactly why a landing failed
 * verification. `matchKind` names how the evidence matched: "exact-tip",
 * "descendant-tip", "noop-fallback", or null when nothing was found.
 *
 * @param {string[]} lines log lines in chronological (oldest-first) order
 * @param {string} tip full 40-hex sha of the landing tip under audit
 * @param {{ committedAtIso: string | null, allowNoopFallback: boolean, isTipDescendant?: (auditedTip: string, pushedTip: string) => boolean }} opts
 * @returns {{ found: boolean, evidence: ({ ts: string | null, kind: "push-ok" | "adopt-ok" | "ffadopt-ok" | "noop-ok" | "fail" | "check" | "other", tip: string | null, runId: string | null, line: string }) | null, reason: string, matchKind: "exact-tip" | "descendant-tip" | "noop-fallback" | null }}
 */
export function findLandingEvidence(lines, tip, opts) {
  const arr = Array.isArray(lines) ? lines : [];
  const optsSafe = opts ?? {};
  const tipNorm = typeof tip === "string" ? tip.trim().toLowerCase() : "";
  const isTipDescendant = optsSafe.isTipDescendant;
  if (isTipDescendant !== undefined && typeof isTipDescendant !== "function") {
    throw new Error(
      `invalid isTipDescendant evidence: ${String(isTipDescendant)} ` +
        `(must be a function (auditedTip, pushedTip) => boolean — wrong-typed ` +
        `evidence must never silently enable or disable descendant acceptance)`
    );
  }
  if (!/^[0-9a-f]{40}$/.test(tipNorm)) {
    return {
      found: false,
      evidence: null,
      matchKind: null,
      reason: `invalid tip argument "${String(tip)}": expected a full 40-hex sha`,
    };
  }
  if (arr.length === 0) {
    return {
      found: false,
      evidence: null,
      matchKind: null,
      reason: "landing-gate log is empty: no lines to scan",
    };
  }

  const allowNoop = optsSafe.allowNoopFallback === true;
  const committedAtMs = toEpochMs(typeof optsSafe.committedAtIso === "string" ? optsSafe.committedAtIso : null);

  let pushOkCount = 0;
  let adoptOkCount = 0;
  let ffadoptOkCount = 0;
  let noopOkCount = 0;
  let newestNoop = null;

  for (let i = arr.length - 1; i >= 0; i--) {
    const rawLine = arr[i];
    const parsed = parseGateEvidenceLine(typeof rawLine === "string" ? rawLine : "");
    if (parsed.kind === "other") continue;
    // Tip-named success evidence: push-ok, plus the two adoption-family OK
    // lines (SUBC-045 — exact-tip acceptance in BOTH strict and default
    // modes, mirroring how a tip-named push-ok counts).
    if (
      parsed.kind === "push-ok" ||
      parsed.kind === "adopt-ok" ||
      parsed.kind === "ffadopt-ok"
    ) {
      if (parsed.kind === "push-ok") pushOkCount += 1;
      else if (parsed.kind === "adopt-ok") adoptOkCount += 1;
      else ffadoptOkCount += 1;
      if (parsed.tip !== null && parsed.tip === tipNorm) {
        const runIdNote = parsed.kind === "push-ok" ? `run id=${parsed.runId ?? "?"}, ` : "";
        return {
          found: true,
          evidence: { ...parsed, line: typeof rawLine === "string" ? rawLine : "" },
          matchKind: "exact-tip",
          reason:
            `${parsed.kind} gate evidence names tip ${tipNorm} ` +
            `(${runIdNote}evidence ts=${parsed.ts ?? "unknown"})`,
        };
      }
      // SUBC-044 descendant acceptance is scoped to push-ok lines: an
      // adoption-family line naming a DIFFERENT tip proves nothing about
      // this tip (no pushed-run ancestry story), so it keeps scanning.
      if (
        parsed.kind === "push-ok" &&
        typeof isTipDescendant === "function" &&
        parsed.tip !== null &&
        parsed.tip !== tipNorm &&
        isTipDescendant(tipNorm, parsed.tip) === true
      ) {
        return {
          found: true,
          evidence: { ...parsed, line: typeof rawLine === "string" ? rawLine : "" },
          matchKind: "descendant-tip",
          reason:
            `descendant-tip push-ok evidence names pushed tip ${parsed.tip} which descends ` +
            `from audited tip ${tipNorm} (ancestry proven by the injected isTipDescendant ` +
            `predicate; run id=${parsed.runId ?? "?"}, evidence ts=${parsed.ts ?? "unknown"})`,
        };
      }
      continue;
    }
    if (parsed.kind === "noop-ok") {
      noopOkCount += 1;
      if (newestNoop === null) newestNoop = parsed; // newest-first scan: first seen is newest
      if (allowNoop && committedAtMs !== null) {
        const noopMs = toEpochMs(parsed.ts);
        if (noopMs !== null && noopMs >= committedAtMs) {
          return {
            found: true,
            evidence: { ...parsed, line: typeof rawLine === "string" ? rawLine : "" },
            matchKind: "noop-fallback",
            reason:
              `noop-ok gate evidence at ${parsed.ts} is at/after the tip commit time ` +
              `${String(optsSafe.committedAtIso)}: the gate observed currency current on this tip`,
          };
        }
      }
      continue;
    }
    // "fail" and "check" lines carry no positive evidence; keep scanning.
  }

  if (newestNoop !== null && allowNoop && committedAtMs !== null) {
    const noopMs = toEpochMs(newestNoop.ts);
    if (noopMs === null) {
      return {
        found: false,
        evidence: null,
        matchKind: null,
        reason:
          `only noop-ok evidence exists and its line lacks a parseable timestamp, ` +
          `so it cannot be shown to postdate the tip commit time ${String(optsSafe.committedAtIso)}`,
      };
    }
    if (noopMs < committedAtMs) {
      return {
        found: false,
        evidence: null,
        matchKind: null,
        reason:
          `only noop-ok evidence exists and the newest one (ts ${String(newestNoop.ts)}) ` +
          `predates the tip commit time ${String(optsSafe.committedAtIso)}: the gate has not ` +
          `observed currency at/after this landing`,
      };
    }
  }

  const strictNote = allowNoop
    ? ""
    : " (strict mode: only tip-named push-ok/adopt-ok/ffadopt-ok evidence counts)";
  const commitTimeNote =
    allowNoop && committedAtMs === null
      ? "; the noop-ok fallback cannot apply because the tip commit time is unknown"
      : "";
  return {
    found: false,
    evidence: null,
    matchKind: null,
    reason:
      `no gate success evidence for tip ${tipNorm}: scanned ${String(arr.length)} line(s) ` +
      `(${String(pushOkCount)} push-ok, ${String(adoptOkCount)} adopt-ok, ` +
      `${String(ffadoptOkCount)} ffadopt-ok, ${String(noopOkCount)} noop-ok, rest non-evidence) ` +
      `with none naming this tip${strictNote}${commitTimeNote}`,
  };
}

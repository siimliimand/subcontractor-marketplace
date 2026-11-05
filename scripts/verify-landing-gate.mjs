#!/usr/bin/env node
/**
 * verify-landing-gate — read-only proof that a landing went through the gate.
 *
 * SUBC-020 diagnosed three landings (2026-11-04: 1fb4051, dec83346, f07eb93)
 * that sat unpublished on local main for hours because the agent-side landing
 * gate was skipped and nothing could check whether it had run. This script
 * closes that gap: for a given landing tip it requires BOTH
 *
 *   (evidence leg)  a successful gate run recorded for that tip in
 *                   ~/.local/state/ci-currency/auto-push.log — either a
 *                   push-ok line naming the tip exactly ("OK main pushed and
 *                   green (tip <sha>, run id=<id>)") or a push-ok line whose
 *                   pushed tip provably descends from the audited tip
 *                   (ancestry proven via git merge-base --is-ancestor with a
 *                   git cat-file object guard; SUBC-044: a later legitimate
 *                   gate push necessarily carried the audited commit to
 *                   origin history) or, in default mode only, a noop-ok
 *                   line at/after the tip's commit time (the gate observed
 *                   currency already holding) — parsed by the unit-tested
 *                   pure logic in scripts/ci-currency-lib.mjs; and
 *   (currency leg)  a passing run of scripts/verify-ci-currency.mjs:
 *                   local main == origin/main == newest green Actions run.
 *
 * Exit 0 only when both hold. Any failure names the broken leg, the tip, and
 * the exact remediation. See agents.md "Landing checklist (SUBC-028)".
 *
 * STRICTLY READ-ONLY: this checker never pushes, never acquires the gate's
 * lock directory, never creates/removes the alert file, and never appends to
 * auto-push.log (unlike the gate itself and its --check probe, it leaves the
 * watchdog's state dir byte-identical). Every output line passes
 * redactLogLine(). Works from the primary checkout or any linked fusion
 * worktree (git refs are shared; host state lives under the fusion user's
 * home, not the worktree).
 *
 * Usage:
 *   node scripts/verify-landing-gate.mjs                # audit current local main
 *   node scripts/verify-landing-gate.mjs --strict       # exact/descendant push evidence only
 *   node scripts/verify-landing-gate.mjs <sha>          # audit a historical tip
 *   node scripts/verify-landing-gate.mjs --strict <sha> # forensics on a tip
 *
 * <sha> may be short (unique prefix) or full 40-hex; it is resolved via
 * git rev-parse and must land on a full 40-hex commit sha. Unknown argv →
 * exit 2 with this usage. Any verification failure → stderr + exit 1.
 *
 * Requirements: Node >= 18, `git` and `gh` on PATH, gh authenticated (the
 * chained currency check needs GitHub API access). No npm dependencies.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import { findLandingEvidence, parseGateEvidenceLine, redactLogLine } from "./ci-currency-lib.mjs";

const SCRIPT = "verify-landing-gate";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = join(SCRIPT_DIR, "verify-ci-currency.mjs");
const GIT_TIMEOUT_MS = 120_000;
const CURRENCY_TIMEOUT_MS = 120_000;

const STATE_DIR = join(homedir(), ".local", "state", "ci-currency");
const LOG_FILE = join(STATE_DIR, "auto-push.log");

function say(line) {
  console.log(redactLogLine(line));
}

function fail(line) {
  console.error(redactLogLine(`${SCRIPT}: FAIL: ${line}`));
  exit(1);
}

function usageExit(args) {
  console.error(
    `${SCRIPT}: refusing unknown argument(s): ${args.join(" ")}. Usage:\n` +
      `  node scripts/verify-landing-gate.mjs [--strict] [<full-or-short sha>]\n` +
      `    no sha    → audit the current local main tip\n` +
      `    <sha>     → audit that historical landing tip (resolved via git rev-parse)\n` +
      `    --strict  → demand tip-named push evidence, exact or proven-descendant\n` +
      `                (ancestry via git merge-base --is-ancestor; no noop-ok\n` +
      `                fallback); used for landing forensics\n` +
      `This checker is read-only: it never pushes, never takes the gate lock, and\n` +
      `never writes auto-push.log or the alert file. Failed audits list the pushed\n` +
      `tips found in the gate log and why each fails to prove the audited landing.`
  );
  exit(2);
}

function failMsg(err) {
  return redactLogLine((err && (err.stderr || err.stdout || err.message)) || String(err));
}

function run(cmd, args, timeoutMs = 60_000) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const detail = failMsg(err);
    throw new Error(`${cmd} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

/** Last non-empty line of a captured child output (stdout and/or stderr). */
function lastNonEmptyLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  return lines.length > 0 ? lines[lines.length - 1].trim() : "";
}

/**
 * One-shot command runner that reports the exit status instead of throwing
 * (unlike run()): the ancestry probes are EXPECTED to exit non-zero — git
 * merge-base --is-ancestor exits 1 on "not an ancestor" and git cat-file -e
 * exits non-zero on a missing object — so the caller interprets the status by
 * exact exit code instead of treating every non-zero as an error. A null
 * status means the child was killed (timeout) or never spawned.
 */
function probe(cmd, args, timeoutMs) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: typeof (err && err.status) === "number" ? err.status : null,
      stdout: String((err && err.stdout) ?? ""),
      stderr: String((err && err.stderr) ?? "") || String((err && err.message) ?? ""),
    };
  }
}

/**
 * Cached git-ancestry predicate injected into findLandingEvidence (SUBC-044).
 *
 * For a pushed tip named by a gate-log line, prove — or refuse to prove — that
 * the audited tip is an ancestor of it:
 *   1. object guard: `git cat-file -e <pushedTip>^{commit}` must exit 0; a
 *      missing object is non-evaluable and NEVER proves ancestry (remediation:
 *      `git fetch origin main`).
 *   2. `git merge-base --is-ancestor <auditedTip> <pushedTip>` is interpreted
 *      by exact exit code: 0 → proven descendant; 1 → evaluable, not an
 *      ancestor; any other status (git error, timeout kill) → non-evaluable.
 *
 * Directionality is one-way: only "audited ancestor of pushed" can ever yield
 * descends:true — a pushed tip OLDER than the audited tip is never accepted.
 * Verdicts are cached per pushed tip so failure diagnostics never re-run git
 * for a tip the scan already adjudicated.
 */
function makeAncestryPredicate(auditedTip) {
  const cache = new Map();
  const verdictFor = (pushedTip) => {
    const key = typeof pushedTip === "string" ? pushedTip.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(key)) {
      return { descends: false, evaluable: false, detail: "pushed tip is not a full 40-hex sha" };
    }
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let verdict;
    const guard = probe("git", ["cat-file", "-e", `${key}^{commit}`], GIT_TIMEOUT_MS);
    if (guard.status !== 0) {
      const detail = lastNonEmptyLine(`${guard.stderr}\n${guard.stdout}`);
      verdict = {
        descends: false,
        evaluable: false,
        detail:
          `ancestry not evaluable (pushed tip object missing locally` +
          `${detail ? `: ${detail}` : ""}; fetch and retry: "git fetch origin main")`,
      };
    } else {
      const res = probe("git", ["merge-base", "--is-ancestor", auditedTip, key], GIT_TIMEOUT_MS);
      if (res.status === 0) {
        verdict = {
          descends: true,
          evaluable: true,
          detail: "audited tip is an ancestor of this pushed tip",
        };
      } else if (res.status === 1) {
        verdict = { descends: false, evaluable: true, detail: "not an ancestor of the audited tip" };
      } else {
        const detail = lastNonEmptyLine(`${res.stderr}\n${res.stdout}`);
        verdict = {
          descends: false,
          evaluable: false,
          detail:
            `ancestry not evaluable (git merge-base --is-ancestor exited ` +
            `${res.status === null ? "without a status (timeout/kill)" : String(res.status)}` +
            `${detail ? `: ${detail}` : ""})`,
        };
      }
    }
    cache.set(key, verdict);
    return verdict;
  };
  // The lib accepts a push-ok line only when the predicate returns EXACTLY
  // true; anything else (false, undefined) rejects the line — so a
  // non-evaluable verdict can never silently enable descendant acceptance.
  const predicate = (_auditedTip, pushedTip) => verdictFor(pushedTip).descends === true;
  return { predicate, verdictFor };
}

function main() {
  const args = process.argv.slice(2);
  let strict = false;
  let tipArg = null;
  for (const arg of args) {
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (tipArg !== null) usageExit(args);
    if (!/^[0-9a-f]{7,40}$/i.test(arg)) usageExit(args);
    tipArg = arg;
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(major) || major < 18) {
    fail(`Node >= 18 required (found ${process.versions.node})`);
  }

  // Resolve the audit target: current local main by default, else the given
  // sha (short prefixes allowed — git resolves them; the result must be a
  // full 40-hex commit sha or the audit cannot proceed).
  let tip;
  try {
    tip = tipArg === null ? run("git", ["rev-parse", "main"]) : run("git", ["rev-parse", `${tipArg}^{commit}`]);
  } catch (err) {
    fail(`could not resolve ${tipArg === null ? "local main" : `tip "${tipArg}"`}: ${failMsg(err)}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(tip)) {
    fail(
      `resolved tip did not resolve to a full 40-hex sha (got: "${tip || "<empty>"}"); ` +
        `pass a landing tip sha (or no argument to audit current local main)`
    );
  }
  tip = tip.toLowerCase();

  let committedAtIso = null;
  try {
    const raw = run("git", ["log", "-1", "--format=%cI", tip], GIT_TIMEOUT_MS);
    committedAtIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw) ? raw : null;
  } catch {
    committedAtIso = null; // strict mode never needs it; the lib refuses the fallback without it
  }

  // Evidence leg: the watchdog's own success lines for this tip.
  let logText;
  try {
    logText = readFileSync(LOG_FILE, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      fail(
        `landing-gate log not found at ${LOG_FILE}: the gate ` +
          `(push-main-when-ahead) has never run on this host. Remediation: run ` +
          `"node scripts/push-main-when-ahead.mjs" for the landing and require exit 0, ` +
          `then re-run this checker`
      );
    }
    fail(`could not read landing-gate log at ${LOG_FILE}: ${failMsg(err)}`);
  }
  const logLines = logText
    .split("\n")
    .filter((l) => l.trim() !== ""); // drop the trailing-newline empty element
  // SUBC-044: inject the cached git-ancestry predicate so descendant-tip
  // push-ok evidence is adjudicated by the checker (all git I/O stays here;
  // the lib remains pure). Both modes share the predicate — strict vs default
  // differs only in the noop-ok fallback switch.
  const { predicate, verdictFor } = makeAncestryPredicate(tip);
  const evidence = findLandingEvidence(logLines, tip, {
    committedAtIso,
    allowNoopFallback: !strict,
    isTipDescendant: predicate,
  });
  if (!evidence.found) {
    // Tip-mismatch diagnostics (SUBC-044): when the log names OTHER pushed
    // tips, list each distinct one newest-first (cap 8) with its ancestry
    // verdict so the failure says exactly why no line proves this landing.
    // Verdicts reuse the same cache the scan populated — no git re-runs.
    const pushedTips = [];
    for (let i = logLines.length - 1; i >= 0 && pushedTips.length < 8; i--) {
      const parsed = parseGateEvidenceLine(logLines[i]);
      if (
        parsed.kind === "push-ok" &&
        parsed.tip !== null &&
        parsed.tip !== tip &&
        !pushedTips.includes(parsed.tip)
      ) {
        pushedTips.push(parsed.tip);
      }
    }
    let diagnostics = "";
    if (pushedTips.length > 0) {
      const detailLines = pushedTips.map((pushedTip) => {
        const verdict = verdictFor(pushedTip);
        return `  pushed tip ${pushedTip}: ${verdict.detail}`;
      });
      diagnostics =
        ` Tip-mismatch diagnostics (${String(pushedTips.length)} distinct pushed tip(s) in the ` +
        `gate log, newest first):\n${detailLines.join("\n")}`;
    }
    fail(
      `no landing-gate evidence for tip ${tip} (committed ${committedAtIso ?? "unknown"}): ` +
        `${evidence.reason}.${diagnostics} Remediation: run "node scripts/push-main-when-ahead.mjs" for ` +
        `this landing and require exit 0, then re-run this checker`
    );
  }

  // Currency leg: authoritative live check, consumed and never modified.
  let verifySummary = "";
  try {
    const out = run(process.execPath, [VERIFY_SCRIPT], CURRENCY_TIMEOUT_MS);
    verifySummary = lastNonEmptyLine(out) || "verify-ci-currency exit 0";
  } catch (err) {
    const detail = lastNonEmptyLine(`${String(err.stdout ?? "")}\n${String(err.stderr ?? "")}`) || failMsg(err);
    fail(
      `currency leg failed — the landing is not verifiably published ` +
        `(verify-ci-currency exited non-zero): ${detail}. Remediation: resolve the drift ` +
        `per agents.md ("node scripts/push-main-when-ahead.mjs"; never force-push), then ` +
        `re-run this checker`
    );
  }

  const ev = evidence.evidence;
  if (ev === null) {
    fail(`internal inconsistency: evidence reported found but no evidence object for ${tip}`);
  }
  // Match clause (SUBC-044): name HOW the evidence matched; a descendant
  // match also names the full pushed tip so the one-line receipt is
  // self-contained proof for future audits.
  const matchClause =
    evidence.matchKind === null
      ? ""
      : evidence.matchKind === "descendant-tip" && ev.tip !== null
        ? `, match descendant-tip via pushed tip ${ev.tip.slice(0, 12)} (${ev.tip})`
        : `, match ${evidence.matchKind}`;
  say(
    `${SCRIPT}: OK — landing gate verified for tip ${tip.slice(0, 12)} (${tip}): ` +
      `evidence ${ev.kind}${strict ? " (strict)" : ""}${matchClause}` +
      `${ev.runId ? `, run id=${ev.runId}` : ""}, evidence ts=${ev.ts ?? "unknown"}, ` +
      `committed ${committedAtIso ?? "unknown"}; currency: ${verifySummary}`
  );
  return 0;
}

exit(main());

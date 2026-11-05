#!/usr/bin/env node
/**
 * push-main-when-ahead — the SUBC-008 landing watchdog.
 *
 * Guarantees "local main == origin/main == newest green CI run" after every
 * landing on this repository's main branch. SUBC-007 restored the push
 * transport (HTTPS remote + gh credential helper) and shipped
 * scripts/verify-ci-currency.mjs as the currency guard, but the push itself
 * stayed manual — and the Fusion engine's merge flow lives outside this
 * repository, so it cannot push. This script closes that gap:
 *
 *   git fetch origin main
 *   → ahead/behind counts → decideAction (pure logic in ci-currency-lib.mjs)
 *   → push    : git push origin main  (single hardcoded refspec, never --force)
 *               → poll GitHub Actions for a COMPLETED run on the pushed tip
 *               → chain scripts/verify-ci-currency.mjs (authoritative check)
 *   → adopt   : SUBC-027 — diverged but PROVABLY tree-identical (empty diff
 *               between the tips) → compare-and-swap update-ref of
 *               refs/heads/main onto the origin tip with an explicit reflog
 *               message naming both tips and both trees → re-check
 *               convergence → chain scripts/verify-ci-currency.mjs
 *   → noop    : currency already holds, remove any stale alert
 *   → refuse  : behind, or diverged with differing trees → loud alert, never
 *               auto-merge/force-push
 *
 * Triggers (see agents.md, "Auto-push on landing"):
 *   - host cron tick every 10 minutes (fusion user)
 *   - the landing gate: the agent completing a merge/landing runs this script
 *     and treats a non-zero exit as a landing failure
 *   - manual / --check invocations
 *
 * Usage:
 *   node scripts/push-main-when-ahead.mjs          # push when ahead, verify
 *   node scripts/push-main-when-ahead.mjs --check  # report-only probe
 *   REPO=owner/other-repo node scripts/push-main-when-ahead.mjs
 *
 * State (under $HOME/.local/state/ci-currency/, deliberately outside the
 * tracked tree — .gitignore does not cover .fusion/):
 *   auto-push.log  append-only timestamped run log (credential-scrubbed)
 *   cron.log       crash capture written by the crontab redirect
 *   alert          exists ONLY while a failure is unresolved; removed on recovery
 *   lock/          mkdir-based lock + pid file; stale after 15 min or dead pid
 *
 * Guarantees: only the branch name `main` is ever pushed (assertMainRef +
 * hardcoded refspec); fusion/* worktree branches are NEVER pushed; no
 * --force anywhere; the SUBC-027 tree-identity adoption moves ONLY the local
 * refs/heads/main ref (compare-and-swap update-ref with an explicit reflog
 * message — never a push, merge, rebase, force, or worktree mutation) and
 * fires only when the empty-diff proof holds; every log/alert line passes
 * redactLogLine(); works from the primary checkout or any linked fusion
 * worktree (git shared refs).
 *
 * Requirements: Node >= 18, `git` and `gh` on PATH, gh authenticated.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
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
} from "./ci-currency-lib.mjs";

const SCRIPT = "push-main-when-ahead";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = join(SCRIPT_DIR, "verify-ci-currency.mjs");
const REPO_DEFAULT = "siimliimand/subcontractor-marketplace";
const POLL_INTERVAL_MS = 15_000;
const POLL_BUDGET_MS = 8 * 60 * 1000; // SUBC-007 runs finish in 22–48 s; 8 min is a generous cap
const GIT_TIMEOUT_MS = 120_000;

const STATE_DIR = join(homedir(), ".local", "state", "ci-currency");
const LOG_FILE = join(STATE_DIR, "auto-push.log");
const ALERT_FILE = join(STATE_DIR, "alert");
const LOCK_DIR = join(STATE_DIR, "lock");
const LOCK_PID_FILE = join(LOCK_DIR, "pid");

function ts() {
  return new Date().toISOString();
}

function appendLog(line) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${ts()} ${redactLogLine(line)}\n`);
  } catch {
    // state dir unwritable — stdout/stderr still carry the message
  }
}

function say(line) {
  console.log(redactLogLine(line));
  appendLog(line);
}

function writeAlert(content) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(ALERT_FILE, `${redactLogLine(content)}\n`);
  } catch {
    // state dir unwritable — the non-zero exit is still the visible failure
  }
}

function clearAlert() {
  try {
    rmSync(ALERT_FILE, { force: true });
  } catch {
    // nothing to do
  }
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

/**
 * Probe whether two tips carry the same tree — the SUBC-027 adoption
 * evidence. Uses execFileSync directly (NOT the throwing `run` wrapper)
 * because an empty diff is exit code 1 under --quiet and is expected
 * control flow, not an error: exit 0 → identical, exit 1 → different trees,
 * any other failure → throw naming the probe (outer catch → alert → exit 1).
 */
function probeTreeIdentity(localTip, originTip) {
  try {
    execFileSync("git", ["diff", "--quiet", localTip, originTip], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { identical: true };
  } catch (err) {
    if (err && err.status === 1) {
      return { identical: false };
    }
    const detail = failMsg(err);
    throw new Error(
      `tree-identity probe (git diff --quiet ${localTip} ${originTip}) failed${detail ? `: ${detail}` : ""}`
    );
  }
}

/**
 * Run the authoritative currency check (SUBC-007 artifact — consumed, never
 * modified) and return its last stdout line. Shared by the push path and the
 * SUBC-027 adoption path so both end in the identical verify chain.
 */
function runVerifyChain() {
  const verifyOut = run(process.execPath, [VERIFY_SCRIPT], 120_000);
  const verifyLines = verifyOut.split("\n");
  return verifyLines[verifyLines.length - 1] || "verify-ci-currency exit 0";
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH"; // EPERM => exists but not ours => alive
  }
}

/** Returns true when this caller holds the lock; false when a live run holds it. */
function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(LOCK_DIR); // no recursive: EEXIST when a run holds the lock
      writeFileSync(LOCK_PID_FILE, String(process.pid));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let age = LOCK_STALE_MS;
      let alive = true;
      try {
        const st = statSync(LOCK_DIR);
        age = Date.now() - st.mtimeMs;
        const pid = parseInt(readFileSync(LOCK_PID_FILE, "utf8").trim(), 10);
        alive = Number.isFinite(pid) && pid > 0 ? pidAlive(pid) : false;
      } catch {
        alive = false; // unparsable lock => fail-safe steal
      }
      if (isLockStale(age, alive)) {
        appendLog(`${SCRIPT}: stealing stale lock (age ${Math.round(age / 1000)}s, pidAlive=${alive})`);
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      return false;
    }
  }
  return false;
}

function releaseLock() {
  try {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    // nothing to do
  }
}

/** Synchronous sleep that works on the Node main thread (no timers leak). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Poll GitHub Actions until a COMPLETED run whose head_sha equals `tip`
 * appears, or the budget expires. Returns the matched run object.
 */
function pollForRunOnTip(tip, repo, deadline) {
  let lastError = "";
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    try {
      const raw = run("gh", ["api", `repos/${repo}/actions/runs?per_page=5`]);
      const runs = JSON.parse(raw).workflow_runs || [];
      const match = runs.find(
        (r) => r && r.status === "completed" && shasEqual(String(r.head_sha || ""), tip)
      );
      if (match) {
        appendLog(`${SCRIPT}: tip ${tip} found on poll #${polls}: run id=${match.id}`);
        return match;
      }
    } catch (err) {
      lastError = failMsg(err);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) sleepSync(Math.min(POLL_INTERVAL_MS, remaining));
  }
  throw new Error(
    `no completed Actions run with head_sha ${tip} on ${repo} within ` +
      `${Math.round(POLL_BUDGET_MS / 1000)}s of polling${lastError ? ` (last poll error: ${lastError})` : ""}`
  );
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === "--check";
  if (!checkOnly && args.length !== 0) {
    console.error(
      `${SCRIPT}: refusing unknown argument(s): ${args.join(" ")}. ` +
        `This mechanism pushes ONLY "main" (never fusion/* task branches, never --force). ` +
        `Run with no arguments to push-when-ahead, or --check for a report-only probe.`
    );
    exit(2);
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(major) || major < 18) {
    console.error(`${SCRIPT}: FAIL: Node >= 18 required (found ${process.versions.node})`);
    exit(1);
  }

  const repo = process.env.REPO || REPO_DEFAULT;

  if (checkOnly) {
    run("git", ["fetch", "origin", "main"], GIT_TIMEOUT_MS);
    const ahead = parseInt(run("git", ["rev-list", "--count", "origin/main..main"]), 10);
    const behind = parseInt(run("git", ["rev-list", "--count", "main..origin/main"]), 10);
    const decision = decideAction(ahead, behind);
    // SUBC-027: a diverged refusal gets the same read-only refinement a gate
    // run would apply, so the probe never lies about what a gate run would
    // do. Read-only throughout: never mutates anything, never touches the
    // alert file; a probe failure reports trees-unknown instead of crashing.
    let refinement = "";
    if (decision.action === "refuse" && ahead > 0 && behind > 0) {
      try {
        const localTip = run("git", ["rev-parse", "main"]);
        const originTip = run("git", ["rev-parse", "origin/main"]);
        if (!isFullSha(localTip) || !isFullSha(originTip)) {
          throw new Error(`unparsable tip(s): main=${localTip} origin/main=${originTip}`);
        }
        const probe = probeTreeIdentity(localTip, originTip);
        const refined = refineRefusalWithTreeIdentity(ahead, behind, probe.identical);
        refinement = ` | refinement: ${refined.reason}`;
        if (refined.action === "adopt-origin") {
          refinement +=
            ` | a main-gate run (no --check) would adopt origin/main ${originTip} via ` +
            `compare-and-swap update-ref and exit 0 if the tip's CI run is green`;
        }
      } catch (err) {
        refinement = ` | trees-unknown (read-only probe failed: ${failMsg(err)})`;
      }
    }
    say(
      `${SCRIPT} --check: ahead=${ahead} behind=${behind} → ${decision.action} (${decision.reason})${refinement}`
    );
    return decision.action === "noop" ? 0 : 1;
  }

  if (!acquireLock()) {
    say(`${SCRIPT}: another run holds the lock (recent tick or landing gate); exiting quietly`);
    return 0;
  }

  try {
    run("git", ["fetch", "origin", "main"], GIT_TIMEOUT_MS);
    const ahead = parseInt(run("git", ["rev-list", "--count", "origin/main..main"]), 10);
    const behind = parseInt(run("git", ["rev-list", "--count", "main..origin/main"]), 10);
    const decision = decideAction(ahead, behind);
    say(`${SCRIPT}: ahead=${ahead} behind=${behind} → ${decision.action} (${decision.reason})`);

    if (decision.action === "noop") {
      clearAlert();
      say(`${SCRIPT}: OK currency current (main == origin/main); nothing to push`);
      return 0;
    }

    if (decision.action === "refuse") {
      // SUBC-027: a diverged refusal may be provably harmless — diverged tips
      // whose trees are IDENTICAL (empty diff). Refine before alerting; every
      // other refusal shape keeps decideAction's original reason.
      let effectiveReason = decision.reason;
      if (ahead > 0 && behind > 0) {
        const localTip = run("git", ["rev-parse", "main"]);
        const originTip = run("git", ["rev-parse", "origin/main"]);
        if (!isFullSha(localTip)) {
          throw new Error(`unparsable local main tip: ${String(localTip)} (expected a full 40-hex sha)`);
        }
        if (!isFullSha(originTip)) {
          throw new Error(`unparsable origin/main tip: ${String(originTip)} (expected a full 40-hex sha)`);
        }
        const probe = probeTreeIdentity(localTip, originTip);
        const refined = refineRefusalWithTreeIdentity(ahead, behind, probe.identical);
        say(`${SCRIPT}: tree-identity refinement: ${refined.reason}`);
        effectiveReason = refined.reason;

        if (refined.action === "adopt-origin") {
          assertMainRef("main"); // defense-in-depth on top of the hardcoded refname below
          const [localTree, originTree] = run("git", [
            "rev-parse",
            "main^{tree}",
            "origin/main^{tree}",
          ]).split(/\s+/);
          if (!isFullSha(localTree) || !isFullSha(originTree)) {
            throw new Error(
              `unparsable tree sha(s): main^{tree}=${String(localTree)} ` +
                `origin/main^{tree}=${String(originTree)} (expected full 40-hex shas)`
            );
          }
          const reflogMessage = buildAdoptionReflogMessage({
            originTip,
            localTip,
            originTree,
            localTree,
          });
          say(
            `${SCRIPT}: adopting origin/main ${originTip} over tree-identical diverged local main ` +
              `${localTip} (compare-and-swap update-ref of refs/heads/main; reflog recorded; ` +
              `no push, no merge, no worktree change)`
          );
          // Compare-and-swap: NEW value (originTip) BEFORE OLD value (localTip).
          // Swapping the two silently reverts an already-adopted ref; the
          // wiring test pins this order so it cannot regress.
          run("git", ["update-ref", "-m", reflogMessage, "refs/heads/main", originTip, localTip]);

          const aheadNow = parseInt(run("git", ["rev-list", "--count", "origin/main..main"]), 10);
          const behindNow = parseInt(run("git", ["rev-list", "--count", "main..origin/main"]), 10);
          if (aheadNow !== 0 || behindNow !== 0) {
            throw new Error(
              `post-adoption convergence failed: ahead=${aheadNow} behind=${behindNow} (expected 0/0)`
            );
          }
          clearAlert();
          const verifyLastLine = runVerifyChain();
          say(`${SCRIPT}: verify-ci-currency: ${verifyLastLine}`);
          clearAlert();
          say(
            `${SCRIPT}: OK adopted origin/main tip ${originTip} (tree-identical diverged local main healed)`
          );
          return 0;
        }
      }
      const alert =
        `${ts()} ${SCRIPT} refused: ${effectiveReason}. ` +
        `Next manual action: run "git fetch origin main", reconcile local main with origin/main ` +
        `(merge or rebase — never force-push), then re-run "node scripts/push-main-when-ahead.mjs" and ` +
        `"node scripts/verify-ci-currency.mjs". Do not merge further work onto main until this alert clears.`;
      writeAlert(alert);
      console.error(`${SCRIPT}: FAIL: ${effectiveReason}`);
      appendLog(`${SCRIPT}: FAIL ${effectiveReason}`);
      return 1;
    }

    // decision.action === "push"
    assertMainRef("main"); // defense-in-depth on top of the hardcoded refspec below
    const localMain = run("git", ["rev-parse", "main"]);
    say(`${SCRIPT}: pushing main (${localMain}) to origin/main (single hardcoded refspec, no --force)`);
    run("git", ["push", "origin", "main"], GIT_TIMEOUT_MS);

    const remoteTip = parseLsRemoteMain(run("git", ["ls-remote", "origin", "refs/heads/main"]));
    if (!remoteTip || !shasEqual(remoteTip, localMain)) {
      throw new Error(
        `push did not land: origin/main (${remoteTip || "<unparsable>"}) != pushed tip (${localMain})`
      );
    }
    say(`${SCRIPT}: pushed; origin/main tip is now ${remoteTip}; polling for the Actions run on it`);

    const matched = pollForRunOnTip(remoteTip, repo, Date.now() + POLL_BUDGET_MS);
    say(
      `${SCRIPT}: Actions run on tip: id=${matched.id} run_number=${matched.run_number} ` +
        `event=${matched.event} conclusion=${matched.conclusion} url=${matched.html_url}`
    );

    // Authoritative currency check (SUBC-007 artifact — consumed, never
    // modified); shared with the SUBC-027 adoption path via runVerifyChain().
    const lastLine = runVerifyChain();
    say(`${SCRIPT}: verify-ci-currency: ${lastLine}`);

    clearAlert();
    say(`${SCRIPT}: OK main pushed and green (tip ${remoteTip}, run id=${matched.id})`);
    return 0;
  } catch (err) {
    const msg = failMsg(err);
    const alert =
      `${ts()} ${SCRIPT} failed: ${msg}. ` +
      `Next manual action: run "git fetch origin main" and compare "git rev-list --count origin/main..main main..origin/main"; ` +
      `reconcile locally if behind/diverged (never force-push), then re-run "node scripts/push-main-when-ahead.mjs" and ` +
      `"node scripts/verify-ci-currency.mjs". Do not merge further work onto main until this alert clears.`;
    writeAlert(alert);
    console.error(`${SCRIPT}: FAIL: ${msg}`);
    appendLog(`${SCRIPT}: FAIL ${msg}`);
    return 1;
  } finally {
    releaseLock();
  }
}

const code = main();
exit(code);

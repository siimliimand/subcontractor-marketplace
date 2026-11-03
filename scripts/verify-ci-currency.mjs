#!/usr/bin/env node
/**
 * CI currency guard — asserts the "landing reaches origin and goes green" invariant.
 *
 * One command that verifies, against live GitHub state, that:
 *   (a) local `main` == `origin/main` (pushed, no drift)
 *   (b) the newest completed GitHub Actions run's head_sha == the origin/main tip
 *       (the tip landed and CI ran ON it)
 *   (c) that run concluded `success`
 *
 * Introduced by SUBC-007 after six landings (2026-10-18 → 2026-11-03) silently
 * never reached GitHub (broken SSH transport), so Actions produced zero runs
 * while local work looked "landed". Run this after every merge/push of `main`
 * until push automation exists (see agents.md, "GitHub push transport").
 *
 * Usage:
 *   node scripts/verify-ci-currency.mjs
 *   REPO=owner/other-repo node scripts/verify-ci-currency.mjs
 *
 * Requirements: Node >= 18, `git` and `gh` on PATH, gh authenticated with
 * repo read access. No npm dependencies. Prints the asserted run's id, event,
 * head branch, sha and URL so any failure is diagnosable in seconds.
 *
 * Note: the invariant assumes the newest completed run on the repo is a push
 * run on `main` (true for this solo-founder repo). The asserted run's event
 * and head branch are always printed, so a stray pull_request/dispatch run
 * shadowing the tip is immediately visible in the failure message.
 */

import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT = "verify-ci-currency";

function fail(msg) {
  console.error(`${SCRIPT}: FAIL: ${msg}`);
  exit(1);
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const detail = (err.stderr || err.message || "").toString().trim();
    fail(`${cmd} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

function shaOf(label, value) {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    fail(`${label} did not resolve to a full sha (got: "${value || "<empty>"}")`);
  }
  return value.toLowerCase();
}

const major = Number(process.versions.node.split(".")[0]);
if (Number.isNaN(major) || major < 18) {
  fail(`Node >= 18 required (found ${process.versions.node})`);
}

const repo = process.env.REPO || "siimliimand/subcontractor-marketplace";

// (a) local main == origin/main tip, via the remote — resolved by branch name,
// never HEAD, so the check holds from any worktree checkout.
const localMain = shaOf("git rev-parse main", run("git", ["rev-parse", "main"]));
const lsRemoteOut = run("git", ["ls-remote", "origin", "refs/heads/main"]);
const originLine = lsRemoteOut
  .split("\n")
  .find((line) => line.endsWith("\trefs/heads/main") || line.endsWith(" refs/heads/main"));
if (!originLine) {
  fail(`origin has no refs/heads/main (ls-remote output: "${lsRemoteOut || "<empty>"}")`);
}
const originMain = shaOf("git ls-remote origin refs/heads/main", originLine.split(/\s+/)[0]);

if (localMain !== originMain) {
  fail(
    `local main (${localMain}) != origin/main (${originMain}) — ` +
      `local main is NOT fully pushed. Run: git push origin main`
  );
}

// (b)+(c) newest completed Actions run on the repo must be exactly the tip, and green.
const runsRaw = run("gh", [
  "api",
  `repos/${repo}/actions/runs?per_page=100`,
]);
let runs;
try {
  runs = JSON.parse(runsRaw).workflow_runs || [];
} catch {
  fail(`could not parse gh api runs response for ${repo}`);
}
const completed = runs
  .filter((r) => r.status === "completed")
  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
if (completed.length === 0) {
  fail(`${repo} has no completed Actions runs — CI has never run (or gh lacks access)`);
}
const newest = completed[0];
const runLabel =
  `run #${newest.run_number} id=${newest.id} event=${newest.event} ` +
  `branch=${newest.head_branch ?? "?"} head_sha=${newest.head_sha} ` +
  `created=${newest.created_at} url=${newest.html_url}`;

if (newest.head_sha.toLowerCase() !== originMain) {
  fail(
    `newest completed run head_sha (${newest.head_sha}) != origin/main tip (${originMain}) — ` +
      `CI did not run on the current tip. [${runLabel}]`
  );
}

if (newest.conclusion !== "success") {
  fail(
    `newest completed run on the tip concluded "${newest.conclusion}", not "success". [${runLabel}]`
  );
}

console.log(
  `${SCRIPT}: OK — local main == origin/main (${originMain.slice(0, 12)}); ` +
    `newest completed run is the tip and concluded success. [${runLabel}]`
);
exit(0);

# Agent Notes

## Cloudflare credentials (siim, 2026-10-20)

- A Cloudflare **User API Token lives at `/root/.cloudflare-token`** (mode 600, one line).
- `/root/.bashrc` exports it automatically for interactive shells as
  `CLOUDFLARE_API_TOKEN`. Non-interactive shells (CI-style tool runs, agent
  sandboxes) must load it explicitly:

  ```bash
  export CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)"
  ```

- Verified working with `npx wrangler whoami` (account of siim.liimand@gmail.com;
  D1 databases `cockpit-local`/`cockpit-staging`/`cockpit-production` are reachable
  with it).
- Never echo or commit the token value; reference the file path instead.
  This repo deploys with `npm run deploy:staging` / `deploy:production` and
  migrates with `npm run db:migrate:staging` / `db:migrate:production`.

## Register badge imports (phase 3, 2026-10-20)

- `scripts/import-ariregister.mjs` and `scripts/import-mtr.mjs` are the ONLY
  path register data may take into D1 — no runtime register API calls anywhere.
- Workflow: download the open-data file (Äriregister CSV from
  avaandmed.ariregister.rik.ee; MTR XML from mtr.ttja.ee/opendata), run the
  script to emit SQL, apply with `wrangler d1 execute … --file`.
- **Dry-run first (SUBC-015):** always emit the SQL to a scratch file and read
  the `-- summary:` line BEFORE applying — a healthy MTR import reads
  `≈8,095 trade-notification rows upserted across ≈5,097 undertakers` (all six
  trades; SUBC-015 measured baseline from the 2026-11-04 export — anything
  near zero means drift, investigate, never force-expire). Only apply after
  the counts make sense; never pipe the import straight into `d1 execute`.
- **Read-only `--dry-run` diagnostics (SUBC-029):** before generating the real
  SQL, run `node scripts/import-mtr.mjs <file.xml> --dry-run > dry-run.sql`
  and apply that bundle to capture BEFORE counts — it contains ONLY read-only SELECTs — the three SUBC-029 diagnostics
  (current `mtr:%` trade-notification rows by status, the exact rows the
  expire legs would flip, and how many matched undertakers exist in
  `companies`) plus one `would_expire_dropped` projection per expire chunk
  (SUBC-041) — so applying it writes nothing by construction. A guarded
  dry-run (drifted file) still prints the diagnostics, then exits 1.
  `--force-expire` is ignored under `--dry-run` (explicit warning, zero
  writes — dry-run wins unconditionally). Then review the real SQL against
  the projection. See the SUBC-029 reimport-runbook task document for the
  full operator flow and expected count bands.
- **Scratch files for operator downloads (SUBC-029):** keep register downloads
  and emitted SQL inside a `.local`-suffixed directory such as
  `mtr-scratch.local/` — the repo `.gitignore` `*.local` pattern matches the
  DIRECTORY name, so every file inside it is ignored with no per-file naming
  rule (a bare `ettevotjad.local.xml` file would NOT be ignored). The MTR
  export download itself is browser-only: agent fetches are 403-blocked by
  bot protection (verified 2026-11-05).
- **MTR zero-upsert guard (SUBC-015):** if the export format drifts and the
  import finds ZERO upserts, the script emits NO expire-all UPDATE, prints a
  GUARD diagnostic to stderr naming the drift signal, and exits 1 — a drifted
  file can never flip every `mtr:%` trade_notification row to `invalid` in one
  pass. `--force-expire` overrides explicitly (exit 0 + WARNING); treat that
  flag as an operator decision, never a workaround for unexplained counts.
- **MTR per-trade expire (SUBC-041):** the import also expires stale valid
  rows of companies STILL listed in the import for trades the current import
  no longer carries (closes the SUBC-015 deferral). Emission is chunked —
  byte-budgeted at 90,000 bytes against D1's 100,000-byte statement cap,
  whole registry codes atomic per chunk — so the dry-run's per-chunk
  `would_expire_dropped` projections sum exactly to the flips the apply
  makes. Guard, force-expire, idempotency, and dry-run read-only behavior
  are unchanged; validate the closure from the dry-run projections before
  applying.

- **MTR/Tarvik badge display stays behind `MTR_BADGES_ENABLED` (default off)
  until the founder's TTJA licence confirmation (CC BY-SA 3.0 share-alike) is
  recorded** — docs/phase0/register-findings.md follow-up #1. Importing is
  safe; displaying is not, yet.

## Phase 4 expansion notes (2026-10-20)

- **Migrations must be registered in `test/apply-migrations.ts`** — every new
  `migrations/*.sql` is applied manually by that file in the test pool; a
  missing entry fails every test with "no such table". Phase 4 added `0007`.
- **Calendar (ICS) feeds**: secret Google/Outlook ICS URLs live in
  `calendar_feeds`; the hourly cron fetches due feeds (`calendar.ts`),
  replaces that feed's `calendar_busy_intervals` on success, backs off
  exponentially on failure, and booking/widening reject ranges overlapping
  intervals (`calendar_conflict`). Feed URLs are secrets: masked via
  `maskFeedUrl`, never logged, never returned raw.
- **Trade/region catalog**: `trades`/`regions` tables are the vocabulary
  (seeded with the pilot six). Adding a trade is a data change
  (`POST /api/catalog/trades`); code constants (`PILOT_TRADES`) are only the
  seed + empty-catalog fallback. Active trades gate NEW records; known-but-
  deactivated trades keep in-flight requests matchable/bookable.
- **Reliability**: metrics computed on read (`src/worker/reliability.ts`);
  minimum samples 5/5/3/3 from details/05 — below them factors are
  neutral (missing), never zero-penalties. Established badge = 3
  `completion_confirmed` bookings.
- **Monetization**: `MONETIZATION_PILOT_ENABLED` gates booking-flow POSTs on
  the request's partner having an active `pilot_agreement`; flag off = zero
  behaviour change. Agreements are hand-billed records — no payment processor.
- **Provider accounts**: `/u/*` portal routes are PUBLIC (token accept/login +
  session cookie) and need an **Access bypass for `/u/*`** in the
  sim-home Access application (same as `/e/`, `/t/`) — owner action.
  `PROVIDER_SESSION_SECRET` secret is set on staging + production.
- **Planner AI** stays behind `PLANNER_AI_ENABLED=false` until real project
  data exists (plan §Phase 4.5); generation requires approved requests and
  completed-booking grounding, else it refuses with `insufficient_grounding`.
- New audit actions live in `src/worker/events.ts` (calendar, reviews,
  provider users, pilot, planner, audit_exported, catalog).

## GitHub push transport (SUBC-007, 2026-11-03)

- **SSH to github.com is broken on the fusion host** (`Host key verification
  failed`); it silently killed all pushes after 2026-10-18 — six landings
  (through c149faa) never reached GitHub and Actions produced zero runs.
  Do NOT "fix" this by accepting unknown host keys or disabling host-key
  checking.
- **`origin` is now HTTPS** (`https://github.com/siimliimand/subcontractor-marketplace.git`)
  with the gh credential helper. Two-command re-apply after a host rebuild:

  ```bash
  gh auth setup-git
  git remote set-url origin https://github.com/siimliimand/subcontractor-marketplace.git
  ```

  Verify with `git ls-remote origin refs/heads/main` (no prompt, prints the sha).
- **Post-merge push of `main` + currency check is REQUIRED after every landing**
  until push automation exists:

  ```bash
  git push origin main
  node scripts/verify-ci-currency.mjs
  ```

  The guard asserts local main == origin/main == newest completed Actions run
  head_sha and that the run concluded success; any FAIL line names the broken
  link. `ci.yml` also takes `workflow_dispatch` for manual backfills
  (`gh workflow run ci.yml --ref main`). Never force-push, and never push a
  `fusion/*` task branch to `main`. (Superseded by the auto-push subsection
  below — automation exists, and the single-writer rule there forbids any
  agent- or spec-authored direct push of the mainline ref.)
- The gh OAuth token lives in the gh config (`gh auth status` to verify, values
  redacted) and the credential helper is written to the home git config —
  **never echo or commit token values**; same rule as the Cloudflare token
  above. No credential material belongs in the repo working tree.

### Auto-push on landing (SUBC-008, 2026-11-03)

This subsection supersedes the manual two-command procedure above. The push
transport itself (HTTPS remote + gh credential helper) is unchanged — only the
trigger is now automated.

- **Mechanism: a scheduled currency check that pushes when ahead** (option b of
  the SUBC-008 acceptance; the full choice rationale and rejected alternatives
  are recorded in `docs/decision-log.md`, "Auto-push mechanism decision —
  3 November 2026 (SUBC-008)"). `scripts/push-main-when-ahead.mjs` fetches
  `origin main`, computes ahead/behind, and acts: **current → no-op**;
  **ahead → `git push origin main` → poll Actions for a COMPLETED run on the
  pushed tip → chain `scripts/verify-ci-currency.mjs`**; **diverged but
  tree-identical (empty-diff proof) → adopt the origin tip locally via
  compare-and-swap `update-ref` with an explicit reflog message, then verify
  (SUBC-027)**; **every other behind/diverged state → refuse loudly, never
  auto-merge, never force**. Pure decision logic — including the SUBC-027
  tree-identity adoption refinement — lives in
  `scripts/ci-currency-lib.mjs` (unit-tested in
  `test/ci-currency-guard.test.ts`).
- **Why not a merger-path hook or a git hook:** the Fusion engine's merge flow
  lives outside this repository (engine-side, verified 2026-11-03 — see the
  decision-log entry), and a `post-merge` git hook is invisible, unverifiable
  host state on every checkout. A repo-shipped script with three triggers
  (cron tick, landing gate, manual) is inspectable and testable.
- **Landing gate (ACTIVE NOW):** a landing on `main` is **NOT complete until
  `node scripts/push-main-when-ahead.mjs` exits 0** (pushed + green run on the
  tip). A non-zero exit is a **landing failure** — treat it exactly like a
  failed check: do not start the next merge, surface it in the task log.
  `--check` is the read-only probe (`ahead/behind` report; exit 1 on drift,
  never pushes, never touches the alert file). Before running the gate,
  re-derive `main` vs `origin/main` sequentially: a concurrent publish —
  another session's flush or an operator manual run — can dissolve an
  ahead-only premise mid-session, and the gate's noop path is success, not
  failure (the SUBC-030 race lesson). A tip-named push-ok line for a tip your
  session did not push is attribution homework, NOT cron revival — `cron.log`
  presence is the tick authority (SUBC-040). SUBC-028 (2026-11-05) made this
  rule checkable and expanded it into the mandatory numbered sequence in the
  "Landing checklist (SUBC-028)" below, verified by the read-only
  `scripts/verify-landing-gate.mjs` checker.
- **Landing checklist (SUBC-028, 2026-11-05 — ACTIVE NOW; expands the gate
  rule above into a checkable sequence):** every landing on `main` ends with
  this numbered mandatory sequence, in order:
  1. Confirm the landing reached local `main` (the landed tip resolves via
     `git rev-parse main`; worktree sessions share refs with the primary
     checkout).
  2. Run `node scripts/push-main-when-ahead.mjs` and require exit 0. A
     non-zero exit is a landing failure — handle it exactly per the Drift
     response bullet below (never force-push, never merge further work onto
     `main` until currency is restored).
  3. Run `node scripts/verify-landing-gate.mjs` and require exit 0. The
     checker is read-only (never pushes, never takes the gate lock, never
     writes `auto-push.log` or the alert file) and proves BOTH legs: the gate
     recorded a successful run for the tip in
     `~/.local/state/ci-currency/auto-push.log`, and currency holds (the
     chained `scripts/verify-ci-currency.mjs` exits 0).
  4. Record in the task log: the gate exit code, the pushed tip sha, the
     Actions run id/URL, and the checker OK line.

  Enforcement: a landing whose task log lacks a passing checker run is NOT
  complete. Any task or audit can re-verify any past landing with
  `node scripts/verify-landing-gate.mjs <full-tip-sha>`; `--strict` demands
  push evidence naming the tip OR a proven descendant of it (ancestry proven
  via git merge-base --is-ancestor; SUBC-044), used for forensics on tips
  pushed outside the gate or passed by a later legitimate landing.
- **Mid-flush retry (SUBC-058, 2026-11-05):** the gate absorbs concurrent
  landings natively — when a second landing joins local `main` while the
  gate is already polling CI for an earlier pushed tip (observed live on
  SUBC-052: the earlier push was already green but the invocation exited 1
  with a transient alert and needed a second gate run), the gate now
  re-fetches, re-counts ahead/behind, and loops the push path while the
  state stays strictly ahead-only, bounded at `MAX_PUSH_ATTEMPTS = 3` pushes
  per invocation with the lock marker refreshed per attempt. The OK evidence
  line is still emitted only after the verify chain passes; intermediate
  tips of a multi-push invocation are auditable via descendant-tip evidence
  (`--strict`, SUBC-044). Bound exhaustion or any behind/diverged re-check
  still alerts (alert file + FAIL log line + exit 1) exactly as before; the
  pure retry decision lives in `shouldLoopPushPath` in
  `scripts/ci-currency-lib.mjs` (unit-tested in
  `test/ci-currency-guard.test.ts`).
- **Scheduled trigger (10-min tick) — one-time operator install.** The fusion
  user's crontab spool is not writable by agent identities on this host
  (verified 2026-11-03: `crontab -l` → `Permission denied`; no sudo; crond
  itself is active), so the line is installed once by the operator and then
  survives reboots. Re-apply after any host rebuild, together with SUBC-007's
  two transport commands:

  ```bash
  gh auth setup-git
  git remote set-url origin https://github.com/siimliimand/subcontractor-marketplace.git
  mkdir -p ~/.local/state/ci-currency
  ( crontab -l 2>/dev/null; echo '*/10 * * * * cd /var/www/code.webuilder.dev/subcontractor-marketplace && /usr/local/bin/node scripts/push-main-when-ahead.mjs >> /home/fusion/.local/state/ci-currency/cron.log 2>&1' ) | crontab -
  ```

  `/usr/local/bin/node` is deliberate: cron's default PATH lacks
  `/usr/local/bin`, and `/usr/bin/node` does not exist on this host.

  **Re-issue status (2026-11-06, SUBC-040): still NOT installed — and the 2026-11-04T19:57:50Z
  external publish of `4fb75f0` (run #28, id 41902001270) was an operator manual gate run, NOT a
  cron firing — attributed by elimination in the decision log (SUBC-040 entry).** `cron.log`
  remains absent from the state dir (re-verified 2026-11-06 and again 2026-11-11); the cron has
  never fired since install and `cron.log` is the tick authority. Misdiagnosis guards: a
  tip-named push-ok line — including one your session never wrote — is NOT proof of cron revival;
  re-derive refs sequentially immediately before any flush (a publish may have raced your
  landing); manual flush stays the mandated trigger until ticks appear, then stops. The canonical
  operator card now lives at `docs/operator-ci-currency-cron.md` — the operator's single entry
  point (prerequisites, the install block above, rollback, and host-rebuild re-apply), with its
  post-install acceptance sequence unchanged. Until installed, every landing needs a manual flush
  per the Landing checklist above (SUBC-020 action item 1 stands: cron repair is operator-owned).

- **Drift response:** if `~/.local/state/ci-currency/alert` exists, or
  `node scripts/verify-ci-currency.mjs` exits non-zero, **create an urgent
  task and merge NO further work onto `main` until currency is restored**
  (local main == origin/main == newest green run). The alert file carries the
  timestamp, reason, and the exact next manual action. Runtime state
  (`auto-push.log`, `cron.log`, `alert`, `lock/`) lives under the fusion
  user's `~/.local/state/ci-currency` — never inside the tracked tree.
- **Credential scope status (live 2026-11-04, verified by SUBC-020):** the gh
  OAuth token has scopes `admin:public_key, gist, read:org, repo, workflow` —
  the `workflow` scope was granted 2026-11-04 (the founder's one-time
  `gh auth refresh -s workflow`; see "Workflow-scope push constraint" in the
  SUBC-013 section below). The pre-grant caveat (2026-11-03: no `workflow`
  scope; SUBC-007's `ci.yml` push was remote-rejected) is history — workflow-
  file landings push fine now. Remediation if a workflow-file landing is ever
  remote-rejected again: re-run `gh auth refresh -h github.com -s workflow`
  as the siimliimand identity (browser/device step), then re-run
  `node scripts/push-main-when-ahead.mjs`.
- **Guarantees:** only `refs/heads/main` is ever pushed (hardcoded single
  refspec + `assertMainRef`; unknown argv refused); `fusion/*` task branches
  are NEVER pushed; never `--force`; every log/alert line is scrubbed of
  `ghp_`/`gho_`/`github_pat_`/`x-access-token:` material before it is written;
  no credential material in commits. The SUBC-027 tree-identity adoption
  moves only the local `refs/heads/main` ref (never a push, merge, rebase, or
  worktree mutation), fires only when `git diff` proves the tips' trees
  identical, and records both tips and trees in the reflog message. The
  script works from the primary checkout or any linked fusion worktree (git
  shared refs).
- **Single-writer landing contract (added by SUBC-025, 2026-11-05; see
  "Non-watchdog push of 61f81e8 attributed — 2026-11-04 (SUBC-025)" in
  `docs/decision-log.md` for the incident that motivated it):**
  1. **Single writer:** `scripts/push-main-when-ahead.mjs`
     is the only component that ever pushes the mainline ref, via exactly
     three triggers (cron tick, landing-gate run, operator manual run) —
     and it always pushes local `main`, never a task tip chain.
  2. **Prohibition:** agents and task specs must never instruct or perform
     a direct push of a task tip to the mainline ref (`git push origin
     HEAD:refs/heads/main`, `git push origin main` from a task worktree, or
     any equivalent) — including as a currency-restore or stall-flush
     maneuver. Recorded reason: the 2026-11-04 SUBC-018 landing did exactly
     this (its spec's Step 4 told the executor to) and produced the
     SHA-diverged mainline wedge that SUBC-022/SUBC-023 hand-repaired and
     SUBC-024 root-caused.
  3. **Pending-landing semantics:** when the gate exits 0 as a no-op
     because the engine has not yet squash-landed the task, the landing is
     pending, not failed — record the pending state in the task log per the
     drift response; the publish flush is the next gate/cron tick after
     the engine lands (cron repair remains operator-owned per the SUBC-020
     action items).
  4. **Probe-shadow caveat:** after probe cleanup, stale failing probe
     runs can keep the currency guard red until the landing publishes a
     newer green main run — the resolution is the pending-landing flow
     above, never a direct tip push.

## CI merge gate and failure alerts (SUBC-013, 2026-11-04)

Extends the SUBC-007 transport notes and the SUBC-008 auto-push subsection
above; see also the decision-log entries “CI gate decision — 3 November
2026 (SUBC-007)” and “CI merge gate, lint baseline, and failure alerts —
2026-11-04 (SUBC-013, supersedes SUBC-007)”.

- **Lint is part of every landing.** The repo has an ESLint 9 flat config
  (`eslint.config.mjs`) and a `lint` script; CI runs `npm run lint` before
  build/typecheck/test in the single `test` job (job id unchanged — the
  ruleset and the retired-sharding decision both bind to it). Run
  `npm run lint` locally before landing; zero errors is the bar (warnings
  from `react-hooks/exhaustive-deps` do not fail). Per-file
  `eslint-disable` comments are forbidden — relax a rule only in
  `eslint.config.mjs` with a justification comment AND a decision-log record.
  On the fusion host, run npm installs with `NODE_ENV=development` (the agent
  shell exports `NODE_ENV=production`, which makes npm silently omit
  devDependencies).
- **CI fires on every push (any branch) and every PR.** `workflow_dispatch`
  remains the manual backfill (`gh workflow run ci.yml --ref main`). Runs are
  per-ref concurrent (a newer push to the same ref cancels the stale run);
  cancelled runs never alert.
- **Merge gate: currently DISABLED — parked since 2026-11-04 pending
  PR-based landing support in Fusion (engine fix plan FIX-6). While
  disabled, nothing is enforced: neither PR merges nor direct pushes into
  `main` are gated.** Intended design (dormant until re-activation):
  ruleset `ci-merge-gate-pilot` (id 26516182) requires the `test` check
  (non-strict) plus `non_fast_forward` and `deletion`, for
  `refs/heads/main` only — while enforcement is `active`, PR merges into
  `main` are gated on a green `test`. Live 2026-11-04 finding: active
  required-status rulesets also gate DIRECT pushes ("push declined due to
  repository rule violations", independent of `strict=false`), which broke
  the landing flow (engine merge + `push-main-when-ahead`) — direct pushes
  to `main` are NOT blocked today only because enforcement is `disabled`
  (SUBC-013 addendum; ruleset kept, not deleted). Re-activation procedure
  when FIX-6 ships: PUT the GET snapshot with only `enforcement` changed
  to `active`, re-run the probe procedure below plus a green-merge
  control, and auto-revert to `disabled` on any landing breakage. Do not
  add a `pull_request` rule or strict required checks while the
  direct-push landing model is in use. Re-evaluate at pilot end.
- **A `ci-failure` issue means CI failed somewhere.** The `notify` job
  (`if: failure()`, `GITHUB_TOKEN` only, no secrets) creates it on the first
  failure and comments on it for subsequent failures (one open issue at a
  time). The alert names the PR's head branch for `pull_request` runs
  (`github.event.pull_request.head.ref`, env-mapped only — SUBC-018),
  falling back to `ref_name` on push/workflow_dispatch; the merge ref
  (`N/merge`) is never shown. Triage the linked run, fix, and **close the
  issue with a comment — never delete it** (it is the alert history). The
  `ci-failure` label is managed by the workflow; no setup needed.
- **Founder notification layers:** GitHub's default failure email to the push
  actor (the siimliimand token drives all pushes) plus the repo watch
  subscription — **confirmed active 2026-11-04** (`PUT /subscription`
  succeeded; the earlier 404 was the pre-refresh token). If notifications
  ever lapse: click “Watch” on the repo, or
  `gh auth refresh -h github.com -s notifications` then re-run the PUT with
  typed `-F` flags (`-f` string-fields 422 spuriously).
- **Workflow-scope push constraint (still true):** pushes whose range touches
  `.github/workflows/*` need the gh token's `workflow` scope. It was granted
  2026-11-04 (the founder ran the one-time `gh auth refresh -s workflow`);
  if a workflow-file landing is ever remote-rejected again, re-run that
  refresh as the siimliimand identity — there is no API workaround (the
  low-level git-data route was considered and rejected at SUBC-008).
- **Probe re-verification procedure** (distilled from the 2026-11-04 live
  probes; rerun whenever the gate's wiring is questioned):
  1. `git push origin HEAD:refs/heads/ci-gate-probe/<yyyymmdd>` from a
     clean tip — expect a green `push` run whose `test` job shows
     `Run npm run lint` (use a temp worktree or plumbing for extra probe
     commits; task worktrees refuse commits to non-task branches).
  2. Add a deliberately failing test on the probe branch only, push —
     expect a failing `push` run, a `notify` job success, and an open
     `ci-failure` issue.
  3. `gh pr create --draft --base main --head ci-gate-probe/<yyyymmdd>` —
     expect a failing `pull_request` run that COMMENTS on the same issue
     (dedupe) and `gh pr view <n> --json mergeStateStatus` reporting
     `BLOCKED` while the check fails; a merge attempt is refused.
  4. Cleanup is mandatory: close the PR and the issue with probe-marker
     comments, `git push origin --delete ci-gate-probe/<yyyymmdd>`, remove
     the probe test file everywhere. Never delete runs or issue history.
     Failing probe runs shadow the main tip in
     `scripts/verify-ci-currency.mjs` until the next main landing's green
     run becomes the newest completed run — that is expected and self-heals.
- **SUBC-008 interplay:** the watchdog and the merge gate are complementary —
  the watchdog guarantees landings reach origin and go green (pushes are
  direct, hence unaffected by the ruleset *only while enforcement is
  disabled* — the 2026-11-04 finding is that an active required-status
  ruleset declines direct pushes too, which is exactly why the gate is
  parked); the ruleset's guarantee that PR merges cannot bypass a red
  check likewise holds only while enforcement is active. If the watchdog
  has pushed main, a redundant push is a harmless no-op; never force-push
  to win a race, and never let local main fall behind origin (that trips
  the drift alert and blocks all landings).

## Local task-branch hygiene (SUBC-026, promoted 2026-11-06)

The durable policy from the decision-log entry
"Local worktree and branch audit — 2026-11-04 (SUBC-026)" is binding for
every agent, not only that audit. That entry remains the authoritative
record (full classification table, retirement recipes, evidence); this
section carries the binding clauses:

1. **Closed-task branches: retire only after proof, always rescue-pinned.**
   Delete a local `fusion/*` branch ONLY when BOTH the task store and the
   `task.json` artifact confirm the owning task is closed/archived, and
   ALWAYS after pinning a rescue tag (`rescue/<branch>` at the tip; rescue
   tags are never pushed to origin). Run `git branch -d` first and record
   its refusal when the tip is not an ancestor of main; `git branch -D` is
   safe only after that zero-loss proof.
2. **Open-task branches: never touched.** This includes paused-open tasks
   awaiting operator decisions (precedent: `fusion/subc-009` stayed
   untouched through its paused-open limbo and was retired only after the
   2026-11-03 duplicate decision was acted on — rescue pin
   `rescue/fusion-subc-009` at `5a47d3e`, then deletion — by the now-done
   SUBC-038). The engine resets open-task branches onto current main at
   pickup (proven live by the fusion/subc-026 reflog).
3. **Out of scope:** `mission/*` refs and remote refs are outside
   task-branch hygiene; origin never gains `fusion/*` refs (the landing
   gate's `assertMainRef` and the single-writer contract above enforce
   this). Cross-worktree mutations from a task sandbox are boundary-blocked
   by design — another task's checked-out branch/worktree is retired only
   via an operator handoff with exact commands (SUBC-026 action items).
4. **Status:** engine-side auto-retirement (with automatic rescue pin) has
   landed (SUBC-037, done) and now automates clause 1's mechanics on every
   archive/delete path; manual retirement under this policy remains the
   contract for cases outside the engine's automated paths (branches held
   by live worktrees, operator-provenance branches, cross-worktree
   handoffs).


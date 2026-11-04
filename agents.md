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
  `≈5,097 trade-notification rows upserted across ≈5,097 undertakers` (all six
  trades). Only apply after the counts make sense; never pipe the import
  straight into `d1 execute`.
- **MTR zero-upsert guard (SUBC-015):** if the export format drifts and the
  import finds ZERO upserts, the script emits NO expire-all UPDATE, prints a
  GUARD diagnostic to stderr naming the drift signal, and exits 1 — a drifted
  file can never flip every `mtr:%` trade_notification row to `invalid` in one
  pass. `--force-expire` overrides explicitly (exit 0 + WARNING); treat that
  flag as an operator decision, never a workaround for unexplained counts.
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
  `origin main`, computes ahead/behind, and acts: **ahead → `git push origin
  main` → poll Actions for a COMPLETED run on the pushed tip → chain
  `scripts/verify-ci-currency.mjs`**; **current → no-op**; **behind/diverged →
  refuse loudly, never auto-merge, never force**. Pure decision logic lives in
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
  never pushes, never touches the alert file).
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
  no credential material in commits. The script works from the primary
  checkout or any linked fusion worktree (git shared refs).
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

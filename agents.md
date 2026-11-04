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
  `fusion/*` task branch to `main`.
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
- **Credential scope caveat (live 2026-11-03):** the gh OAuth token has scopes
  `admin:public_key, gist, read:org, repo` — **no `workflow` scope**. GitHub
  refuses such tokens to push any range touching `.github/workflows/*`
  (observed: push of main containing SUBC-007's `ci.yml` edit was remote-
  rejected). Ordinary landings push fine. One-time fix when a workflow-file
  landing is stuck: run `gh auth refresh -h github.com -s workflow` as the
  siimliimand identity (browser/device step), then re-run
  `node scripts/push-main-when-ahead.mjs`.
- **Guarantees:** only `refs/heads/main` is ever pushed (hardcoded single
  refspec + `assertMainRef`; unknown argv refused); `fusion/*` task branches
  are NEVER pushed; never `--force`; every log/alert line is scrubbed of
  `ghp_`/`gho_`/`github_pat_`/`x-access-token:` material before it is written;
  no credential material in commits. The script works from the primary
  checkout or any linked fusion worktree (git shared refs).

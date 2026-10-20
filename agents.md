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

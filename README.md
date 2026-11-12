# Subcontractor Marketplace

Internal concierge cockpit and future marketplace codebase for the Estonian construction
subcontractor pilot (interior fit-out in Tallinn / Harju county). The cockpit (this
repo's first app) is the staff tool for running the pilot: provider administration,
request lifecycle, outreach and the full email pipeline, matching, bookings and holds,
manual-effort tracking, reliability scores, monetization records and funnel dashboards.
Runs entirely on Cloudflare (Workers + D1 + Access + Email Service + Queues + Workers
AI + Static Assets).

## Stack

- **API:** Hono (TypeScript) on Cloudflare Workers
- **Frontend:** React + Vite + Tailwind, served via Workers Static Assets (SPA)
- **Database:** Cloudflare D1 (SQLite) with Drizzle ORM and versioned SQL migrations
- **Auth:** Cloudflare Access — the Worker validates the `Cf-Access-Jwt-Assertion` JWT
  (signature via the team JWKS, issuer + audience), auto-provisions allowlisted staff and
  denies everyone else with 403. Provider-side accounts use a separate public portal
  (`/u/*`) with session cookies (`PROVIDER_SESSION_SECRET`).
- **Email:** Cloudflare Email Service (`SEND_EMAIL` binding) for one-click outreach,
  a (currently dormant) Queues consumer for lifecycle events, and inbound Email Routing
  that parses RFC 3464 bounce DSNs
- **AI:** Workers AI binding for the brief builder; the planner is flag-gated off
- **Events:** every mutation writes an immutable audit/funnel event in the same D1 batch;
  action names come from a fixed enum, `channel` defaults to `manual`
- **Cron:** a single `*/5 * * * *` trigger — each tick runs the email resolution sweep;
  hourly jobs (outreach widening, retention purge, calendar fetch) gate on minute 0

## Features by phase

- **Phase 1 — cockpit core:** providers (services, trades, regions), request lifecycle,
  outreach logging, manual-effort tracking, funnel dashboard
- **Email pipeline:** one-click Accept / Quote / Decline links (single-use expiring
  tokens, no login), delivery lifecycle (sent → delivered/bounced → opened), hard-bounce
  auto-suppression, secret-gated lifecycle webhook, stale-`sent` resolution sweep
- **Phase 2 — matching & booking:** multi-trade availability windows, weighted matching
  engine (runtime-adjustable weights), 48-hour exclusive holds (`BOOKING_HOLDS_ENABLED`),
  booking request/confirm/cancel with reschedule proposals, AI brief builder
- **Phase 3 — pilot & monetization:** hand-billed pilot agreements
  (`MONETIZATION_PILOT_ENABLED` gates booking POSTs), register imports from
  Äriregister (companies) and MTR (trade notifications) with drift guards
- **Phase 4 — expansion:** secret Google/Outlook ICS calendar feeds with conflict
  rejection, trade/region catalog, reviews + reliability scores (neutral below minimum
  samples), provider accounts and the public `/u/*` portal, AI planner
  (`PLANNER_AI_ENABLED`, off), governed audit CSV export

## Repository layout

```
src/worker/       API (Hono app, auth, events, 16 route modules)
  routes/         providers, requests, matching, bookings/holds, briefs, email
                  outreach, effort, dashboard, suppression, catalog, calendar,
                  reviews, pilot, planner, audit export, provider portal
  email/          composer, sender, tokens, lifecycle events, inbound, webhook
  matching/       weights + engine   calendar/  ICS fetch + busy intervals
  cron/           widening, retention, calendar   ai/  brief builder
src/ui/           React SPA (dashboard, providers, requests, suppressions)
migrations/       Generated SQL migrations (drizzle-kit)
test/             Integration tests (vitest + @cloudflare/vitest-pool-workers, real D1)
docs/             plan.md, implementation-plan.md, decision-log.md, details/, phase0/
openspec/         Change specifications
scripts/          Register import CLIs + CI currency/push tooling (see below)
ops/              Operator SQL (staging reset)
.github/          CI workflow
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars        # fill in Access team domain, AUD, staff allowlist
npm run db:migrate:local              # apply migrations to the local D1
npm run dev                           # wrangler dev (API :8787) + vite (UI :5173, proxies /api)
```

Lint before landing: `npm run lint` (zero errors AND zero warnings is the bar —
the full react-hooks v7 rule suite including the React Compiler rules is
enabled, per the SUBC-016 decision-log entry) — CI runs lint → build →
typecheck → test → test:ui.

## Tests

```bash
npm test         # worker suite: vitest-pool-workers, real D1 in miniflare
npm run test:ui  # jsdom UI lane: React page fetch-effect contract (RTL)
```

422 integration tests (43 files) run against real D1 in miniflare (auth, providers,
requests, matching, holds/bookings, briefs, outreach, full email journey, delivery
lifecycle, suppression, calendar sync, catalog, reviews/reliability, monetization,
planner, provider accounts, register imports, dashboard, audit governance and the
CI-currency tooling itself). A separate jsdom lane (`npm run test:ui`,
@testing-library/react) adds 15 UI tests locking the page fetch-effect contract
(fetch on mount, refetch on filter/id change, stale-response guard under StrictMode;
SUBC-016). Counts verified 2026-11-12 from local vitest output.

## Feature flags (wrangler `vars`, default off unless noted)

| Flag | Effect |
|---|---|
| `BOOKING_HOLDS_ENABLED` | enables 48-hour exclusive hold routes |
| `MONETIZATION_PILOT_ENABLED` | booking POSTs require an active pilot agreement |
| `PLANNER_AI_ENABLED` | AI plan generation (off until real project data exists) |
| `CALENDAR_FETCH_ENABLED` | hourly ICS fetch (on; feeds exist once staff register them) |
| `MTR_BADGES_ENABLED` | MTR/Tarvik badge display (off until licence confirmation; import is always safe) |

## Schema changes

```bash
npm run db:generate                   # drizzle-kit generate -> migrations/*.sql
npm run db:migrate:staging
npm run db:migrate:production
```

Every new `migrations/*.sql` must also be registered in `test/apply-migrations.ts`
(the test pool applies them manually; a missing entry fails every test).

## Deploy

```bash
npm run deploy:staging     # build UI + wrangler deploy -e staging
npm run deploy:production  # build UI + wrangler deploy -e production
```

Rollback: `npx wrangler rollback -e <env>` (verified working).

## Staging data reset

Wipes all pilot data on staging (production is never reset this way). Staff users are
re-provisioned automatically from the Access JWT on next login.

```bash
npx wrangler d1 execute cockpit-staging -e staging --remote --file ops/staging-reset.sql -y
```

Verify afterwards: `GET /api/dashboard/overview` returns zeroes and the providers list
is empty.

## CI

`.github/workflows/ci.yml` runs lint, build, typecheck, the full integration test
suite and the jsdom UI lane (`npm run test:ui`) on **every push (any branch)** and
on pull requests; failed runs open a `ci-failure` issue as an alert (close it with
a comment, never delete it), and a `ci-merge-gate-pilot` ruleset gates PR merges
into `main` on the `test` check (currently **disabled** — parked pending PR-based
landing support in Fusion).

**Push transport (single-writer contract).** `scripts/push-main-when-ahead.mjs` is the
only component that ever pushes `main` (never force, never task branches). After a
landing on `main`: run the script (exit 0 = pushed + green Actions run on the tip),
then `node scripts/verify-landing-gate.mjs`. A scheduled cron re-flush is documented in
`docs/operator-ci-currency-cron.md`. Drift (alert file or non-zero
`verify-ci-currency.mjs`) blocks further merges until currency is restored. See
`agents.md` for the full contract.

## Register imports (only path register data may take into D1)

```bash
node scripts/import-ariregister.mjs <csv>   # Äriregister open data → companies
node scripts/import-mtr.mjs <xml> --dry-run # read-only BEFORE counts (SELECTs only)
node scripts/import-mtr.mjs <xml>           # emit SQL; review the `-- summary:` line
```

Always dry-run / emit to scratch first and sanity-check counts before applying with
`wrangler d1 execute … --file`. A drifted export (zero upserts) prints a GUARD
diagnostic and exits 1 — it can never flip every MTR trade-notification row to
`invalid` in one pass; `--force-expire` is an explicit operator override. Keep
downloads and emitted SQL in a `*.local/` directory (gitignored). Badge display stays
behind `MTR_BADGES_ENABLED` until the TTJA licence confirmation is recorded.

## Secrets (never committed)

Set per environment with `wrangler secret put <NAME> -e staging|production`:

| Secret | Purpose |
|---|---|
| `ACCESS_TEAM_DOMAIN` | e.g. `https://<team>.cloudflareaccess.com` (JWT issuer + JWKS host) |
| `ACCESS_AUD` | Access application AUD tag |
| `STAFF_ALLOWLIST` | comma-separated staff emails (defence in depth on top of the Access policy) |
| `EMAIL_TOKEN_SECRET` | HMAC secret for one-click email response tokens (`openssl rand -hex 32`) |
| `EMAIL_EVENTS_WEBHOOK_SECRET` | bearer secret for `POST /hooks/email-events` (unset ⇒ fail-closed 401) |
| `PROVIDER_SESSION_SECRET` | session cookie signing for the public `/u/*` provider portal |

Local equivalents go in `.dev.vars` (gitignored); see `.dev.vars.example`.

## Cloudflare setup checklist (dashboard, one-off per environment)

1. **D1** — `cockpit-staging` / `cockpit-production` exist (EU region), migrations applied.
2. **Zero Trust → Access → Applications** — a *Self-hosted* application for the Worker
   domain (policy: Allow → Emails = the team list; AUD tag → `ACCESS_AUD`), plus
   **Access bypasses** for the public paths: `/e/`, `/t/` (email tokens, tracking
   pixel), `/u/*` (provider portal) and `/hooks/` (webhook uses its own bearer secret).
3. **Email sending** — sending subdomain `subcontractor.ww0.dev` is verified (2026-10-18);
   `EMAIL_FROM` in `wrangler.jsonc` points at it. Account sending quota is
   1000 emails/day; `EMAIL_DAILY_LIMIT` (default 50) stays below it for warm-up.
4. **Inbound bounce routing** — on the sending-subdomain zone, enable Email Routing and
   deliver the sending addresses to this Worker; bounce DSNs then reach the `email()`
   handler automatically.
5. **Queues** (dormant consumer kept for the future) —
   `npx wrangler queues create email-events-staging` (and `-production`).
6. **Secrets** — put the table above per environment.
7. **Verify** — open the Worker URL, complete the Access login round-trip, confirm a
   `login` audit event appears; send to a known-bad address and confirm the bounce +
   suppression row appear within minutes.

## Email pipeline details

Three producers feed one shared, idempotent, transition-guarded applier
(`src/worker/email/events.ts`):

1. **Queue consumer (kept, dormant)** — the moment Cloudflare ships lifecycle-event →
   Queue routing, it starts producing with zero code changes.
2. **Secret-gated webhook** — `POST /hooks/email-events` accepts a single event or an
   array, e.g. `{"type":"message.delivered","to":"provider@example.ee","sendId":"…"}`
   (types mapped tolerantly via `delivered`/`bounced`/`opened` substrings). Manual ops
   recipe:

   ```bash
   curl -X POST https://<worker-host>/hooks/email-events \
     -H "Authorization: Bearer $EMAIL_EVENTS_WEBHOOK_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"type":"message.delivered","to":"provider@example.ee"}'
   # → {"accepted":1,"skipped":0}   (unknown recipient is skipped, never an error)
   ```

3. **Inbound bounce Email Worker** — the `email()` handler parses RFC 3464 DSNs
   (`Final-Recipient`, `Status 4.x/5.x`, `X-Failed-Recipients` fallback). Explicit
   failures only — vacation auto-replies and human replies are never bounces.

**Resolution sweep (no signal at all).** The 5-minute cron settles any email-channel
entry still `sent` after `EMAIL_RESOLVE_AFTER_MINUTES` (default 10) to `delivered`
marked as inferred (`{inferred: true, reason: "resolution_window_elapsed"}` in the
audit payload) — a real bounce arriving later still wins and suppresses the address.
With defaults, no message stays `sent` longer than ~15 minutes.

**Per-provider metrics.** `GET /api/dashboard/email-delivery` returns per-provider
sent / delivered / opened / bounced / skipped, `bounceRate` (skipped never counts in
the denominator) and the suppression flag — rendered in the dashboard's *Email
pipeline* section.

## Endpoints (staff API requires a valid Access JWT; `GET /api/health` is public)

Public non-Access routes: token links (`GET/POST /e/:token`), tracking pixel
(`GET /t/:file`), the provider portal (`/u/*` JSON API: token accept/login/logout,
`/u/me`, `/u/company`, owner user management) and the webhook
(`POST /hooks/email-events`).

- **Providers** — `POST/GET /api/providers`, `GET/PATCH /api/providers/:id`,
  `POST /api/providers/:id/services`, `PATCH /api/providers/:id/services/:serviceId`,
  `PUT /api/providers/:id/regions`, `GET/POST /api/providers/:id/availability`
  (+ `/reconfirm`), `GET /api/providers/:id/verifications`, `GET/POST
  /api/providers/:id/users` (+ `/disable`), `POST /api/providers/:id/erase` (GDPR),
  `GET/POST/DELETE /api/providers/:id/calendar(/:feedId)`
- **Requests** — `POST/GET /api/requests`, `GET/PATCH /api/requests/:id`,
  `POST …/transition | /responses | /bookings | /outcome | /cancel`,
  `GET …/history`, `GET/POST …/effort` · `POST …/time`, `GET/POST …/outreach`
- **Matching & booking** — `POST /api/requests/:id/match`, `GET/PUT
  /api/matching/weights`, `GET/POST /api/requests/:id/holds`,
  `POST /api/holds/:id/release`, `POST …/bookings/request | /confirm | /cancel |
  /reschedule` (+ proposal `confirm`/`reject`), `POST …/work-start`
- **Briefs & planner** — `POST /api/briefs/draft`, `GET /api/briefs/:id`,
  `POST /api/briefs/:id/approve`, `POST /api/requests/:id/plan`,
  `GET /api/requests/:id/plans`, `POST /api/plans/:id/feedback`
- **Email** — `POST /api/requests/:id/outreach/email`, `GET/POST/DELETE
  /api/suppressions(/:email)`
- **Catalog & pilot** — `GET /api/catalog`, `POST /api/catalog/trades(/:slug/deactivate) |
  /catalog/regions`, `GET/POST /api/partners`, `GET/POST /api/pilot/agreements`
  (+ `/:id/end`), `GET /api/pilot/metrics`, `POST /api/requests/:id/partner`
- **Reviews** — `GET /api/providers/:id/reviews`, `POST /api/bookings/:bookingId/review`
  (+ `/dispute`, `/restore`)
- **Dashboard** — `GET /api/dashboard/overview | /supply | /effort | /weekly |
  /email-delivery | /export.csv`
- **Governance** — `GET /api/audit/export` (governed audit CSV)

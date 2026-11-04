# Subcontractor Marketplace

Internal concierge cockpit and future marketplace codebase for the Estonian construction
subcontractor pilot. The cockpit (this repo's first app) is the staff tool for running
the pilot: provider administration, request lifecycle, outreach logging, manual-effort
tracking and a funnel dashboard. Runs entirely on Cloudflare (Workers + D1 + Access +
Static Assets).

## Stack

- **API:** Hono (TypeScript) on Cloudflare Workers
- **Frontend:** React + Vite + Tailwind, served via Workers Static Assets (SPA)
- **Database:** Cloudflare D1 (SQLite) with Drizzle ORM and versioned SQL migrations
- **Auth:** Cloudflare Access — the Worker validates the `Cf-Access-Jwt-Assertion` JWT
  (signature via the team JWKS, issuer + audience), auto-provisions allowlisted staff and
  denies everyone else with 403
- **Events:** every mutation writes an immutable audit/funnel event in the same D1 batch;
  action names come from a fixed enum, `channel` defaults to `manual`

## Repository layout

```
src/worker/       API (Hono app, auth, event helper, routes, Drizzle schema)
src/ui/           React SPA (providers, requests, dashboard)
migrations/       Generated SQL migrations (drizzle-kit)
test/             Integration tests (vitest + @cloudflare/vitest-pool-workers, local D1)
docs/             Planning docs
openspec/         Change specifications
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars        # fill in Access team domain, AUD, staff allowlist
npm run db:migrate:local              # apply migrations to the local D1
npm run dev                           # wrangler dev (API :8787) + vite (UI :5173, proxies /api)
```

## Tests

```bash
npm test
```

320 integration tests run against real D1 in miniflare (auth, providers, requests,
outreach, effort, dashboard, email pipeline, full email journey, register
imports). Count verified 2026-11-04.

## Schema changes

```bash
npm run db:generate                   # drizzle-kit generate -> migrations/*.sql
npm run db:migrate:staging
npm run db:migrate:production
```

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

`.github/workflows/ci.yml` runs lint, build, typecheck and the 320 integration tests
on **every push (any branch)** and on pull requests; failed runs open a `ci-failure`
issue as an alert, and a `ci-merge-gate-pilot` ruleset gates PR merges into `main`
on the `test` check (currently **disabled** — parked pending PR-based landing
support in Fusion). Requires the repo to be pushed to GitHub
with Actions enabled.

## Secrets (never committed)

Set per environment with `wrangler secret put <NAME> -e staging|production`:

| Secret | Purpose |
|---|---|
| `ACCESS_TEAM_DOMAIN` | e.g. `https://<team>.cloudflareaccess.com` (JWT issuer + JWKS host) |
| `ACCESS_AUD` | Access application AUD tag |
| `STAFF_ALLOWLIST` | comma-separated staff emails (defence in depth on top of the Access policy) |
| `EMAIL_TOKEN_SECRET` | HMAC secret for one-click email response tokens (`openssl rand -hex 32`) |

Local equivalents go in `.dev.vars` (gitignored); see `.dev.vars.example`.

## Cloudflare setup checklist (dashboard, one-off per environment)

1. **D1** — `cockpit-staging` / `cockpit-production` exist (EU region), migrations applied.
2. **Zero Trust → Access → Applications** — add a *Self-hosted* application for the
   Worker domain (`concierge-cockpit-staging.<account>.workers.dev`, then production),
   policy: Allow → Emails = the team list. Copy the application's **AUD tag** into the
   `ACCESS_AUD` secret.
3. **Secrets** — put `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `STAFF_ALLOWLIST` per environment.
4. **Verify** — open the Worker URL, complete the Access login round-trip, confirm a
   `login` audit event appears.

## Email pipeline

One-click Accept / Quote / Decline links in outreach emails (no login, single-use
expiring tokens) plus delivery lifecycle tracking: sent → delivered/bounced → opened,
with hard-bounced addresses auto-suppressed. Sending uses the Cloudflare Email Service
`SEND_EMAIL` binding.

**Delivery lifecycle ingestion (SUBC-011, 2026-11-03) — three paths, one state
machine.** Cloudflare's dashboard offers no lifecycle-event → Queue routing for the
Email Service (checked 2026-10-18: domain settings, Connect tab, account settings), so
the original Queue consumer sat dormant and every email stayed `sent` forever. The
workaround keeps everything inside Cloudflare and feeds one shared, idempotent,
transition-guarded applier (`src/worker/email/events.ts`) from three producers:

1. **Queue consumer (kept, dormant)** — `queue()` on the Worker still consumes
   `email-events-staging` / `email-events-production`. The moment Cloudflare ships
   lifecycle-event → Queue routing, it starts producing with zero code changes.
2. **Secret-gated webhook receiver** — `POST /hooks/email-events` (public route, no
   Access; bearer-secret auth, constant-time compare, fail-closed 401 when the secret
   is unset). This is the path usable *today*: manual ops during concierge processing,
   a provider reports an outcome, or any future provider-side routing. Accepts a single
   event or an array; event shape `{"type": "message.delivered|message.bounced",
   "to": "<contact email>", "sendId": "…", "permanent": true}` — type substrings
   `delivered`/`bounced`/`opened` are mapped tolerantly.
3. **Inbound bounce Email Worker** — Cloudflare Email Routing delivers DSN bounces
   sent back to our sending subdomain addresses to the Worker's `email()` handler,
   which parses RFC 3464 delivery-status notifications (`Final-Recipient`, `Status
   4.x/5.x`, `X-Failed-Recipients` fallback). Explicit failures only — vacation
   auto-replies and human replies are never classified as bounces.

**Resolution sweep (no signal at all).** A scheduled sweep
(`resolveStaleSentEmails`, run from the 5-minute cron — see below) settles any
e-mail-channel entry still `sent` after `EMAIL_RESOLVE_AFTER_MINUTES` (default 10) to
`delivered` **marked as inferred**: the `email_delivered` audit payload carries
`{inferred: true, reason: "resolution_window_elapsed", source: "resolution"}` so
timeout-settled deliveries stay honestly distinguishable from provider-confirmed ones
in every dashboard query. A real bounce arriving later still wins (bounce beats any
earlier state, including inferred delivery, and suppresses the address). With the
default 10-minute window + 5-minute sweep, no pilot message stays `sent` longer than
~15 minutes; the first sweep run after deploy retroactively resolves historical stuck
`sent` entries.

**Per-provider delivery metrics.** `GET /api/dashboard/email-delivery` (Access-guarded)
returns per-provider sent / delivered / opened / bounced / skipped counts, a computed
`bounceRate` (bounced ÷ dispatched; skipped never counts in the denominator), and the
suppression flag — rendered as the per-provider table in the dashboard's *Email
pipeline* section for the Gate 2 evidence pack.

Setup, in order:

1. **Verify a sending subdomain (DONE 2026-10-18).** Sending subdomain
   `subcontractor.ww0.dev` is verified and enabled in the Cloudflare dashboard (DNS
   records created, Email Sending on). `EMAIL_FROM` in `wrangler.jsonc` is configured
   accordingly: `Subcrew Staging <info@subcontractor.ww0.dev>` /
   `Subcrew <info@subcontractor.ww0.dev>`. Note the account-level
   sending quota is **1000 emails/day**; `EMAIL_DAILY_LIMIT` warm-up cap stays below it.

2. **Create the queues** (the dormant consumer stays wired for the future):

   ```bash
   npx wrangler queues create email-events-staging
   npx wrangler queues create email-events-production
   ```

3. **Secrets** — per environment:

   ```bash
   openssl rand -hex 32
   npx wrangler secret put EMAIL_TOKEN_SECRET -e staging
   npx wrangler secret put EMAIL_TOKEN_SECRET -e production
   # SUBC-011: webhook receiver secret (unset ⇒ the endpoint fails closed)
   openssl rand -hex 32
   npx wrangler secret put EMAIL_EVENTS_WEBHOOK_SECRET -e staging
   npx wrangler secret put EMAIL_EVENTS_WEBHOOK_SECRET -e production
   ```

   Webhook curl recipe (manual ops path — an unknown recipient is skipped, never an
   error):

   ```bash
   curl -X POST https://<worker-host>/hooks/email-events \
     -H "Authorization: Bearer $EMAIL_EVENTS_WEBHOOK_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"type":"message.delivered","to":"provider@example.ee"}'
   # → {"accepted":1,"skipped":0}   (or {"accepted":0,"skipped":1} for unknown)
   ```

4. **Inbound bounce routing (one-off dashboard setup, post-deploy operator step).**
   On the `subcontractor.ww0.dev` zone in the Cloudflare dashboard: enable **Email
   Routing**, then add a route delivering the envelope addresses of the sending
   subdomain (e.g. `info@subcontractor.ww0.dev`, or a catch-all on the subdomain) to
   this Worker (Send to → Worker → `concierge-cockpit-staging` / `…-production`).
   Bounce DSNs returned by recipient mail servers then flow into the `email()` handler
   automatically. Verification is a live post-deploy check: send to a known-bad
   address, confirm the entry flips to `bounced` and the suppression row appears within
   minutes.

5. **Resolution window** — `EMAIL_RESOLVE_AFTER_MINUTES` (default 10) is set in the
   `vars` of both `staging` and `production` in `wrangler.jsonc`; adjust per
   environment if provider DSN latency makes inferred deliveries too eager (DSN bounces
   usually arrive within minutes; the window only needs to exceed typical bounce
   latency).

6. **Deploy + migrate:**

   ```bash
   npm run db:migrate:staging
   npm run deploy:staging
   npm run db:migrate:production
   npm run deploy:production
   ```

7. **Warm-up.** `EMAIL_DAILY_LIMIT` (default 50) hard-caps sends per UTC day; start low
   and raise gradually to protect the new subdomain's reputation. Hard bounces
   auto-suppress the address — suppressed providers are skipped at batch-send time.

**Cron cadence (SUBC-011):** the Worker's cron trigger fires **every 5 minutes**
(`*/5 * * * *`). Each tick runs the email resolution sweep; the pre-existing hourly
jobs (outreach widening, retention purge, calendar fetch) gate on minute 0 inside
`runScheduledJobs`, so their cadence is unchanged.

Local development equivalents go in `.dev.vars` (gitignored); see `.dev.vars.example`
(`EMAIL_TOKEN_SECRET`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, `EMAIL_DAILY_LIMIT`,
`EMAIL_TOKEN_TTL_SECONDS`, and the SUBC-011 additions `EMAIL_EVENTS_WEBHOOK_SECRET`,
`EMAIL_RESOLVE_AFTER_MINUTES`).

## Endpoints (all require a valid Access JWT; `GET /api/health` is public)

Public non-Access routes: the token links (`GET/POST /e/:token`), the tracking pixel
(`GET /t/:file`), the provider portal (`/u/*`), and the secret-authenticated email-event
webhook (`POST /hooks/email-events` — bearer secret, no Access JWT).

- `POST /api/providers`, `GET /api/providers`, `GET /api/providers/:id`, `PATCH /api/providers/:id`
- `POST /api/providers/:id/services`, `PATCH /api/providers/:id/services/:serviceId`
- `POST /api/requests`, `GET /api/requests`, `GET /api/requests/:id`, `PATCH /api/requests/:id`
- `POST /api/requests/:id/transition | /responses | /bookings | /outcome | /cancel`
- `GET /api/requests/:id/history`, `GET /api/requests/:id/effort`
- `POST /api/requests/:id/outreach`, `GET /api/requests/:id/outreach`
- `POST /api/requests/:id/time`
- `GET /api/dashboard/overview | /supply | /effort | /email-delivery`

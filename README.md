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

41 integration tests run against real D1 in miniflare (auth, providers, requests,
outreach, effort, dashboard).

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

`.github/workflows/ci.yml` runs typecheck, the 41 integration tests and the build on
every push to `main` and on pull requests. Requires the repo to be pushed to GitHub
with Actions enabled.

## Secrets (never committed)

Set per environment with `wrangler secret put <NAME> -e staging|production`:

| Secret | Purpose |
|---|---|
| `ACCESS_TEAM_DOMAIN` | e.g. `https://<team>.cloudflareaccess.com` (JWT issuer + JWKS host) |
| `ACCESS_AUD` | Access application AUD tag |
| `STAFF_ALLOWLIST` | comma-separated staff emails (defence in depth on top of the Access policy) |

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

## Endpoints (all require a valid Access JWT; `GET /api/health` is public)

- `POST /api/providers`, `GET /api/providers`, `GET /api/providers/:id`, `PATCH /api/providers/:id`
- `POST /api/providers/:id/services`, `PATCH /api/providers/:id/services/:serviceId`
- `POST /api/requests`, `GET /api/requests`, `GET /api/requests/:id`, `PATCH /api/requests/:id`
- `POST /api/requests/:id/transition | /responses | /bookings | /outcome | /cancel`
- `GET /api/requests/:id/history`, `GET /api/requests/:id/effort`
- `POST /api/requests/:id/outreach`, `GET /api/requests/:id/outreach`
- `POST /api/requests/:id/time`
- `GET /api/dashboard/overview | /supply | /effort`

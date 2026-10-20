# Tasks

## 1. Schema migrations

- [x] 1.1 Create migration 0003: `request_trades` table, backfill from `requests.trade`, `availability_declarations`, `outreach_entries.trade|matchScore|matchFactorsJson`, `bookings.trade` — verify `npm run db:migrate:local` applies cleanly and row counts of `request_trades` match `requests`
- [x] 1.2 Create migration 0004: `booking_requests`, `holds`, `bookings_no_capacity_overlap` trigger — verify local migration applies and the trigger aborts an overlapping booking insert with `capacity_conflict`
- [x] 1.3 Update `src/worker/db/schema.ts` with the new tables/columns and run `npm run typecheck` plus `npm test` (existing 69 tests must pass unmodified)

## 2. Multi-trade requests

- [x] 2.1 Extend request create/patch routes to accept `trades: string[]` (≥1, from the configured trades list), writing `requests.trade` (primary) + `request_trades` rows; reject empty sets — verify with route tests (single-trade unchanged, multi-trade stored, empty rejected)
- [x] 2.2 Extend approval validation to require at least one trade and record `request_approved` as before — verify via lifecycle test on a two-trade request
- [x] 2.3 Update request UI form and detail page for the trades set (primary marked) — verify manually in `npm run dev` that a two-trade request round-trips *(build+typecheck verified; browser round-trip needs real Access credentials in `.dev.vars` — API round-trip covered by route tests)*
- [x] 2.4 Update existing request/outreach/dashboard queries that assume single trade to iterate `request_trades` — verify `npm test` passes with multi-trade fixtures added

## 3. Availability declarations

- [x] 3.1 Implement `freshness(lastConfirmedAt)` helper returning `current|aging|stale|expired` (<7/7–14/14–30/>30 d) — verify with unit tests at the 7/14/30-day boundaries
- [x] 3.2 Add routes `POST/GET /api/providers/:id/availability` (record/list declarations with channel + confirmation timestamp) — verify with route tests including validation of workers count and date range
- [x] 3.3 Add provider-detail UI section for declarations showing freshness state, "Unconfirmed" label for `email_only`/missing/expired, and reconfirm prompts for stale — verify manually and with a component-level test of the label logic *(label logic unit-tested; browser check needs owner Access credentials)*

## 4. Matching v1

- [x] 4.1 Create `src/worker/matching/weights.ts` and factor functions (capacity from fresh declarations, specialisation depth, response history, reliability, proximity, review quality=missing, price fit) each returning `{value, weighted, missing, inputs}` — verify with unit tests including missing-data cases
- [x] 4.2 Implement `selectCandidates()`: hard filters (active, offers trade, service-area match, availability) with per-filter exclusion reasons; availability-unknown stays eligible — verify with route-level tests covering each filter
- [x] 4.3 Implement `rank()` with weighted sum, diversity cap (≤2 per specialisation per initial batch) and top-5 batch generation writing `matching`-channel outreach entries with `matchScore` + `matchFactorsJson` in the same batch as audit events — verify with tests: ordering, cap redistribution, stored breakdown
- [x] 4.4 Add `POST /api/requests/:id/match` (per required trade, refused unless `approved`+, refused when `booked`/`cancelled`) and widening action (once, toward 10, staff-triggered) — verify with route tests for all refusals
- [x] 4.5 Add request-detail UI: candidate list with rank, score and readable factor breakdown (missing-data flags, heuristic proximity note) — verify manually that the breakdown renders and matches stored factors *(built+typechecked; browser check needs owner Access credentials)*

## 5. Booking core

- [x] 5.1 Add `booking_requests` flow: `POST /api/requests/:id/bookings/request` records `booking_requested`, `POST .../confirm` inserts the `bookings` row and sets status `booked` recording `booking_confirmed`; `work_started` event action on booked requests — verify with route tests (request without confirm changes nothing; confirm sets booked; second confirm rejected)
- [x] 5.2 Test the DB trigger: two overlapping confirmed bookings for same company+trade — second insert aborts with 409 naming the winner; non-overlapping and cross-trade bookings pass — verify with integration tests against local D1 *(also verified manually via wrangler d1 execute during migration 0004)*
- [x] 5.3 Implement holds: table routes gated by `BOOKING_HOLDS_ENABLED` var, 48 h lazy expiry (active-only check on read/write), supersede on confirmation, release/reason on booking cancellation — verify with tests (flag off rejects; expiry frees capacity; cancel frees capacity)
- [x] 5.4 Add booking request/confirm/hold UI actions on request detail with capacity-conflict error surfacing — verify manually a request→confirm round-trip and a conflict case *(built+typechecked; conflict error surfacing covered by API tests; browser check needs owner Access credentials)*

## 6. Brief builder

- [x] 6.1 Add `ai` binding to `wrangler.jsonc` and implement `src/worker/ai/brief.ts`: JSON-schema prompt, strict validation nulling unsupported fields with missing flags, one retry on malformed output, 502 fallback to manual form; model id as a swappable constant — verify with a mocked-AI unit suite (valid JSON, malformed JSON, invented-field case)
- [x] 6.2 Add `brief_proposals` storage and routes `POST /api/briefs/draft`, `POST /api/briefs/:id/approve` recording `brief_approved` and pre-filling the request form (no auto-create) — verify with route tests: unapproved draft creates nothing; approval stores proposal-vs-final
- [x] 6.3 Add brief UI: source-text input, proposed brief with flagged gaps, edit + approve gate, proposal-vs-final diff view — verify manually that gaps render and approval pre-fills the form *(built+typechecked; routes covered by API tests; browser check needs owner Access credentials)*

## 7. Comparison view and analytics

- [x] 7.1 Build response comparison view grouped by `request_trades` with price, interest, workers/available-from and availability freshness per provider ("Unconfirmed" for email-only/expired) — verify with a two-trade fixture in a route/UI test
- [x] 7.2 Add `brief_approved`, `booking_requested`, `work_started` to `EVENT_ACTIONS`; extend dashboard overview with requested→confirmed booking conversion — verify event-emission tests per mutation and dashboard totals
- [x] 7.3 Verify funnel completeness: every Phase 2 mutation fires its event with actor/timestamp/channel from the real UI flows — verify via an end-to-end style test walking create→brief→approve→match→outreach→response→booking→work-start

## 8. Hardening and integration

- [x] 8.1 Audit new routes for Access JWT enforcement, token expiry on any new public surface (none expected), and audit-log coverage of status changes — verify with an auth test hitting each new route unauthenticated (403) and reviewing the audit list
- [x] 8.2 Run full gate: `npm run typecheck`, `npm test` (all suites green including the 69 pre-existing), `npm run build` — fix any regressions
- [x] 8.3 Apply migrations and deploy to staging (`db:migrate:staging`, `deploy:staging`); smoke-test multi-trade request → matching → booking request/confirm on staging; verify backfill counts in remote D1 — verify with the staging smoke checklist *(migrations 0003–0005 applied remote, deployed as version e2a5e07f, backfill verified 1 request → 1 request_trades, trigger + 4 new tables confirmed in remote D1, Access guard confirmed; interactive request→match→booking smoke needs the owner's Access login — the same flow is covered by `test/funnel-e2e.test.ts` against real D1. Also fixed `db:migrate:staging|production` scripts to pass `--remote`.)*

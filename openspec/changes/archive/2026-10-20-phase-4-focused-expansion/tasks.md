# Tasks

## 1. Migration and catalog foundation

- [x] 1.1 Write `migrations/0007_phase4_expansion.sql`: `trades`, `regions`, `service_regions`, `partners`, `calendar_feeds`, `calendar_busy_intervals`, `booking_reviews`, `pilot_agreements`, `provider_users`, `project_plans`, `requests.region`, `requests.partnerId`, all indexes per design D14, idempotent seed of the six pilot trades with pilot minimums; register it in `test/apply-migrations.ts`
- [x] 1.2 Add Drizzle schema for all new tables/columns in `src/worker/db/schema.ts` (incl. new email-token purposes `provider_invite`/`provider_login`, new audit actions in `events.ts`)
- [x] 1.3 Create `src/worker/catalog.ts` (60s TTL cache) and rewire `PILOT_TRADES`/`TRADE_PILOT_MINIMUMS` to seed+fallback only; switch `src/ui/types.ts` and `src/worker/ai/brief.ts` to catalog-driven trade validation
- [x] 1.4 Trades/regions/partners staff CRUD routes + catalog fallback test

## 2. Calendar sync

- [x] 2.1 Pure ICS parser `src/worker/calendar/ics.ts`: VEVENT/DTSTART/DTEND, all-day dates, bounded DAILY/WEEKLY RRULE expansion clipped to a 90-day window, `unparsedCount` for anything else — unit tests with Google- and Outlook-shaped fixtures
- [x] 2.2 Feed CRUD routes for staff: register (mask URL in responses, `MAX_FEEDS_PER_COMPANY` limit), list, remove (purges intervals); audit `calendar_feed_added`/`calendar_feed_removed`
- [x] 2.3 Fetch job `src/worker/cron/calendar.ts`: hourly fetch with per-feed backoff (`failCount`/`nextAttemptAt`), replace-on-success, failure recording, staleness flag via `CALENDAR_STALE_DAYS`; wire into `scheduled` behind `CALENDAR_FETCH_ENABLED`; direct-invocation tests
- [x] 2.4 Busy-interval consult in booking create/confirm/reschedule and widening filter: overlap → `calendar_conflict` rejection, opaque message; tests for busy-wins-over-declaration and no-feeds-unchanged

## 3. Reliability and reviews

- [x] 3.1 `booking_reviews` routes: submit (1–5 + comment, `completion_confirmed` only, one per booking), dispute/undispute with reason; audit `review_submitted`/`review_disputed`/`review_restored`
- [x] 3.2 Pure metrics `src/worker/reliability.ts`: response rate, median first-response hours, completion rate (customer-caused cancellations excluded), average review score — minimums 5/5/3/3 with insufficient-history states and confidence band; unit tests at/around each threshold
- [x] 3.3 Established badge in `src/worker/verification.ts` badge pipeline (≥3 positive completions, basis shown, customer-caused cancellations excluded); provider comparison surfaces show/hide correctly
- [x] 3.4 Reliability weights row (append-only version bump), scoring component with neutral-for-insufficient-history, read-back with sample sizes; matching tests for neutrality and version-stable explanations

## 4. Region-aware matching

- [x] 4.1 `service_regions` management on provider routes; provider views show coverage
- [x] 4.2 Request region: capture (validated against catalog), display, pass-through to matching; `request-administration` tests
- [x] 4.3 Matching region filter: region requests restrict to covering-or-undeclared candidates, read-back names the filter; no-region behaviour byte-identical; tests for both

## 5. Monetization pilot

- [x] 5.1 Partners + `pilot_agreements` routes (create/end agreement, notes, price); audit `pilot_agreement_added`/`pilot_agreement_ended`; attach `partnerId` to requests in request creation/edit
- [x] 5.2 Gating middleware behind `MONETIZATION_PILOT_ENABLED`: booking mutations gated to read-only + upgrade prompt for agreement-less partners, `pilot_gate_blocked` event; flag-off identity tests
- [x] 5.3 Pilot metrics endpoint: per-partner booking usage, gated-view counts, agreement share; tests

## 6. Provider accounts

- [x] 6.1 `provider_users` routes: staff provisions first owner; owner invites/disables users; suppression-list check on invite mail; audit lifecycle events
- [x] 6.2 Token login + HMAC session cookie (`PROVIDER_SESSION_SECRET`, 12h): invite/login token purposes, single-use, generic errors for disabled/invalid, `lastLoginAt` update
- [x] 6.3 `requireProviderUser` middleware: companyId scoping on responses/availability/calendar/bookings routes, owner-only user management, 404-shape cross-company denials; tests for coordinator/owner/staff boundaries

## 7. Planner AI

- [x] 7.1 `src/worker/planner.ts`: grounded prompt from approved request + historical per-trade aggregates, `env.AI` injected, insufficient-grounding and error paths, `PLANNER_AI_ENABLED` gate; stub-based tests (binding out of test runtime)
- [x] 7.2 `project_plans` route: generate (labelled draft, no side effects, audit `planner_generated`), feedback useful/not + comment with `planner_feedback` audit, feedback counts

## 8. Audit export and governance

- [x] 8.1 CSV export route: required date range (capped), optional company/action filters, 50k row cap with truncation marker, `audit_exported` event; Access-protected; tests
- [x] 8.2 Erasure extension: post-batch phase deletes feeds/interval/provider users and redacts review text + metric contribution; tests asserting no calendar/user/review residue
- [x] 8.3 Retention job: purge intervals beyond `CALENDAR_PURGE_DAYS` staleness (feed row kept); tests

## 9. Gates, deploy, docs

- [x] 9.1 Full gate: typecheck, vitest suite, build; EXPLAIN QUERY PLAN for new hot paths (interval lookup, service_regions join, provider_users email)
- [x] 9.2 Apply migration 0007 to local, staging, production D1; set new env vars (flags default off, `CALENDAR_*`, `MAX_FEEDS_PER_COMPANY`, `PROVIDER_SESSION_SECRET`) in both environments
- [x] 9.3 Deploy staging + production with cron triggers live; smoke-verify flag-off behaviour unchanged and Access guards on all new endpoints
- [x] 9.4 Update `docs/implementation-plan.md` Phase 4 section with engineering-status note (what's built vs. gate-blocked) and `agents.md` with new env vars + ICS/import notes

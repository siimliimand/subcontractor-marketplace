# Design

## Context

Phase 2 shipped the full concierge pipeline; the phase-2 inventory shows the exact gaps this change closes: no scheduled handler (widening manual-only), booking_requests `requested` state never labelled tentative, no reschedule/booking-cancel endpoints, freshness is display-only, `matchFactorsJson` written but never read back, dashboard API returns `bookingFlow` that the UI ignores, no retention/erasure/suppression-management anywhere, and register data only in `companies.registrationIdentifier`.

Constraints carried forward: Cloudflare-only, **no runtime external API calls**; vitest-pool-workers pins miniflare 3.20241230.0 (no `ai` binding in tests; scheduled handlers tested by direct module invocation); `test/apply-migrations.ts` must register each new migration; Access guards all staff routes (fail-closed).

## Goals / Non-Goals

- Goals: pilot can run weekly with less manual effort (auto-widening, reconfirm one-click, full dashboard), trust is visible (badges), ranking learns from outcomes, GDPR checklist closes.
- Non-Goals: provider-facing signup/accounts (adoption prompt points at a human next step), calendar sync, tax-debt badge, reviews, real-time register API integration, weight auto-tuning (staff-set only).

## Decisions

### D1: One hourly cron, two jobs, pure functions underneath
`src/worker/index.ts` gains a `scheduled` handler; wrangler gets `triggers.crons: ["0 * * * *"]`. The handler dispatches to `src/worker/cron/widening.ts` (auto-widen) and `src/worker/cron/retention.ts` (purge). All logic lives in exported pure-ish functions taking `(env, ctx, now)`; the handler is a thin wrapper. Tests import the functions directly (no `runScheduled` support needed on the pinned miniflare).

- Widening: requests in `in_outreach` with a matching batch, no qualified response, and no prior widen (manual or automated) older than `WIDENING_TIMEOUT_HOURS` (default 8, wall clock — working-hours precision is not worth the complexity; noted as a tuning knob) are widened once toward 10 via the existing widening routine, audit `matched` channel `automated`.
- Retention: delete `email_tokens` expired > `RETENTION_TOKEN_DAYS` (default 30) and holds in terminal states > 90 days. Returns counts; logged, not audited (funnel events stay funnel-only).

### D2: Tentative/confirmed is labelling + metrics, not a new state
`booking_requests.state='requested'` *is* tentative; `bookings` *is* confirmed. No new columns — UI labels ("Tentative — awaiting confirmation") and metric definitions (only `bookings` count as confirmed) enforce the distinction. A provider declining a tentative request already arrives as a decline response; `booking_requests.declined` is explicitly **not** added.

### D3: Reschedule via `booking_reschedules` + an UPDATE capacity trigger
New table `booking_reschedules` (bookingId, proposedTrade, dates, workersCount, state `proposed|confirmed|rejected`, reason, proposedBy, resolvedBy, timestamps). Confirm flow: UPDATE the booking row inside the same batch as the proposal row. The phase-2 trigger `bookings_no_capacity_overlap` is BEFORE INSERT only, so migration 0006 adds the symmetric `bookings_no_capacity_overlap_update` BEFORE UPDATE trigger (ignores the row's own id; same `capacity_conflict` raise). Trigger tests use distinct bookings (requestId UNIQUE).

### D4: Booking-level cancellation reuses `bookings.outcome` + new attribution columns
Migration 0006 adds `bookings.cancelledBy` (customer|provider), `cancelReason`, `cancelledAt`. `POST /requests/:id/bookings/cancel` sets `outcome='cancelled'` + attribution; parent request stays open for re-booking. Request-level cancel keeps also setting booking outcome (unchanged). `accepted_but_not_delivered` and provider-attributed cancellations feed the reliability factor and the failed-commitments metric.

### D5: Reconfirmation = clone latest declaration
`POST /providers/:id/availability/reconfirm` finds the latest declaration covering the booking/request window and inserts a fresh one with `lastConfirmedAt=now`, `createdBy` staff, `notes` "reconfirmation". Booking/request views compute freshness from `availability.ts` and show the prompt + one-click action when aging/stale/expired declarations underlie a live booking. No email reconfirmation loop in this change (staff records the provider's verbal confirmation — concierge reality).

### D6: Badges — `company_verifications` + offline SQL-emitting import scripts
Table `company_verifications` (companyId, type `registry_active|trade_notification`, trade nullable, status `valid|invalid|unknown`, checkedAt, sourceDataset, sourceLicence, detailJson; unique on (companyId, type, trade)). Scripts `scripts/import-ariregister.mjs` / `scripts/import-mtr.mjs` (devDependencies: `csv-parse`, `fast-xml-parser`) parse downloaded open-data files and emit idempotent `INSERT ... ON CONFLICT DO UPDATE` SQL to a file the staff applies with `wrangler d1 execute --remote --file`. EMTAK→trade mapping lives in one config map. **No runtime fetch anywhere.** Trade badge rendering is gated by `MTR_BADGES_ENABLED` (default false) until the TTJA confirmation is recorded; import + data model ship regardless. Attribution strings (RIK/CC BY 4.0, TTJA/CC BY-SA 3.0) stored per import.

### D7: Learning loop — computed at match time, weights in DB, snapshot in matchFactorsJson
Provider outcome stats (response count/rate/median hours; completions vs accepted-but-not-delivered vs provider-cancelled bookings) are aggregated with indexed queries at match time — pilot scale (≤ few hundred providers) makes a stats table unnecessary. `responseHistory` and `reliability` factors consume them (today they run on placeholders); no history ⇒ score 0 + `missing` flag (existing convention). Weights move to an append-only `match_weights` table (factor, weight, reason, setBy, setAt; effective = latest row per factor); seeded from `weights.ts` defaults on first read; `GET/PUT /api/matching/weights` (PUT requires reason). `matchFactorsJson` gains a `weights` snapshot — this is what makes post-hoc explainability truthful. Payment never enters any factor.

### D8: Adoption prompt — audit-event as the once-marker
On the accept/quote confirmation page: if the company has only `email_only` availability declarations and no prior `adoption_prompted` audit event, render the prompt (booking-system pitch + a `mailto:` next step — no signup flow exists, the honest CTA is human contact) and write `adoption_prompted` (channel `automated`, payload references company/request ids, no email). New audit action added to `events.ts` inventory.

### D9: Data governance — three small surfaces
- Suppression: `GET/POST/DELETE /api/suppressions` (+ reason on add/remove) and a Suppression admin page; DELETE = removal (audited `suppression_removed`), additive to existing bounce-driven flow.
- Erasure: `POST /api/providers/:id/erase` (reason required) — anonymise `legalName`→`Erased company <id>`, contactEmail/contactPhone→null, `companies.status='opted_out'` reason 'erased'; redact that email in `audit_events.payloadJson` and `actorEmail` via SQL `replace()`; funnel history intact. Audited `company_erased` (actor = staff).
- Minimisation: `email_sent` payload drops the embedded recipient (keeps outreach entry id); `adoption_prompted` follows the same rule.

### D10: Dashboard — weekly buckets in one endpoint, CSV from the same rows
`GET /api/dashboard/weekly?from&to` computes ISO-week buckets (Europe/Tallinn) for all 08 metrics from `audit_events` + tables; empty denominators return `null` (UI renders "no data" — never 0%). `GET /api/dashboard/export.csv` streams the same rows as CSV (`text/csv`, one row per week). Repeat usage groups by `requests.pmName` (documented limitation: free-text PM identity until partners get accounts). Availability confirmation numerator = responses with `workersCount > 0`, denominator = all responses minus provider declines. Add indexes in 0006 for the hot aggregate: `audit_events(action, occurredAt)`, `outreach_entries(requestId)`, `responses(requestId)`.

## Risks / Trade-offs

- **Wall-clock widening timeout** may widen during nights/weekends — acceptable; tuning knob exists and widening is once-only.
- **pmName as PM identity** for repeat usage — fine for ≤5 partners; revisited with provider accounts in Phase 4.
- **MTR badge built but hidden** — if TTJA confirms quickly, enabling is a env var flip; if licence is refused, display stays off and nothing rots (import is staff-optional).
- **SQL-replace redaction** on erasure is blunt — acceptable at pilot scale; a payload-rewriting pass would be over-engineering.
- **UPDATE trigger symmetry** must be tested explicitly (the insert trigger alone does not protect reschedules).

## Migration Plan

Migration `0006_phase3_pilot.sql`: `company_verifications`, `booking_reschedules`, `match_weights`, `bookings` attribution columns, UPDATE capacity trigger, dashboard indexes. Apply via existing `db:migrate:staging|production` (already `--remote`-correct). Register in `test/apply-migrations.ts`.

## Open Questions

None — scope and rules come from docs 03/04/05/08 and phase0/register-findings.md; ambiguities (badge gating, prompt CTA, PM identity) resolved above.

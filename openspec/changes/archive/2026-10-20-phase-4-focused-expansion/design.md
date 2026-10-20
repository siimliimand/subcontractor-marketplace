# Design

## Context

Phase 3 left the platform with: one hourly cron (widening + retention) dispatching pure-function jobs; capacity protected by declaration-based DB triggers; append-only `match_weights` with snapshot read-back; register badges in `company_verifications` fed by offline importers; an erasure flow that runs SQL redactions after the main batch (`db.run` is not a batch item); and provider identity consisting only of per-action single-use email tokens — no accounts. Trades are three duplicated code constants (`config.ts`, `ui/types.ts`, `ai/brief.ts`). Workers AI is kept out of the test runtime (vitest-pool-workers pin), so AI-touching modules must take `env.AI` and be tested with stubs.

Partners (PM-side design partners) currently exist only as free-text `requests.pmName` — monetization gating needs a real partner entity.

## Goals / Non-Goals

**Goals:**
- All six tracks shippable and testable now; demand-gated tracks switchable by env var + data, not redeploy.
- Calendar data strengthens booking safety without weakening the existing declaration triggers.
- Reliability signals are explainable, sample-size-honest, and never punish new providers.
- Adding a trade/region is a data change; provider identity scales to teams; governance covers every new artifact.

**Non-Goals:**
- No OAuth calendar integration (ICS secret links only), no payment processor, no Smart-ID.
- No per-event calendar display (only busy/free), no two-party reviews (staff-author only for now).
- No planner auto-execution; no ML training — Workers AI inference only.
- No provider-facing self-serve UI beyond what token links already provide (provider user console is read/react via existing route shapes).

## Decisions

**D1 — One cron, three jobs.** The `scheduled` handler dispatches widening, retention, and a new calendar-fetch job (skipped when `CALENDAR_FETCH_ENABLED=false`). Parsing/expansion lives in `src/worker/calendar/ics.ts` as pure functions (text in → intervals out) for direct testing, mirroring `cron/widening.ts`.

**D2 — Minimal hand-rolled ICS parser.** No npm dependency (Workers-friendly, tiny surface): parse `VEVENT` with `DTSTART`/`DTEND` (floating times treated as UTC/Europe-Tallinn naive per feed note), all-day `VALUE=DATE`, and bounded `RRULE` expansion for `FREQ=DAILY|WEEKLY` with `COUNT`/`UNTIL`, clipped to a 90-day forward window. Other RRULEs and unparseable events increment `unparsedCount` on the feed — visible, never fatal. Rationale: RRULE libraries are heavy for two frequencies; correct-by-omission beats incorrect expansion.

**D3 — Feed URLs are secrets.** Stored in D1 (needed to fetch); API responses mask to `…<last-8-chars>`; structured logs carry `feedId` only; audit events reference `feedId`. No encryption-at-rest beyond D1's disk (consistent with token hashes precedent) — the invariant is "never rendered, never logged".

**D4 — Busy wins, checked at the route layer.** Booking create/confirm/reschedule and widening candidate filtering reject ranges overlapping stored intervals with a distinct `calendar_conflict` reason. No DB trigger (unlike declarations): intervals are advisory derived data refreshed hourly; the declaration triggers remain the hard invariant. Stale feeds keep blocking (conservative) and are flagged; the retention job purges intervals stale beyond `CALENDAR_PURGE_DAYS` (default 14) and keeps the feed row.

**D5 — Reliability computed on read.** Pure function `src/worker/reliability.ts` aggregates responses/outreach (response rate, median first-response hours) + bookings (completion rate, excluding customer-caused cancellations) + undisputed reviews (average). No snapshot table — pilot-scale data makes on-read cheap and always-current. Minimum samples (5/5/3/3) as named constants from details/05. Confidence indicator = sample-band label, not fake statistics.

**D6 — Established badge in the existing badge pipeline.** `verification.ts` gains a platform-history badge computed from bookings (`outcome = completion_confirmed` count ≥ 3) — same `badgeShows` gate and display surfaces as register badges; no new table.

**D7 — Reliability joins weights append-only.** New weights row kind `reliability` in `match_weights` (version bump). Scoring adds the component only when samples suffice; otherwise neutral (factor omitted). Read-back shows component + sample sizes; stored snapshots keep old explanations stable.

**D8 — Catalog tables + TTL cache.** `trades` (slug, label, pilotMinimum, active) seeded with the six pilot trades; `regions` (slug, name, active); `service_regions` (companyId, regionSlug, unique). `src/worker/catalog.ts` reads with a 60s in-memory cache. `PILOT_TRADES` remains solely as the seed source and empty-catalog fallback; `ui/types.ts` fetches from the API; `brief.ts` validates against the catalog. Deactivation = `active=false` (history untouched).

**D9 — Real partner entity for monetization.** New `partners` (id, name, unique slug) + `requests.partnerId` (nullable FK) + `pilot_agreements` (partnerId, plan, monthlyEur, startsAt, endsAt, status, notes). Keying by slugified `pmName` was rejected as fragile; staff create partners and attach requests. Gating: when `MONETIZATION_PILOT_ENABLED=true`, booking mutations on requests whose partner lacks an active agreement return a gated payload (read-only + upgrade prompt) and emit `pilot_gate_blocked`; flag off = zero behaviour change. No payment processor — agreements are hand-billed records.

**D10 — Provider accounts via tokens, sessions via HMAC cookie.** `provider_users` (companyId, unique email, role owner|coordinator, status invited|active|disabled, invitedBy, lastLoginAt). Invites and logins reuse the `email_tokens` table with new purposes `provider_invite`/`provider_login` (same hashing, single-use, expiry). Session = HMAC-signed cookie (env `PROVIDER_SESSION_SECRET`, 12h) carrying userId+companyId — no password storage anywhere. Route middleware `requireProviderUser` scopes every query by companyId and gates owner-only actions; cross-company reads return 404-shape (indistinguishable from missing). Suppression list applies to invite mail.

**D11 — Planner: env.AI + grounded prompt, flag-gated.** `project_plans` stores plan JSON, model id, prompt hash, feedback. Prompt = approved request facts + aggregated historical stats (per-trade median team size/duration from bookings) — never raw personal data. `PLANNER_AI_ENABLED` default false; no comparable history → explicit "insufficient grounding" response. Tests stub `env.AI`; binding wiring stays out of the vitest runtime per phase-3 practice.

**D12 — Audit export as streamed CSV.** Filters: date range (required, capped span), optional companyId/action; ReadableStream with a row cap (50k) and truncation marker; emits `audit_exported` with the filter parameters.

**D13 — Erasure and retention extend in place.** The erase flow's post-batch phase (phase-3 pattern) additionally deletes feeds + intervals + provider users, and redacts review text while removing the review's metric contribution. Retention job gains the interval purge (D4). No new retention table.

**D14 — Migration `0007_phase4_expansion.sql`.** Ten tables/column additions listed in the proposal; indexes: busy intervals `(companyId, startTs)`, `service_regions` unique `(companyId, regionSlug)`, `provider_users` unique email, `booking_reviews` unique bookingId, `project_plans` `(requestId)`. Registered in `test/apply-migrations.ts` (phase-3 lesson: every new migration must be added there).

## Risks / Trade-offs

- **ICS parser edge cases** (timezone variants, exotic RRULEs) → bounded expansion + `unparsedCount` + failed fetches keep last-good intervals; worst case equals today's behaviour (declarations only).
- **Route-layer calendar check has a race window** against hourly-stale intervals → accepted: declarations remain the hard invariant; calendar is a best-effort stronger signal, and confirm-time re-check bounds exposure.
- **Provider sessions are a new auth surface** → HMAC cookie with short expiry, tokens stay single-use, generic errors, audit on lifecycle; no passwords to leak.
- **On-read reliability aggregates grow with data** → fine at pilot scale; if slow, snapshot per company is an additive later change (spec doesn't change).
- **Two flags default off** (planner, monetization) → shipping inert code paths; tests cover both flag states so enablement is a config change with known behaviour.
- **Migration size** (10 tables) → single migration keeps apply-migrations registry simple; all seeds idempotent.

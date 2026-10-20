# Design

## Context

Phase 1 shipped the cockpit (providers, requests, manual outreach log, effort, dashboard) and the email pipeline (tokens, batch send, lifecycle events, suppressions) — 69 integration tests, migrations `0000`–`0002`. Everything operational is staff-logged; the system itself makes no decisions. Phase 2 adds the decision layer: multi-trade requests, matching, capacity tracking, DB-enforced booking, and the AI brief builder. Hard constraints: Cloudflare-only (Workers AI for LLM), D1 (SQLite semantics), EU residency, immutable audit/funnel events on every mutation.

Note: the ERD's "migration 0002/0003" numbering predates the email pipeline; the actual next migrations are **0003** (multi-trade + availability + match factors) and **0004** (holds + booking conflict enforcement).

## Goals / Non-Goals

**Goals:**
- Matching v1 is deterministic, explainable, and computed only from data that exists.
- First-confirmed-wins survives concurrent confirmation attempts (DB-level, not app-level).
- Multi-trade requests without breaking existing single-trade flows or the 69 existing tests.
- AI brief builder with a strict approval gate; unapproved drafts are inert.
- Every new mutation writes funnel/audit events (`brief_approved`, `booking_requested`, `work_started` added).

**Non-Goals:**
- Calendar sync, verification badges, ranking tuning from real outcomes (Phase 3/4).
- Review quality data (no reviews exist in Phase 2 — factor always scores 0/missing).
- Provider-facing self-service UI (cockpit remains staff-operated).
- Cron-driven outreach widening (widening stays a staff-triggered action with timeout shown in UI).

## Decisions

### D1 — Multi-trade via relation table, primary trade kept
`requests.trade` stays NOT NULL as the **primary trade**; new `request_trades(requestId, trade, isPrimary)` M:N holds the full set, backfilled from `requests.trade` in migration 0003. API/UI accept `trades: string[]` (≥1); first entry is primary and mirrors into `requests.trade`.
*Why not drop `requests.trade`:* keeps every existing query, index and test working; the column is already the lifecycle's join key. Matching, outreach generation and the comparison view iterate `request_trades`.

### D2 — Outreach entries stay per request+provider, gain `trade`
The existing unique `(requestId, companyId)` constraint stays. `outreach_entries` gains `trade`, `matchScore`, `matchFactorsJson` (nullable). A provider matching several trades gets one entry recording its **best-ranked trade** — one contact per provider per request still holds (matches the outreach-log spec guard and avoids duplicate emails). Channel value `matching` distinguishes generated entries from `manual`.

### D3 — Matching is a pure TypeScript module, weights in config
`src/worker/matching/` with `selectCandidates()` and `rank()`. Hard filters: active status, offers trade, service-area match, availability (declarations are a bonus, not a filter — unknown availability ranks 0 on capacity but stays eligible, per spec). Weights (25/20/15/15/10/10/5) live in `matching/weights.ts`; each factor returns `{ value, weighted, missing, inputs }`. Factor inputs:
- **Confirmed capacity** — sum of fresh (non-expired) declaration workers for trade ∩ request dates; 0 if none.
- **Specialisation depth** — service skill count + `isPrimaryTrade` on the service.
- **Response history** — response rate and median response time from past outreach/responses.
- **Reliability** — `completion_confirmed` vs `accepted_but_not_delivered` and provider-attributed cancellations.
- **Proximity** — normalised string containment of request location in service area (free-text matching is the honest Phase 2 limit; documented in UI as heuristic).
- **Review quality** — always missing in Phase 2.
- **Price fit** — parsed budget range vs service pricing approach; missing when either side unparsed.
Diversity rule caps 2 per specialisation (service `isPrimaryTrade` + skill cluster) per initial batch. Batch = top 5 per trade; widening to 10 once, staff-triggered; refused when request is `booked`/`cancelled` (existing guard reused).

### D4 — Availability declarations + freshness helper
`availability_declarations(id, companyId, trade, workersCount, dateFrom, dateTo, channel, lastConfirmedAt, createdBy, createdAt)`. One shared `freshness(lastConfirmedAt)` helper returns `current|aging|stale|expired` (<7/7–14/14–30/>30 d) — single source used by matching, comparison view and provider page. Expired ⇒ treated as no capacity for matching; UI shows "reconfirm required". Providers without fresh declarations or with `email_only` render "Unconfirmed" (existing invariant, now backed by real data).

### D5 — First-confirmed-wins via BEFORE INSERT trigger
SQLite has no exclusion constraints; a partial unique index cannot express date-range overlap. `bookings` gains `trade`; migration 0004 adds a `bookings_no_capacity_overlap` trigger: `BEFORE INSERT ON bookings WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.companyId = NEW.companyId AND b.trade = NEW.trade AND b.startDate <= NEW.endDate AND b.endDate >= NEW.startDate AND b.outcome IS NULL) RAISE(ABORT, 'capacity_conflict')`. App layer catches the abort and returns 409 naming the winning booking; the existing `unique(requestId)` stays. Trade-off: triggers are invisible in Drizzle — the conflict check is duplicated in application code for a friendly error, and the trigger is the last line of defence.

### D6 — Booking request/confirmation split
New `booking_requests(id, requestId, responseId, companyId, trade, startDate, endDate, workersCount, state: requested|confirmed|withdrawn, ...)`; confirmed inserts the `bookings` row (trigger armed) and flips request status to `booked`. Events: `booking_requested` on request, `booking_confirmed` on confirm. `work_started` is an event-only action on `booked` requests (no status change, keeps lifecycle spec stable).

### D7 — Holds table behind `BOOKING_HOLDS_ENABLED`
`holds(id, requestId, companyId, trade, startDate, endDate, workersCount, state: active|expired|superseded|released, expiresAt)`. Flag is a wrangler var per env (default off). Expiry is **lazy**: any read/write over holds first expires `state='active' AND expiresAt < now` in the same batch — no cron needed; a cron sweeper can come later. Confirmation supersedes the request's active hold. The trigger checks active holds as a soft conflict (app-level 409 advising to supersede, not a DB abort — holds are advisory by design).

### D8 — Brief builder: Workers AI with strict JSON validation
Wrangler `"ai": { "binding": "AI" }`. Calls go through `src/worker/ai/brief.ts` using an instruct model (start: `@cf/meta/llama-3.1-8b-instruct`; swappable constant). Prompt demands JSON-only with the fixed field schema; response is parsed, type-validated, and **any field the source text does not support is nulled and flagged missing** — post-validation enforces "never invented" regardless of model behaviour (one retry on malformed JSON, then a 502 telling staff to use the manual form). `brief_proposals(id, requestId nullable, sourceText, proposedJson, finalJson, model, createdBy, ...)` stores proposal vs approved final; approval requires staff edit-confirm and records `brief_approved`, then pre-fills the request form (no auto-create). Tests mock the AI binding at the module boundary — `vitest-pool-workers` AI support is not relied on.

### D9 — Events and dashboard
`EVENT_ACTIONS` gains `brief_approved`, `booking_requested`, `work_started`. Each new mutation writes its event in the same D1 batch as the write (existing pattern). Dashboard overview extends with `booking_requested`→`booking_confirmed` conversion so the funnel has no gaps.

## Risks / Trade-offs

- [Workers AI returns malformed/invented fields] → Strict schema validation, null-and-flag rule, single retry, manual-form fallback; approval gate means nothing distributes automatically.
- [Free-text location matching is weak] → Normalised substring match only; proximity factor marked heuristic in UI; register-quality geocoding deferred.
- [Trigger logic drifts from app logic] → Integration test suite contains a dedicated capacity-conflict suite (including a simulated concurrent confirmation) run in CI against real D1.
- [Backfill errors on 0003] → Backfill runs in one transaction (`INSERT INTO request_trades SELECT ...`); migration applied to staging first and row counts verified before production.
- [Multi-trade widens blast radius on existing flows] → `requests.trade` retained; every existing endpoint keeps accepting single-trade payloads; 69 existing tests must pass unmodified except request-creation payloads where the API adds an optional `trades` array.
- [Holds seen as guaranteed capacity] → Spec keeps holds advisory; UI labels holds as tentative; flag stays off until the e2e hold test passes on staging.

## Migration Plan

1. Ship migration **0003** (request_trades + backfill, availability_declarations, outreach trade/match columns, bookings.trade) behind no flag — additive; deploy worker after.
2. Ship **0004** (booking_requests, holds, overlap trigger) with `BOOKING_HOLDS_ENABLED` unset — trigger active from the start (it only constrains new bookings; existing data has no overlaps by construction).
3. Staging first: `db:migrate:staging` → `deploy:staging` → run the capacity-conflict and brief-builder suites via `npm test` against local D1 plus a staging smoke (create multi-trade request, run matching, request+confirm booking).
4. Rollback: `wrangler rollback -e <env>` reverts the worker; migrations are additive and forward-compatible, no down-migration needed.
5. Production after staging verification: `db:migrate:production` → `deploy:production`.

## Open Questions

- Exact Workers AI model id — confirm availability/quota in the account at implementation time; the wrapper isolates the choice.
- Widening timeout default (proposal: 7 days, env var `OUTREACH_WIDEN_TIMEOUT_DAYS`) — pilot tuning per implementation-plan wk6 note.

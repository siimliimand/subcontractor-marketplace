# Proposal: Phase 2 — Concierge MVP

## Why

Gate 1 conditions are met and Phase 1 shipped the cockpit and email pipeline (staff-log everything, concierge-run). Phase 2 (wks 5–8) turns that manual log into the product: the system itself must select who to contact, track real capacity, guarantee that one booking cannot be double-committed, and draft structured briefs from natural language — so ≥5 real requests can run through the platform with qualified responses in <24 h and at least one confirmed booking (Gate 2).

## What Changes

- **Multi-trade requests (Decision 3):** a request carries a required-trades set (`request_trades` M:N, migration 0002 with backfill from `requests.trade`); matching, outreach and comparison work per trade.
- **Matching v1:** candidate selection via hard filters (trade, service area, availability), transparent weighted ranking (confirmed capacity 25%, specialisation depth 20%, response history 15%, reliability 15%, proximity 10%, review quality 10%, price fit 5% — computed only from data that exists), diversity rule (≤2 per specialisation in a batch), stored match score + factor breakdown on outreach entries for explainability.
- **Availability declarations (migration 0002):** `availability_declarations(companyId, trade, workers, dateFrom, dateTo, channel, lastConfirmedAt)` with freshness states (<7d current, 7–14d aging, 14–30d stale, >30d expired); empty/unknown never shown as confirmed.
- **Booking core (migration 0003):** booking request → confirmation split (`booking_requested` / `booking_confirmed` events), first-confirmed-wins enforced at the database level, 48-hour holds behind a feature flag, cancellation recording with attribution.
- **AI brief builder (P1):** Cloudflare Workers AI drafts a structured request from natural language; missing information is flagged, never invented; PM edits and approves before distribution; proposal-vs-final edit log (splits `brief_approved` from `request_approved`).
- **Response comparison view (P1):** responses per request compared side-by-side, grouped by trade, with availability freshness shown.
- **Analytics completeness:** new funnel events `brief_approved`, `booking_requested`, `work_started` fire from the real UI; existing `request_approved`, `booking_confirmed` unchanged.

## Capabilities

### New Capabilities

- `matching`: Matching v1 — hard filters, weighted ranking with explainability, diversity rule, batch generation (top 5, widen toward 10 on timeout), stop-on-fill/cancel.
- `booking-core`: Availability declarations (workers per trade per day + freshness), booking request → confirmation, first-confirmed-wins at DB level, 48 h holds behind flag, cancellation with attribution.
- `brief-builder`: AI-assisted structured brief drafting with flagged gaps, PM edit + approval gate, proposal-vs-final logging.

### Modified Capabilities

- `request-administration`: requests carry a required-trades set instead of a single trade; `work_started` recorded on booking; response comparison grouped by trade.
- `outreach-log`: entries may be created automatically by a matching run (not only by staff) and carry match score + factor breakdown.

## Impact

- **Schema:** migrations 0002 (multi-trade + availability + match factors) and 0003 (holds + first-confirmed-wins constraint) on the cockpit D1 database.
- **Worker:** new modules `src/worker/matching/`, `src/worker/availability.ts`, `src/worker/holds.ts`, `src/worker/ai/brief.ts`; changes to `routes/requests.ts`, `routes/outreach.ts`, `lifecycle.ts`, `events.ts`; new routes for availability, holds, booking request/confirm, brief drafting.
- **UI:** request form (multi-trade + AI draft), request detail (comparison view grouped by trade, availability freshness, hold/booking actions), provider detail (availability declarations).
- **Config:** `wrangler.jsonc` — Workers AI binding, `BOOKING_HOLDS_ENABLED` feature flag.
- **Tests:** new integration suites for matching, availability freshness, hold/first-confirmed-wins races, brief builder guardrails; existing 69 tests updated for multi-trade requests.
- **Constraint:** Cloudflare-only stack unchanged; AI via Workers AI (no external LLM APIs).

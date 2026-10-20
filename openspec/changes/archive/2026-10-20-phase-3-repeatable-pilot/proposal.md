# Proposal

## Why

Phases 1–2 shipped a working concierge pipeline (intake → matching → email outreach → one-click responses → booking) but it still leans on staff: widening is manual, freshness decays silently, availability claims have no register backing, and nothing measures the funnel weekly against the Gate 3 targets. Phase 3 (weeks 9–12) must convert the demo into a repeatable workflow: ≥10 requests, ≥30% booking conversion, ≥50% repeat usage, and visibly declining manual effort per booking (docs/implementation-plan.md, Gate 3).

## What Changes

- **Weekly dashboard completed**: every 08 metric with explicit numerators/denominators — adds availability-confirmation rate, repeat usage, providers-contacted-per-request, cancellations/failed commitments, weekly buckets, renders the existing-but-unshown booking-funnel numbers, plus CSV export for the Monday metrics review.
- **Automated outreach widening**: cron-scheduled widening of a batch from 5 toward 10 after a configurable timeout without a qualified response (today widening is manual-only), with audit trail and single-widen guard.
- **Booking hardening** (per docs/details/03): tentative vs confirmed distinction surfaced end-to-end; reschedule flow (propose → confirm → record) on confirmed bookings; booking-level cancellation with attribution; freshness-driven reconfirmation prompts with one-click staff reconfirm; external-commitment disclaimer in the booking UI ("the platform cannot know about off-system commitments").
- **Verification badges** (per docs/phase0/register-findings.md): "Registered & active" (Äriregister, CC BY 4.0 — cleared) and "Trade notification valid" (MTR/Tarvik open-data XML — built now, display flagged pending the founder's TTJA licence confirmation). Offline import into D1; **no runtime external API calls**.
- **Ranking learning loop + post-hoc explainability**: response/conversion/completion history feeds the `responseHistory` and `reliability` factors from real outcomes; stored `matchFactorsJson` becomes a readable "why this provider ranked here" panel on outreach entries. Never ranks by payment (standing rule).
- **Adoption funnel**: after a successful automated interaction, email-only providers see a signup prompt on the response confirmation page; prompt shown is audited; adoption share (booking-system providers ÷ active providers) lands on the dashboard.
- **Data governance pass (GDPR + reporting P2 + hardening)**: suppression-list management endpoints (manual add/remove with reason), company data-erasure routine (anonymise contact/personal fields, stop all outreach), config-driven retention purge of expired email tokens, performance index review. Basic reporting = the CSV export above.

Out of scope (human/ops track, tracked outside this change): growing supply to 30+ providers, pricing discovery with design partners, concierge step-down, weekly partner check-ins. Also out of scope per 03/05: calendar sync, tax-debt badge (legal gap), Smart-ID, reviews.

## Capabilities

### New Capabilities
- `provider-verification`: register-backed verification badges (existence + trade notification), offline import pipeline, display rules, and licence/attribution constraints.
- `data-governance`: suppression-list management, company data erasure, retention purge of expired tokens, and data-minimisation rules for personal fields.

### Modified Capabilities
- `funnel-dashboard`: adds the remaining 08 metrics (availability confirmation, repeat usage, contact counts, cancellations/failed commitments, weekly buckets), booking-funnel display, and CSV export.
- `matching`: adds timeout-triggered automated widening and the outcome-driven learning loop; adds post-hoc explainability from stored match factors.
- `booking-core`: adds tentative/confirmed distinction, reschedule (propose → confirm → record), booking-level cancellation attribution, reconfirmation prompts, and the external-commitment disclaimer.
- `provider-email-response`: adds the post-response adoption prompt for email-only providers (with audit + suppression of repeat prompts).
- `email-outreach`: adds manual suppression-list management (add/remove/list with reason).
- `outreach-log`: adds the "why this provider ranked here" explainability read-back on matching entries.

## Impact

- **Worker**: new `scheduled` handler (cron trigger) in `src/worker/index.ts`; routes `src/worker/routes/dashboard.ts` (metrics + export), `bookingRequests.ts` (reschedule/cancel/reconfirm), new `src/worker/routes/verification.ts`, `suppression.ts`, `erasure`; matching engine factor inputs; `email/public.ts` (adoption CTA); `email/composer.ts` (no behavioural change, suppression-managed).
- **DB**: migration 0006 — `company_verifications` table, `booking_reschedules` table, `booking_requests.state` gains `declined` (or equivalent), index review for dashboard aggregates; no breaking column changes.
- **UI**: Dashboard (new metric sections + weekly table + CSV link), RequestDetail (reschedule/cancel/reconfirm actions, disclaimer, explainability read-back), ProviderDetail (badges), response confirmation page (signup CTA).
- **Config/wrangler**: cron trigger definition, `WIDENING_TIMEOUT_*` + `RETENTION_*` vars; vitest-pool-workers testing of scheduled logic via direct module invocation.
- **Ops**: import scripts under `scripts/` run via wrangler d1 execute (staff-run, offline); TTJA confirmation follow-up gates badge *display*, not the build.

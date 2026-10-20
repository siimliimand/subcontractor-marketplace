# Proposal

## Why

The pilot has cleared its engineering gates: requests flow end-to-end with declining manual effort, bookings are capacity-safe, badges and governance are live. Phase 4 is "grow only what Gate 3 proved" — six expansion items, each with its own mini-gate (hypothesis → success metric → decision date). This change ships the engineering for all six tracks in one coordinated pass, with the demand-gated tracks behind config flags so operations can switch them on when their gate criteria are met — not on a redeploy.

## What Changes

- **Calendar synchronisation (ICS):** providers can register secret Google/Outlook ICS feed URLs; an hourly fetch turns feed events into busy intervals that block booking requests and widening — calendar conflicts surface explicitly, and stale feeds are flagged rather than silently trusted.
- **Reliability scoring and reviews:** reviews tied to completed bookings only (one per booking, disputable); reliability metrics (response rate, median response time, completion rate, review score) computed from real funnel data and displayed only above the minimum samples defined in details/05, never disadvantaging new providers; a platform-history "Established" badge joins the register badges; reliability enters matching as an explainable factor.
- **Trades and regions catalog:** the six pilot trades move from code constants into a seeded D1 catalog (adding a trade stops requiring a deploy), with per-trade pilot minimums and structured region coverage on providers; requests may declare a region and matching filters by it.
- **Monetization pilot:** hand-billed pilot agreements per design partner gate the booking interface — listing and matching stay free per the fixed rule; gated views are counted so the willingness-to-pay experiment produces funnel evidence.
- **Subcontractor planner AI (flag-gated):** a bounded draft planner turns an approved request into a suggested trade/staffing plan, grounded in the platform's own historical booking data, clearly labelled as a draft, with feedback capture to build the evaluation dataset the plan requires.
- **Multi-user provider accounts and exportable audit trail:** provider companies get named users with roles (owner/coordinator) invited via the existing single-use email-token pattern; staff can export the audit trail as CSV for a date range or company.
- **Governance keeps pace:** erasure extends to every new artifact (feeds, intervals, reviews, provider users), ICS URLs are treated as secrets, and derived calendar data gets a retention rule.

## Capabilities

### New Capabilities
- `calendar-sync`: provider ICS feed management, hourly fetch into busy intervals, conflict surfacing, staleness handling.
- `reliability-reviews`: booking-tied reviews, gated reliability metrics with minimum samples, platform-history badge, explainability read-back.
- `trade-region-catalog`: configurable trade catalog with per-trade minimums, region catalog, provider region coverage.
- `monetization-pilot`: pilot agreements, booking-interface gating for non-agreement partners, experiment metrics.
- `planner-ai`: flag-gated draft trade/staffing plans grounded in historical platform data, with feedback capture.
- `provider-accounts`: multi-user company accounts with roles, email-token invites and login, company-scoped access.

### Modified Capabilities
- `booking-core`: booking request creation, confirmation and widening consult imported busy intervals; conflicts block with an explicit reason.
- `matching`: reliability enters the factor set with sample-size-aware read-back; matching filters by declared region when present.
- `provider-verification`: a platform-history "Established" badge (minimum 3 completed bookings with positive outcomes) joins the register badges.
- `request-administration`: requests may capture an optional region used downstream for matching.
- `staff-access`: staff can export the audit trail (CSV) for a date range and/or company; exports are themselves audit-logged.
- `data-governance`: erasure and minimisation cover the new artifacts; calendar feeds hold secret URLs with masked display; stale feed data is purged.

## Impact

- **Migration `0007_phase4_expansion.sql`:** `trades`, `regions`, `service_regions`, `calendar_feeds`, `calendar_busy_intervals`, `booking_reviews`, `pilot_agreements`, `provider_users`, `project_plans`, `requests.region`, new indexes; seeds the six pilot trades; new capacity check on bookings must respect ICS intervals in application logic (no new trigger — intervals are advisory-block at the route layer, unlike declaration holds).
- **Cron:** the single hourly scheduled handler gains an ICS fetch job (pure parser functions, per-feed error backoff) alongside widening and retention.
- **Routes:** new `calendar.ts`, `reviews.ts` (inside providers), `pilot.ts`, `planner.ts`, `providerUsers.ts`, `auditExport` inside dashboard/admin; extensions to `bookingRequests.ts`, `matching.ts`, `providers.ts`, `requests.ts`.
- **Bindings/env:** Workers AI binding for planner (kept out of the vitest-pool-workers test path per phase-3 practice — module receives `env.AI`, tests stub it); new vars `PLANNER_AI_ENABLED` (default false), `MONETIZATION_PILOT_ENABLED` (default false), `CALENDAR_FETCH_ENABLED` (default true), `CALENDAR_STALE_DAYS` (default 3), `MAX_FEEDS_PER_COMPANY` (default 3).
- **Config:** `PILOT_TRADES` becomes fallback when the catalog is empty; `TRADE_PILOT_MINIMUMS` moves into the catalog; duplicated trade lists in `src/ui/types.ts` and `src/worker/ai/brief.ts` read from the API/catalog.
- **New audit events:** calendar feed and provider-user lifecycle, review submit/dispute, pilot agreement changes, planner generate/feedback, audit export.
- **Tests:** parser and metric pure functions get direct unit tests; flag-gated paths tested with bindings stubbed, matching phase-3 practice.

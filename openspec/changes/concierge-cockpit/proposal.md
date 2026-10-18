## Why

The 12-week pilot is run concierge-style: the team, not the product, clarifies briefs, contacts providers and records outcomes. Without a purpose-built internal tool this work happens in inboxes and spreadsheets, and the pilot's most important evidence — qualified-response rates, manual hours per request, funnel conversion — cannot be measured (the metrics gates in `docs/details/08-metrics-and-pilot-gates.md` require it). The cockpit is also the fastest path to first real requests: staff operate the workflow on behalf of design partners before any customer-facing UI exists (implementation plan, Phase 1 week 2).

## What Changes

- New internal web application ("concierge cockpit") for staff, with role-gated access.
- Provider administration: create and update provider companies and their services (trade, skills, service area, pricing approach and pricing model), manage contact details and active/opt-out status.
- Request administration: create structured requests on behalf of PMs, drive the request lifecycle (draft → approved → matched → outreach → responses → booked → closed/cancelled), record provider responses (interest, capacity declaration, decline) and outcomes.
- Outreach logging: record which providers were contacted per request, in which batch, with timestamps — the foundation the automated outreach engine will later reuse.
- Manual-effort tracking: every cockpit action is stored as an audit/funnel event with actor, timestamp and a manual-vs-automated flag; per-request manual hours become queryable.
- Funnel dashboard v0: read-only views over the event log answering the pilot's weekly dashboard questions (request success, time to response, conversion, effort).

## Capabilities

### New Capabilities

- `staff-access`: Authentication and role-based access for internal staff users; only staff can reach the cockpit. Managed auth service, staff membership via allowlist.
- `provider-administration`: Staff-side lifecycle of provider companies and their services — create, update, deactivate, mark willing/opted-out; validation of trade, service area and pricing model data.
- `request-administration`: Staff-side lifecycle of subcontractor requests — creation on behalf of a PM, structured brief fields, status transitions, recording provider responses with capacity declarations, outcomes and cancellations.
- `outreach-log`: First-class record of provider outreach per request — batch number, recipients, send/expiry timestamps, throttling context, stop-on-fill. Feeds later automation; notification fatigue rules depend on it.
- `effort-tracking`: Audit and funnel event capture for every cockpit action with actor, timestamp and manual/automated classification; immutable event log; per-request effort rollups.
- `funnel-dashboard`: Read-only internal views over the funnel event log: request success rate, time to first qualified response, booking conversion, manual effort per request, active supply by trade.

### Modified Capabilities

(none — greenfield; no specs exist yet)

## Impact

- **Codebase:** greenfield — this change establishes the repository skeleton (React frontend + Hono API on Cloudflare Workers, D1 database), the first database migrations (Company, User, Service, Request, Match, Outreach, Response, Booking, audit event entities), and the CI/deploy baseline.
- **Dependencies:** Cloudflare only — Workers (app hosting), D1 (SQLite database), Cloudflare Access (staff authentication), Static Assets (frontend). No external services permitted (hard project constraint). No email sending yet (one-click response emails are a separate change); no AI.
- **Platform constraint:** the whole project MUST run on Cloudflare services with no external vendors. This supersedes earlier vendor examples in the planning docs (Auth0/Supabase/Postmark/OpenAI); those docs are being updated. See design.md decisions.
- **Analytics:** defines the funnel event schema used by every later feature; getting names/fields wrong here is expensive to fix after pilot data exists.
- **Downstream:** provider profiles UI, request form, matching, booking and email-response changes will all build on entities and event conventions introduced here.

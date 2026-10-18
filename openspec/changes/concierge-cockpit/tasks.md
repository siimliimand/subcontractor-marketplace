## 1. Project and Cloudflare setup

- [x] 1.1 Initialise git repository and commit existing `docs/`, `openspec/`, `.opencode/`
- [x] 1.2 Scaffold Worker project: Hono + TypeScript + Vite React app served via Static Assets; `wrangler.jsonc` with `staging` and `production` environments
- [x] 1.3 Create staging and production D1 databases with EU location hint; wire bindings per environment
- [x] 1.4 Deploy hello-world to staging and production via `wrangler deploy`; verify rollback works once

## 2. Cloudflare Access (staff authentication)

- [ ] 2.1 Create Access application + policy for the team on staging; verify a login round-trip before app integration
- [x] 2.2 Implement JWT validation middleware: verify `Cf-Access-Jwt-Assertion` signature against the Access domain and audience; reject everything else with 403 and no data
- [x] 2.3 Implement staff user auto-provisioning: map JWT email to `users` row (role `staff`), reuse on repeat login, record `login` and `access_denied` audit events
- [x] 2.4 Add integration tests: valid token passes, missing/invalid token gets 403, non-staff email gets 403

## 3. Data model and event infrastructure

- [x] 3.1 Define Drizzle schema: users, companies (providers), services, requests, responses, bookings, outreach_entries, audit_events, time_entries — UUIDv4 text PKs, UTC ISO-8601 timestamps
- [x] 3.2 Generate and apply initial migration to staging D1; verify tables and constraints
- [x] 3.3 Implement append-only event helper: fixed action-name enum, `channel` defaulting to `manual`, written in the same D1 batch as the mutation; unknown action names throw before any write
- [x] 3.4 Seed/config: configured trades list (six pilot trades), pricing-model enum (`hour`, `m2`, `project`)

## 4. Provider administration

- [ ] 4.1 API: create provider (legal name, registration identifier unique, contact email required), list/search/filter by trade, status, service area
- [ ] 4.2 API: services CRUD with trade/pricing-model validation; status lifecycle (`active`/`inactive`/`opted_out`) with timestamp + reason; `opted_out` blocks future outreach
- [ ] 4.3 UI: provider list, provider detail with services, create/edit forms
- [ ] 4.4 Events: `provider_created`, `provider_updated` written via the event helper; tests for uniqueness and validation errors

## 5. Request administration

- [ ] 5.1 API: create request on behalf of a PM (required: title, description, location, trade, start date, crew size; optional: budget, duration, notes), status `draft`
- [ ] 5.2 API: enforced state machine `draft → approved → matched → in_outreach → responded → booked → closed` (+ `cancelled` with customer/provider attribution and reason); invalid transitions rejected
- [ ] 5.3 API: record responses (`interest`/`quote`/`decline` + reason), with capacity declaration (workers count, available-from date); decline requires reason
- [ ] 5.4 API: booking confirmation from a response (date range + capacity) sets `booked`; second confirmation rejected (first confirmed wins)
- [ ] 5.5 API: outcomes (`completion_confirmed`, `accepted_but_not_delivered`) and cancellation with attribution
- [ ] 5.6 UI: request list, request detail with chronological history (events, outreach, responses, booking, outcome), create/approve/respond/book/cancel actions
- [ ] 5.7 Events: `request_created`, `request_approved`, `matched`, `response_received`, `qualified_response`, `quote_submitted`, `booking_confirmed`, `completion_confirmed`, `accepted_but_not_delivered`, `request_cancelled`; atomicity test (failed mutation writes neither data nor event)

## 6. Outreach log

- [ ] 6.1 API: log outreach batch (shared batch number) with per-provider entries (contacted-by, channel `manual`, sent-at, notes); reject duplicate provider-request pairs; reject opted-out providers; reject after `booked`/`cancelled`
- [ ] 6.2 UI: outreach panel on request detail; batch creation form with validation feedback per provider
- [ ] 6.3 Events: `outreach_sent` per entry; tests for duplicate/opt-out/closed-request rejections

## 7. Effort tracking

- [ ] 7.1 API + UI: manual time entries per request (minutes, staff, note)
- [ ] 7.2 API: per-request rollup — total minutes and count of manual audit events
- [ ] 7.3 Test: append-only guarantee — no update/delete path exists for audit events

## 8. Funnel dashboard

- [ ] 8.1 Overview queries: eligible requests, qualified-response-within-24h rate, median time to first qualified response (business hours, Europe/Tallinn), booking conversion — computed from audit events
- [ ] 8.2 Denominator rules encoded: customer-cancelled excluded from success rate, open requests excluded from conversion, automated responses excluded from time-to-response
- [ ] 8.3 Supply view: active providers by trade with per-trade pilot minimums marked met/unmet
- [ ] 8.4 Effort view: minutes + interventions per request and weekly trend
- [ ] 8.5 UI: read-only dashboard pages with numerators/denominators shown; verify against seeded sample data

## 9. Production rollout

- [ ] 9.1 Create production D1, apply migrations; configure production Access application + policy
- [ ] 9.2 Deploy production; verify end-to-end: login, create provider, create request, outreach, response, booking, dashboard
- [ ] 9.3 Secrets audit (`wrangler secret put` only; nothing committed), Access policy verified on staging before production switch
- [ ] 9.4 Update `docs/implementation-plan.md` Phase 1 checklist and project README with run instructions

# 0.5 — Analytics Event Schema & Tracking Plan

**Status:** Approved-by-construction — this documents what is live in the cockpit
(`src/worker/events.ts`) and what the remaining phases must add. Per plan §0.5 the schema
existed before customer-facing product code.

## Store decision

**D1 `audit_events` (EU) is the analytics store for the pilot.** Rationale: every event
is already written in the same D1 batch as its mutation (atomicity — no funnel gaps from
crashed writes); dashboard queries run against it directly (overview / supply / effort
views are live); volume at pilot scale (≤10 requests/wk) is trivial. **Revisit only if**
cross-request analytics outgrow SQL (expected: post-pilot). No third-party analytics.

## Event envelope (all events)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `occurredAt` | ISO-8601 UTC | |
| `action` | enum (below) | fixed, extend-only |
| `entity` | `'request' \| 'provider' \| 'auth' \| …` | |
| `entityId` | uuid | |
| `actorEmail` | string \| null | staff actor; null for system |
| `channel` | `'manual' \| 'automated'` | **the concierge-effort signal** |
| `payloadJson` | json \| null | free-form, e.g. `{batch, providersCount}` |

Rules: append-only (no UPDATE/DELETE — GDPR retention handled at the audit table level,
see 0.2b §4); every mutation writes its event **in the same transaction**; new actions
may be appended to `EVENT_ACTIONS` but never renamed (dashboards key on them).

## Funnel mapping: planned 13 events vs implemented

| # | Planned event (details/06) | Implemented action | Trigger | Phase |
|---|---|---|---|---|
| 1 | `request_created` | `request_created` | staff creates draft request | ✅ live |
| 2 | `brief_approved` | `brief_approved` | PM approves the AI-drafted brief in the brief builder (entity `brief`; `request_approved` remains the separate request-approval event) | ✅ live |
| 3 | `matched` | `matched` | approval → eligible providers selected | ✅ live |
| 4 | `outreach_sent` | `outreach_sent` | batch sent (payload: batch id, count) | ✅ live |
| 5 | `email_opened` | `email_opened` | open-tracking pixel on the public response link (automated channel) | ✅ live |
| 6 | `response_received` | `response_received` | any provider response | ✅ live |
| 7 | `qualified_response` | `qualified_response` | interest/quote + capacity + dates | ✅ live |
| 8 | `quote_submitted` | `quote_submitted` | response type = quote | ✅ live |
| 9 | `booking_requested` | `booking_requested` | provider proposes a booking from the provider portal (`booking_confirmed` remains the separate PM-acceptance event) | ✅ live |
| 10 | `booking_confirmed` | `booking_confirmed` | PM accepts provider confirmation | ✅ live |
| 11 | `work_started` | `work_started` | provider marks work started on a booked request | ✅ live |
| 12 | `completion_confirmed` | `completion_confirmed` | outcome recorded | ✅ live |
| 13 | `review_submitted` | `review_submitted` | review tied to a completed booking is submitted | ✅ live |

Rows 2, 5, 9, 11 and 13 re-verified live in the shipped code 2026-11-03; each write path is covered by the integration suite.

### Email delivery lifecycle events (SUBC-011, 2026-11-03)

`email_sent` / `email_delivered` / `email_bounced` / `email_opened` (entity
`outreach_entry`) carry the full delivery state machine. Since Cloudflare Email Service
has no lifecycle-event → Queue routing, lifecycle signals enter through **four
producers**, all feeding one idempotent applier — the `source` field in each audit
payload records which:

| `source` | Producer | Latency |
|---|---|---|
| `queue` | Queue consumer `email()` (dormant until Cloudflare ships routing; kept wired) | push |
| `webhook` | `POST /hooks/email-events` (bearer secret, fail-closed; manual ops / future provider routing) | push |
| `inbound` | RFC 3464 DSN bounce parsed from Email Routing inbound mail (explicit failures only) | push |
| `resolution` | 5-minute cron sweep settling stale `sent` entries (default window 10 min) | ≤ ~15 min |

**Inferred-delivery marker:** `resolution`-sourced `email_delivered` events carry
`payload.inferred: true` (+ `reason: "resolution_window_elapsed"`, `resolveAfterMinutes`)
so timeout-settled deliveries stay distinguishable from provider-confirmed ones in
dashboard queries. Transition rules: `bounced` wins over every earlier state (including
inferred delivery) and suppresses the address; `skipped`/`bounced` are terminal; a late
`delivered` never downgrades `opened`. The pixel (`email_opened`) upgrades the entry
status to `opened` from `sent`/`delivered` only.

Supporting events (not funnel steps, needed for denominators/ops): `request_updated`,
`request_cancelled` (payload: cancelledBy + reason — feeds the customer-cancelled
exclusion in metrics), `provider_created`, `provider_updated`, `login`, `access_denied`,
`accepted_but_not_delivered` (reliability metric from day one, per details/08).

## Metric derivations (denominators per details/08)

- **Request success** = eligible requests (reached `request_approved`, minus
  customer-cancelled) with a `qualified_response` ≤24 h after approval → dashboard
  overview query
- **Median time to first qualified response** = business-hours median of
  `request_approved.occurredAt → qualified_response.occurredAt` (Europe/Tallinn, 9–17,
  Mon–Fri)
- **Booking conversion** = `booking_confirmed` ÷ eligible non-open requests
- **Manual effort per request** = Σ `time_entries.minutes` + count of
  `channel='manual'` events per request; weekly trend = same by ISO week
- **Reliability** = `accepted_but_not_delivered` ÷ `booking_confirmed`
- **Supply** = active services joined to active companies grouped by trade vs pilot
  minimums (6/5/4/5/4/6)

## Cross-cutting rule (from implementation plan)

A feature is **not done** until its funnel events fire from the real UI. Verification =
dashboard query returns non-zero for the new action after a manual e2e run (this is how
the cockpit phase was accepted).

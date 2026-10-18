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
| 2 | `brief_approved` | *(none — merged into)* `request_approved` | approval gate = brief approval in concierge flow; split into two events when the PM-facing brief builder ships so "AI proposal → PM edit → approve" is measurable | ✅ live (merged) / split in Phase 2 |
| 3 | `matched` | `matched` | approval → eligible providers selected | ✅ live |
| 4 | `outreach_sent` | `outreach_sent` | batch sent (payload: batch id, count) | ✅ live |
| 5 | `email_opened` | *(pending)* | open-tracking pixel, automated channel | Phase 1 wk3 (email pipeline) |
| 6 | `response_received` | `response_received` | any provider response | ✅ live |
| 7 | `qualified_response` | `qualified_response` | interest/quote + capacity + dates | ✅ live |
| 8 | `quote_submitted` | `quote_submitted` | response type = quote | ✅ live |
| 9 | `booking_requested` | *(none — concierge merges into)* `booking_confirmed` | split when PM self-service booking ships | Phase 2 |
| 10 | `booking_confirmed` | `booking_confirmed` | PM accepts provider confirmation | ✅ live |
| 11 | `work_started` | *(pending)* | provider/customer marks start | Phase 2 (booking core) |
| 12 | `completion_confirmed` | `completion_confirmed` | outcome recorded | ✅ live |
| 13 | `review_submitted` | *(deferred)* | reviews tied to bookings are Phase 4 | Phase 4 |

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

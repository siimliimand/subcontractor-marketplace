## Why

Cloudflare Email Service has no lifecycle-event → Queue routing (dashboard caveat,
2026-10-18), so the shipped Queue consumer (`src/worker/email/events.ts`) is dormant
with zero producers: every pilot outreach email's `emailStatus` stays `sent` forever,
delivered/opened/bounced never appear in the cockpit, bounces never feed the
suppression list, and bounce rate is unmeasurable. That corrupts the Gate 2 metrics —
"≥70% qualified responses" cannot be trusted if delivery is unverifiable. The
workaround must stay entirely inside the Cloudflare-only hard constraint
(openspec/project.md: no external vendors or APIs).

## What Changes

- **Shared lifecycle applier** — the queue consumer's match+mutate+audit core is
  extracted into `applyEmailLifecycleEvent` with an explicit transition matrix
  (`delivered` only from `sent`; `opened` from `sent`/`delivered`; `bounced` from
  `sent`/`delivered`/`opened` — bounce always wins), guarded in both the match query
  and the UPDATE where-clause so concurrent producers settle each transition exactly
  once (one audit event, one suppression row, one status change)
- **Webhook receiver (new)** — `POST /hooks/email-events`, a public route outside the
  Access guard, authenticated by a bearer shared secret compared in constant time;
  fails closed (401 `email_events_webhook_disabled`) when the secret is unset. This is
  the ingestion path usable today: manual ops during concierge processing, or any
  future provider-side routing
- **Inbound bounce Email Worker (new)** — an `email()` handler parses RFC 3464 DSNs
  delivered by Cloudflare Email Routing (explicit failures only: `Action: failed` or
  `Status: 4.x/5.x`, `Final-Recipient`/`X-Failed-Recipients` for the address;
  auto-replies and human mail are never bounces)
- **Open pixel upgrade** — the tracking pixel now also upgrades the entry's status to
  `opened` (guarded, never downgrading `bounced`/`skipped`), in the same batch as the
  `email_opened` audit event
- **Resolution sweep (new)** — a scheduled sweep settles email-channel entries still
  `sent` after `EMAIL_RESOLVE_AFTER_MINUTES` (default 10) to an explicitly-marked
  *inferred* `delivered` (`payload.inferred: true`); the cron trigger moves from hourly
  to every 5 minutes, with the pre-existing hourly jobs gated on minute 0 so their
  cadence is unchanged
- **Per-provider delivery metrics (new)** — `GET /api/dashboard/email-delivery` returns
  per-provider sent/delivered/opened/bounced/skipped counts, computed bounce rate
  (skipped excluded from the denominator), and the suppression flag; the dashboard
  renders it as the per-provider table in the Email pipeline section

## Capabilities

### Modified Capabilities
- `email-outreach`: the "Delivery lifecycle recorded" requirement is amended — lifecycle
  events may arrive via the configured Queue, the authenticated webhook, or inbound DSN
  parsing, all through the same idempotent state machine; stale `sent` entries resolve
  to inferred `delivered` after the window; the open pixel upgrades the entry status

## Impact

- **Worker**: `src/worker/email/` gains `webhook.ts`, `inbound.ts`, `resolve.ts`;
  `events.ts` is refactored into the shared applier; `public.ts` pixel upgrades the
  entry; `index.ts` routes `/hooks/*`, adds the `email()` handler, and sweeps on every
  scheduled tick
- **Config**: `wrangler.jsonc` cron → `*/5 * * * *`; `EMAIL_RESOLVE_AFTER_MINUTES: "10"`
  in staging + production vars; new secret `EMAIL_EVENTS_WEBHOOK_SECRET` per
  environment; Email Routing dashboard setup for the bounce path (documented,
  post-deploy operator step)
- **Schema**: none (no migration — reuses `outreach_entries.emailStatus`,
  `email_suppressions`, and the extend-only `EVENT_ACTIONS` with no new action names;
  inferred delivery reuses `email_delivered` with a payload marker)
- **Dashboard UI**: Email pipeline section gains the per-provider table
- **Tests**: five new/extended suites (queue ordering guards, webhook, inbound DSN
  parser matrix, resolution sweep + cadence gating, per-provider metrics) plus the
  symptom acceptance file `test/email-delivery-symptom.test.ts` — all in `npm test`

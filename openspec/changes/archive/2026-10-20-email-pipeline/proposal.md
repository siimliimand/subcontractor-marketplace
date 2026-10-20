## Why

The cockpit logs every outreach step manually — a human emails providers by hand and
types their answers back in. That does not scale past the first few pilot requests, and
it makes the response-time metrics (median < 4 business hours, ≥70% within 24 h — the
Gate 2 criteria) measurements of the operator rather than of the marketplace. The email
pipeline is the Phase 1 week 3 deliverable: it lets providers respond to real requests
with one click, no account, while keeping every funnel event measurable.

## What Changes

- **Outreach emails via Cloudflare Email Service**: sending a cockpit outreach batch now
  sends real emails from a verified sending subdomain; manual phone/other outreach
  remains loggable as before
- **One-click provider responses**: Accept / Quote / Decline links with secure
  single-use expiring tokens; the landing flow collects the capacity declaration
  (how many people, from what date) and writes real funnel events
  (`response_received`, `qualified_response`, `quote_submitted`, `request_cancelled`
  on decline) with `channel='automated'`
- **Delivery lifecycle tracking**: message delivered/bounced events consumed via
  Queues → audit events; bounces feed a suppression list (providers are not re-emailed
  after a hard bounce)
- **Open tracking**: self-hosted 1×1 pixel on Workers records `email_opened`
- **Public (unauthenticated) routes**: token landing pages and pixel are the first
  non-Access routes in the app — served by the same Worker, outside the Access guard
- **New audit events**: `email_sent`, `email_delivered`, `email_bounced`, `email_opened`
  (extend-only enum change); dashboards learn the automated-response share
- **No changes** to the request state machine, provider model, or Access-authed cockpit
  APIs — the pipeline hangs off existing `outreach_entries`

## Capabilities

### New Capabilities
- `email-outreach`: sending outreach emails for a batch via Email Service with
  suppression, lifecycle events (sent/delivered/bounced/opened) and warm-up-friendly
  throttling
- `provider-email-response`: single-use expiring token links (Accept / Quote / Decline),
  public landing + submit flow collecting the capacity declaration, opt-out handling,
  first-confirmed-wins safety (a declined/expired token can never confirm anything)

### Modified Capabilities
- `outreach-log`: outreach entries gain `channel='email'` + delivery lifecycle states;
  the "which providers were contacted" record now includes email delivery outcomes
- `request-administration`: responses arriving via email tokens enter the same response
  model and state machine as manually recorded responses (no state-machine change, but
  the spec now requires that automated responses are attributable and deduplicated)
- `staff-access`: the public token routes are explicitly outside the Access guard and
  must never expose request/provider data beyond the minimal brief already sent by email

## Impact

- **Worker**: new public route namespace (`/e/*`, `/t/*`), Queue consumer for Email
  Service lifecycle events, email-sending service module, token service (HMAC +
  D1-backed single-use registry)
- **Schema**: migration 0002 — `email_tokens` (jti, outreachEntryId, purpose, expiry,
  usedAt), `email_suppressions(email)`; enum extension in `EVENT_ACTIONS`
- **Config**: `wrangler.jsonc` — Email Service send binding, Queue consumer binding,
  new secrets (`EMAIL_TOKEN_SECRET`, sending address); Email Service domain verification
  in the Cloudflare dashboard (one-off, manual step)
- **Cockpit UI**: RequestDetail outreach panel gains "Send batch email" action + delivery
  status column; dashboard overview gains automated-vs-manual response split
- **Tests**: vitest-pool-workers with a stubbed send binding; token security tests;
  queue-event handler tests
- **Dependencies**: none outside Cloudflare (per hard constraint); Email Service domain
  onboarding lead time is the schedule risk (warm-up per implementation plan)

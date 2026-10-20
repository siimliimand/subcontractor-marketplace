## Context

The cockpit (live on Workers + D1 + Access) records outreach manually. Phase 1 week 3
adds the email pipeline per the implementation plan and details/06: Cloudflare Email
Service for sending, Queues for lifecycle events, self-hosted open tracking. Everything
hangs off the existing `outreach_entries` model (first-class entity with batches,
duplicate/opt-out rejection). Constraints: Cloudflare-only, EU residency, no customer
accounts for providers during the pilot, email = the adoption funnel (details/03).

## Goals / Non-Goals

**Goals:**
- One-click Accept / Quote / Decline from email, no login, single-use expiring tokens
- Full funnel events from automated responses with the same integrity guarantees as
  manual recording (same D1 batch, same state machine)
- Delivery lifecycle visible in the cockpit (sent → delivered/bounced → opened)
- Suppression safety: never re-email a hard-bounced address; never email opted-out
  providers (existing check, now enforced on the automated path too)
- Domain warm-up friendly: daily volume cap behind config, start tiny, ramp

**Non-Goals:**
- Provider accounts / booking-system calendar UI (Phase 2–3 adoption funnel)
- Reply-to-conversation threading (inbound email parsing) — one-click links only
- HTML email design work beyond a clean minimal template
- Marketing/bulk features, A/B testing, engagement scoring
- Smart-ID or any strong provider identity (deferred per register findings)

## Decisions

### D1 — Sending: Email Service `send()` binding from the Worker, not REST
The binding avoids managing API keys, inherits the Worker's EU placement, and is the
documented path for Workers-native sending. Alternative (REST API) rejected: extra
secret, no benefit. Sending happens **explicitly when staff click "Send batch email"**
in the cockpit — not automatic on match — keeping the human confirm-before-send rule
(plan §5: people always confirm before anything is sent).

### D2 — Tokens: HMAC-signed opaque token, `email_tokens` registry in D1
Token = base64url(payload {jti, outreachEntryId, purpose, exp}) + HMAC-SHA256 tag with
`EMAIL_TOKEN_SECRET` (32-byte secret). Single-use enforced by `usedAt` set in the same
D1 batch as the response write — a replayed token hits a 410 after its first use.
Expiry default 7 days (matches the manual follow-up cadence). Alternatives: JWT (heavier,
no benefit over HMAC+registry), signed URL without registry (cannot enforce single-use).
Threats covered: enumeration (HMAC), replay (usedAt), forwarding (single-use + expiry),
forged decline of another company's request (outreachEntryId binds token → company →
request; response companyId derived server-side, never from user input).

### D3 — Public routes live in the same Worker, explicitly outside Access
`/e/*` (token landing + submit) and `/t/*` (pixel) are mounted before the Access
middleware in `src/worker/index.ts`. They are the only unauthenticated routes; a spec
requirement pins this: they must leak nothing beyond the brief already present in the
email (request title/trade/window/headcount), and 404/410 responses are indistinguishable
between "bad token" and "expired token" to avoid probing. No robots indexing (header +
pixel route is .gif).

### D4 — Lifecycle events via Queues consumer writing audit events
Email Service publishes `message.delivered` / bounces to a Queue; the Worker consumes,
matches SendId/MessageId → outreach entry, appends `email_delivered` / `email_bounced`
audit events. A hard bounce adds the address to `email_suppressions`; the send path
rejects suppressed addresses at batch-send time (visible in the UI as skipped). Pixel:
`GET /t/:token.gif` → 1×1 GIF, records `email_opened` (once per token). Events land in
the existing dashboard; automated-vs-manual split becomes a metric input.

### D5 — Deduplication and state-machine safety
A token response is written through the same `recordResponse` path as manual entry:
rejections (closed request, duplicate response, opted-out company) apply identically and
return a friendly "already recorded" page instead of an error. `request_cancelled` on
Decline carries `cancelledBy='provider'` with attribution — matching the manual flow.

### D6 — Config/throttling for warm-up
`EMAIL_DAILY_LIMIT` (per-worker count via D1 counter on `email_sent` within UTC day;
default 50) hard-stops batch sends beyond the cap with a clear error — protects domain
reputation during the ramp (implementation-plan risk table).

## Risks / Trade-offs

- **Sending-domain reputation starts cold** → warm-up cap + suppressed-address skip +
  monitor bounced/delivered ratio from day one; manual follow-up for non-delivery
- **Email Service is young**; lifecycle events may lag or drop → cockpit shows "sent"
  state even without delivery confirmation; open/delivered are additive, never blocking
- **Pixel blocked by mail clients** → acceptable; `email_opened` is a soft signal,
  success metrics do not depend on it
- **Providers forward the email to a colleague** → single-use token makes one click win;
  second click gets "already recorded"; staff can always record manually as fallback
- **Token secret rotation** → store version byte in token (v1); rotation adds v2 signing
  key while v1 verifies, then retires — designed in from the start
- **Reply confusion** (providers reply by email instead of clicking) → Reply-To is the
  operator's inbox; concierge records the reply manually (existing flow)

## Migration Plan

1. Migration 0002 (`email_tokens`, `email_suppressions`, enum extension) — additive,
   applied `--remote` to staging then production
2. Deploy Worker with public routes mounted but sending disabled until the sending
   subdomain is verified in the dashboard (manual one-off; DNS records + warm-up start)
3. Set secrets (`EMAIL_TOKEN_SECRET`, sending address) via `wrangler secret put` per env
4. Enable the Queue consumer binding after Email Service events flow
5. Rollback: Worker rollback (public routes are harmless without secrets — send returns
   config error, tokens 410); migration is additive, no rollback needed
6. End-to-end verification per environment: send real batch to a test address, click
   Accept, confirm `qualified_response` + dashboard movement (the acceptance pattern
   used for the cockpit)

## Open Questions

- ~~Exact Email Service Queues event names/fields at GA time — implement against the
  documented schema and verify in staging before enabling in production (task-level check)~~
  **Resolved 2026-10-18 (partially):** event routing is not reachable at all yet — the
  Cloudflare dashboard offers no lifecycle-event → Queue routing option for Email Service
  (checked domain settings, Connect tab, account settings). Consumers (`email-events-staging`/
  `email-events-production`) stay dormant; delivery/bounce states remain `sent` until
  Cloudflare ships routing. Schema verification still applies once it exists.
- Whether declining via email should free held capacity immediately — no holds exist
  until Phase 2; re-evaluate with migration 0003

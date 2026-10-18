## 1. Schema and event foundation

- [x] 1.1 Generate migration 0002: `email_tokens` (id, jti unique, outreachEntryId, purpose, expiresAt, usedAt, createdAt) and `email_suppressions` (email unique, reason, createdAt); apply to local D1
- [x] 1.2 Extend `EVENT_ACTIONS` (extend-only) with `email_sent`, `email_delivered`, `email_bounced`, `email_opened`; add `emailStatus` values to outreach status model
- [x] 1.3 Update Drizzle schema for the new tables and outreach email-status column; regenerate types; keep 41 existing tests green

## 2. Token service

- [x] 2.1 Implement token service (`src/worker/email/tokens.ts`): HMAC-SHA256 sign/verify (base64url payload {v, jti, outreachEntryId, purpose, exp}), secret from `EMAIL_TOKEN_SECRET`, version byte for rotation
- [x] 2.2 Single-use redemption: D1 batch marks `usedAt` atomically with the action write; replay → neutral "already recorded" outcome
- [x] 2.3 Unit tests: sign/verify roundtrip, expired token, tampered signature, replay after use, wrong-purpose token — all neutral outcomes, no data leak

## 3. Email sending

- [x] 3.1 Add Email Service send binding + `EMAIL_TOKEN_SECRET`, sending-address config to `wrangler.jsonc` (staging + production) and `.dev.vars.example`; document dashboard domain-verification steps in README
- [x] 3.2 Implement email composer: minimal text/HTML template with brief + three token links, Reply-To operator inbox, ET/EN content
- [x] 3.3 Implement batch send service: iterate eligible entries, skip suppressed/opted-out with per-entry status, write `email_sent` audit event + outreach email status in the same batch as send, enforce `EMAIL_DAILY_LIMIT` from D1 counter
- [x] 3.4 Tests: batch send with stubbed binding (sent/skipped/limit paths), suppression skip, daily-limit rejection, audit events written atomically

## 4. Public routes (no Access)

- [x] 4.1 Mount `/e/*` and `/t/*` before the Access guard in `src/worker/index.ts`; keep all other routes guarded (test: anonymous `/api/*` still denied)
- [x] 4.2 Landing page GET `/e/:token`: valid → brief + capacity form (accept/quote) or decline confirm; invalid/used/expired → indistinguishable neutral page
- [x] 4.3 Submit POST `/e/:token`: server-side attribution from token payload only; accept/quote collect workers + available-from; decline records optional reason; run through existing `recordResponse` rejection rules (closed, duplicate, opted-out) with friendly outcome pages
- [x] 4.4 Tracking pixel GET `/t/:token.gif`: 1×1 GIF, one `email_opened` audit event per token, no-cache headers
- [x] 4.5 Tests: full token lifecycle via fetch mock (accept happy path, decline, closed-request rejection, duplicate, expired, tampered ids ignored, pixel once-only)

## 5. Queue consumer for lifecycle events

- [x] 5.1 Add Queue consumer binding in `wrangler.jsonc`; implement handler matching SendId/MessageId → outreach entry, writing `email_delivered`/`email_bounced` audit events + email status updates
- [x] 5.2 Hard-bounce handling: insert into `email_suppressions` (idempotent); visible status on the outreach entry
- [x] 5.3 Tests: delivered event updates entry; bounce suppresses + marks; unknown id ignored; duplicate event idempotent

## 6. Cockpit UI and dashboard

- [x] 6.1 RequestDetail outreach panel: "Send batch email" action (disabled during send; result summary), email-status column with timestamps
- [x] 6.2 Dashboard overview: automated-vs-manual response split (counts from audit events); keep existing metrics intact
- [x] 6.3 UI tests/updates for changed components; typecheck clean

## 7. Deploy and verify end-to-end

- [x] 7.1 Apply migration 0002 `--remote` to staging and production
- [ ] 7.2 Verify sending subdomain in Cloudflare dashboard (manual: DNS records, SPF/DKIM); start warm-up with low `EMAIL_DAILY_LIMIT`
- [x] 7.3 Set staging secrets (`EMAIL_TOKEN_SECRET`, sending address); deploy staging
- [ ] 7.4 Staging e2e: create provider + request, send batch to a real test address, open pixel, click Accept with capacity → confirm `response_received` + `qualified_response` + `email_opened` in audit events and dashboard movement; decline path on a second provider
- [ ] 7.5 Set production secrets; deploy production; repeat e2e with a production test address
- [ ] 7.6 Update README (email setup, secrets, warm-up procedure) and mark implementation-plan Phase 1 wk3 item done

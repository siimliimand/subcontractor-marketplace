## Context

The Email Service lifecycle Queue (email-events-staging/production) exists and the
Worker consumes it, but no Cloudflare dashboard path routes Email Service lifecycle
events into that Queue — the consumer is dormant. Sending works; only the feedback
signal is missing. The fix must be Cloudflare-only (openspec/project.md) and must keep
the dormant consumer wired for the day Cloudflare ships routing.

## Goals / Non-Goals

Goals: every email-channel outreach entry reaches a terminal delivery state
(delivered/opened/bounced) within ~15 minutes of its last real signal, exactly once,
with an audit event per transition; bounces always win over earlier states and
suppress the address; bounce rate becomes measurable per provider.

Non-Goals: no sending-provider switch (no SendGrid/Postmark/etc.), no new
`EVENT_ACTIONS` (extend-only enum untouched), no changes to the send path's
suppression/warm-up logic, no CI restoration (SUBC-013), no MTR badges (SUBC-012).

## Decisions

### D1 — One shared applier, transition guards in two places

`applyEmailLifecycleEvent(db, {kind, to, sendId?, permanent?, source})` owns the
match+mutate+audit logic. The transition matrix lives as allowed-source-state sets,
applied BOTH in the recipient match query (so settled entries are never even selected)
and in the UPDATE where-clause with `RETURNING` gating the audit/suppression writes
(so a concurrent duplicate producer changes nothing and audits nothing). This is what
makes queue at-least-once delivery, webhook replay, and sweep re-runs all idempotent.
Ordering rules fall out of the matrix: a late `delivered` cannot downgrade `opened`;
`bounced` flips from any non-terminal state including inferred delivery; `skipped` and
`bounced` are terminal. The `source` field is recorded in every audit payload for
provenance (queue/webhook/inbound/resolution).

### D2 — Webhook: public tier, secret auth, fail-closed

The receiver rides the same routing tier as `/e/*`, `/t/*`, `/u/*` (before the Access
guard) because providers/ops tooling cannot obtain Access JWTs. Auth is a bearer shared
secret (`EMAIL_EVENTS_WEBHOOK_SECRET`) compared via SHA-256 digests XOR-accumulated —
constant-time equality without a `crypto.subtle.timingSafeEqual` (absent in the
Workers runtime at this compat date). An unset secret yields 401
`email_events_webhook_disabled` — there is never an open endpoint. Body tolerance
mirrors the queue consumer: single object or array, per-event try/catch, unknown types
skipped (never 500), 64KB cap, malformed JSON 400, `{accepted, skipped}` response.

### D3 — Inbound bounces: conservative RFC 3464 parsing

Cloudflare Email Routing can deliver the DSN a receiving server sends back to our
envelope address into the Worker's `email()` handler — the classic bounce path, no
vendor. Parsing is dependency-free, line-anchored regex over the raw message: a bounce
requires an EXPLICIT failure indicator (`Action: failed` or `Status: 4.x/5.x`);
`Final-Recipient: rfc822; addr` (or `X-Failed-Recipients:`) supplies the address;
`Status: 4.x` grades the bounce temporary, `5.x` permanent. Vacation auto-replies
(`Auto-Submitted: auto-replied`, no failure status) and ordinary human replies return
null — a misclassified bounce would suppress a healthy provider, the worst possible
pilot error. The handler never throws (queue-consumer semantics) and caps raw reads at
256KB.

### D4 — Resolution sweep: honest inferred delivery

If no signal ever arrives, the message almost certainly arrived (the alternative — a
bounce — would have produced a DSN). The sweep settles stale `sent` entries to
`delivered` with `payload.inferred: true, reason: "resolution_window_elapsed"` — the
marker keeps timeout-settled deliveries distinguishable from provider-confirmed ones in
every dashboard query, and a late real bounce still flips the entry (bounce wins from
`delivered`) and suppresses. Default window 10 minutes + 5-minute cron ⇒ ~15-minute
bound. The first production run retroactively resolves the pilot's historical stuck
entries. Cron cadence moves to `*/5`; the hourly jobs gate on `getUTCMinutes() === 0`
inside `runScheduledJobs` so their behavior is byte-identical to before.

### D5 — Per-provider metrics: denominator honesty

`sent` counts only dispatched mails (sent/delivered/opened/bounced); `skipped` entries
never reached a mailbox and are excluded from the bounce-rate denominator (a provider
whose every send was suppressed shows `bounceRate: null`, not a fake 100%). One grouped
query over `outreach_entries ⋈ companies` with `EXISTS` on `email_suppressions`; rows
ordered `bounced DESC, sent DESC` for triage; totals + overall bounce rate for the
Gate 2 evidence pack.

### Risks / Trade-offs

- Inferred delivery can be wrong (mail lost without a DSN) — mitigated by the explicit
  payload marker and a configurable window larger than typical DSN latency; bounce
  still wins after resolution.
- Webhook secret compromise could inject fake lifecycle events — scope is limited to
  delivery-state bookkeeping (no PII beyond the recipient address, no auth surface);
  secret rotation is standard `wrangler secret put`.
- Email Routing mis-routing ordinary inbound mail (e.g. a provider replying to the
  envelope address) is inert: the parser requires explicit failure indicators.

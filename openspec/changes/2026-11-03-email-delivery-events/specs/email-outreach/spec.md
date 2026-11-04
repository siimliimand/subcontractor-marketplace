## MODIFIED Requirements

### Requirement: Delivery lifecycle recorded
The system SHALL record delivery lifecycle events (delivered, bounced, opened) on the
matching outreach entry. Lifecycle events may arrive via the configured Email Service
Queue consumer, an authenticated webhook receiver (`POST /hooks/email-events`, bearer
shared secret, fail-closed when unconfigured), or inbound RFC 3464 DSN parsing of
bounce notifications delivered to the Worker — all applied through one idempotent,
transition-guarded state machine: `delivered` only from `sent`; `opened` from
`sent`/`delivered`; `bounced` from `sent`/`delivered`/`opened` (a bounce always wins,
including over an earlier inferred delivery). An email-channel entry still `sent` after
the configured resolution window (default 10 minutes, swept every 5 minutes) SHALL
resolve to `delivered` explicitly marked as inferred in the audit payload.

#### Scenario: Message delivered
- **WHEN** a `delivered` lifecycle event arrives for a sent message (Queue, webhook, or
  resolution sweep)
- **THEN** the outreach entry's email status becomes `delivered` with an
  `email_delivered` audit event, `channel='automated'`, and the audit payload carries
  the event source; sweep-resolved deliveries carry `inferred: true`

#### Scenario: Hard bounce suppresses the address
- **WHEN** a permanent bounce event arrives for a sent message (Queue, webhook, or
  inbound DSN with `Status: 5.x`)
- **THEN** the address is added to the suppression list, the entry is marked bounced,
  and future send attempts skip it

#### Scenario: Duplicate or out-of-order events settle exactly once
- **WHEN** the same lifecycle event is delivered twice, or a delivered event arrives
  after the entry is already `opened`/`bounced`
- **THEN** the entry's status is unchanged, no duplicate audit event is written, and no
  duplicate suppression row is created

#### Scenario: Stale sent entry resolves to inferred delivered
- **WHEN** an email-channel entry has been `sent` longer than the resolution window
  with no lifecycle signal
- **THEN** the sweep marks it `delivered` with an `email_delivered` audit event whose
  payload includes `{inferred: true, reason: "resolution_window_elapsed"}`; a real
  bounce arriving later still flips the entry and suppresses the address

#### Scenario: Inbound non-bounce mail is never classified as a bounce
- **WHEN** a vacation auto-reply or ordinary human reply is delivered to the Worker's
  inbound email handler
- **THEN** no bounce is recorded (explicit RFC 3464 failure indicators required) and
  the entry's state is untouched

#### Scenario: Webhook is never open
- **WHEN** a lifecycle event is POSTed to `/hooks/email-events` with a missing, wrong,
  or no bearer secret — or the secret is unset in the environment
- **THEN** the request is rejected with 401 and no state changes

### Requirement: Open tracking pixel
The system SHALL serve a tracking pixel on a public route that records one
`email_opened` audit event per sent email token, `channel='automated'`, and SHALL
upgrade the outreach entry's email status to `opened` when its current status is
`sent` or `delivered` (never downgrading `bounced` or `skipped`, while the open audit
fact is recorded regardless).

#### Scenario: Provider opens the email
- **WHEN** the mail client fetches the pixel for a sent token
- **THEN** exactly one `email_opened` audit event is recorded and the entry's email
  status becomes `opened`; subsequent fetches record nothing

## ADDED Requirements

### Requirement: Send outreach batch by email
The system SHALL send outreach emails to all providers in a cockpit-initiated batch
using the Cloudflare Email Service send binding, one email per eligible outreach entry,
with the request brief (title, trades, location, window, headcount) and the three
response links (Accept / Quote / Decline) as a single-use token each.

#### Scenario: Staff sends a batch
- **WHEN** staff clicks "Send batch email" for a request in `outreach` state
- **THEN** every non-suppressed, non-opted-out provider in the batch receives an email
  and each outreach entry gains a `sent` email status with `email_sent` audit event,
  `channel='automated'`

#### Scenario: Send requires explicit staff action
- **WHEN** a request reaches `outreach` state without staff action
- **THEN** no email is sent automatically; sending happens only on the explicit
  cockpit action

### Requirement: Suppression and warm-up limits honoured
The system SHALL refuse to send to addresses on the suppression list, MUST skip them
with a visible per-entry status, and SHALL NOT exceed a configurable daily send limit
(counting `email_sent` events per UTC day).

#### Scenario: Suppressed address skipped
- **WHEN** a batch contains a provider whose address is on the suppression list
- **THEN** the provider's outreach entry is marked skipped with reason, no email is
  sent, and the batch is still recorded

#### Scenario: Daily limit reached
- **WHEN** the daily `email_sent` count is at or above the configured limit and staff
  attempts another batch
- **THEN** the send is rejected with a clear error naming the limit and no email leaves

### Requirement: Delivery lifecycle recorded
The system SHALL consume Email Service lifecycle events (delivered, bounced) from the
configured Queue and record `email_delivered` or `email_bounced` audit events on the
matching outreach entry.

#### Scenario: Message delivered
- **WHEN** a `delivered` lifecycle event arrives for a sent message
- **THEN** the outreach entry's email status becomes `delivered` with an
  `email_delivered` audit event, `channel='automated'`

#### Scenario: Hard bounce suppresses the address
- **WHEN** a permanent bounce event arrives for a sent message
- **THEN** the address is added to the suppression list, the entry is marked bounced,
  and future send attempts skip it

### Requirement: Open tracking pixel
The system SHALL serve a tracking pixel on a public route that records one
`email_opened` audit event per sent email token, `channel='automated'`.

#### Scenario: Provider opens the email
- **WHEN** the mail client fetches the pixel for a sent token
- **THEN** exactly one `email_opened` audit event is recorded; subsequent fetches
  record nothing

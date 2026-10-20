# Data Governance Specification

## Purpose
Guard personal data: manage the email suppression list by hand, erase a company's personal data on request, purge expired artifacts on a retention schedule, and keep personal fields minimised — closing the phase's GDPR checklist.

## Requirements

### Requirement: Suppression list management
Staff SHALL be able to list, add, and remove email suppression entries, each with a
reason; removal SHALL require a reason and be audit-logged. Suppressed addresses are
skipped by every send path exactly as bounce-driven suppressions are today.

#### Scenario: Staff removes a suppression
- **WHEN** staff removes a suppression entry with a reason
- **THEN** future sends may include that address and the removal is recorded as an
  audit event with the reason and actor

### Requirement: Company data erasure
The system SHALL provide a staff-initiated erasure routine for a company that
anonymises contact and personal fields (contact email, phone, user names, personal
data in payloads where technically separable), sets the company status so it is
excluded from matching and sending, and preserves the audit trail with anonymised
actors. Erasure SHALL be audit-logged with the requesting staff actor and reason.

#### Scenario: Erasure request from a provider
- **WHEN** staff runs erasure for an opted-out company
- **THEN** the company's contact fields and personal identifiers are replaced with
  non-identifying placeholders, historical events remain with anonymised identifiers,
  and no future matching or email targets the company

#### Scenario: Erasure does not break history
- **WHEN** a request that involved the erased company is viewed afterwards
- **THEN** the funnel history still shows the response and outcome events, attributed
  to an anonymised participant

### Requirement: Retention purge of expired artifacts
The system SHALL purge on a schedule: expired email tokens past a configurable
retention window and superseded/released holds past theirs. Purge counts SHALL be
audit-visible; live audit events and bookings are never purged by this job.

#### Scenario: Expired tokens purged
- **WHEN** the retention job runs
- **THEN** tokens expired longer than the configured window are deleted and the purge
  result is logged; unexpired tokens are untouched

### Requirement: Personal data minimisation
New writes of personal data SHALL be minimised: audit event payloads SHALL NOT embed
provider contact email addresses where a foreign-key reference suffices, and any new
field collecting personal data MUST state its retention in the schema comment.

#### Scenario: Email send payload minimised
- **WHEN** an email_sent audit event is written after this change
- **THEN** the payload references the outreach entry rather than embedding the
  recipient address

### Requirement: Erasure covers phase-4 artifacts
Erasing a company SHALL also purge or redact its calendar feeds and busy intervals,
its provider users, and its reviews — review text SHALL be redacted while the
rating record's effect on aggregate metrics SHALL be removed. Deletion happens in
the same erasure flow with the same audit trail.

#### Scenario: Erased company leaves no calendar data
- **WHEN** a company with feeds and intervals is erased
- **THEN** no feed URLs or busy intervals remain for that company

#### Scenario: Reviews do not survive erasure attributable
- **WHEN** a company with reviews is erased
- **THEN** review text is redacted and the reviews no longer count toward any provider's displayed metrics

### Requirement: Secrets and derived-data retention
Feed URLs SHALL be stored so they are never rendered in full or written to logs,
and masked in every API response. Busy intervals for stale or removed feeds SHALL
be purged by the retention job after the staleness window, keeping derived
calendar data from accumulating indefinitely.

#### Scenario: Masked everywhere
- **WHEN** any staff or API view lists feeds
- **THEN** URLs appear masked and no log line contains a full feed URL

#### Scenario: Stale feed intervals purged
- **WHEN** the retention job runs and a feed has been stale beyond the window
- **THEN** the feed's intervals are deleted while the feed record itself is kept for staff review

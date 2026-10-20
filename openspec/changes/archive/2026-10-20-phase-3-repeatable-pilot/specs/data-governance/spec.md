# Spec Delta

## Purpose

Guard personal data: manage the email suppression list by hand, erase a company's personal data on request, purge expired artifacts on a retention schedule, and keep personal fields minimised — closing the phase's GDPR checklist.

## ADDED Requirements

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

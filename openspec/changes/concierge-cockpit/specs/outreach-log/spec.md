## ADDED Requirements

### Requirement: Log outreach batches
Staff SHALL log an outreach entry per provider per request: batch number, contacted-by staff member, channel (`manual` in the cockpit), sent timestamp and optional notes.

#### Scenario: Log a manual batch
- **WHEN** staff records outreach to 5 providers for a request
- **THEN** 5 outreach entries are stored sharing one batch number, each with its own provider, staff member and timestamp

### Requirement: No duplicate active outreach
A provider MUST have at most one active outreach entry per request; adding a second for the same provider-request pair MUST be rejected unless the first is superseded by a wider batch.

#### Scenario: Duplicate provider in a batch
- **WHEN** staff records outreach to a provider already contacted for the same request
- **THEN** the system rejects the duplicate entry and names the existing batch

### Requirement: Opted-out providers excluded
Outreach entries MUST NOT be created for providers whose status is `opted_out`.

#### Scenario: Attempt to contact an opted-out provider
- **WHEN** staff records outreach that includes an opted-out provider
- **THEN** that entry is rejected with the opt-out reason shown, and the other entries in the batch are unaffected

### Requirement: Stop on booked or cancelled
Once a request is `booked` or `cancelled`, no new outreach entries MUST be accepted for it.

#### Scenario: Outreach after booking
- **WHEN** staff attempts to log outreach on a booked request
- **THEN** the system rejects the entry because the request is closed for outreach

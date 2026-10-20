# Spec Delta

## ADDED Requirements

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

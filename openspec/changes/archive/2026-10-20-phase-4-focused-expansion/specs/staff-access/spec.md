# Spec Delta

## ADDED Requirements

### Requirement: Exportable audit trail
Staff SHALL be able to export the audit trail as CSV, filtered by date range and
optionally by company and action type. Exports SHALL require the same staff
authentication as the cockpit and SHALL themselves be recorded as audit events.

#### Scenario: Date-range export
- **WHEN** staff exports the audit trail for a two-week range
- **THEN** a CSV streams every event in the range with timestamp, actor, action, and subject, and an `audit_exported` event records the export parameters

#### Scenario: Company-scoped export
- **WHEN** staff exports filtered to one company
- **THEN** only events pertaining to that company are included

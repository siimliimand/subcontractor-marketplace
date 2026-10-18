# Effort Tracking Specification

## Purpose
Define the immutable, append-only audit event stream with a fixed taxonomy that records every cockpit mutation atomically, plus manual time entries and per-request effort rollups.

## Requirements

### Requirement: Immutable audit events for every mutation
Every create, update, status change and outreach entry SHALL write one audit event in the same transaction as the mutation, storing actor user, UTC timestamp, entity, entity id, action, a payload summary and a channel of `manual` (cockpit actions are manual by default; `automated` is reserved for later engine work).

#### Scenario: Create writes an event
- **WHEN** staff creates a request
- **THEN** a `request_created` event is stored with the actor, timestamp and payload summary

#### Scenario: Mutation and event are atomic
- **WHEN** a mutation fails partway
- **THEN** neither the data change nor its audit event is written

### Requirement: Events are append-only
Audit events MUST have no update or delete path in the application.

#### Scenario: Attempt to modify history
- **WHEN** any code path or API attempts to alter a stored audit event
- **THEN** the system provides no such operation and the event remains unchanged

### Requirement: Fixed event taxonomy
Event action names MUST belong to a fixed enum that mirrors the pilot funnel taxonomy (`request_created`, `request_approved`, `matched`, `outreach_sent`, `response_received`, `qualified_response`, `quote_submitted`, `booking_confirmed`, `completion_confirmed`, `accepted_but_not_delivered`, `request_cancelled`, plus admin events `provider_created`, `provider_updated`, `login`, `access_denied`). Unknown action names MUST be rejected at write time.

#### Scenario: Known and unknown action names
- **WHEN** the event helper is called with `booking_confirmed` versus an unregistered name
- **THEN** the first is accepted and the second raises an error before any write

### Requirement: Manual time entries
Staff SHALL log manual time per request in minutes with an optional note; entries are attributed to the logging staff member and timestamped.

#### Scenario: Log time spent
- **WHEN** staff logs 45 minutes spent clarifying a brief and calling providers
- **THEN** a time entry is stored against that request

### Requirement: Effort rollup per request
The system SHALL compute per-request effort: total logged minutes and count of manual audit events.

#### Scenario: Rollup
- **WHEN** staff opens the effort view for a request with 2 time entries and 9 manual events
- **THEN** the rollup shows 9 manual interventions and the summed minutes

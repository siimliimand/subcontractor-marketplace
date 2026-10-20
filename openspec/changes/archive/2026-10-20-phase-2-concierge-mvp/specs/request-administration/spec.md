# Spec Delta

## MODIFIED Requirements

### Requirement: Create request on behalf of a PM
Staff SHALL be able to create a request for a project manager with a title, work description, location, a required-trades set of one or more trades from the configured trades list, a primary trade (first of the set), desired start date and estimated crew size; budget, duration and notes are optional. New requests MUST be created in status `draft`. The trades set MUST be stored as a request-trades relation (multi-trade requests are in scope since Decision 3).

#### Scenario: Create a draft request
- **WHEN** staff creates a request with title, description, location, trade `electrical`, start date and crew size 3
- **THEN** the request is stored in status `draft` with those fields

#### Scenario: Create a multi-trade draft request
- **WHEN** staff creates a request with title, description, location, trades `electrical` and `drywall` (primary `electrical`), start date and crew size 5
- **THEN** the request is stored in status `draft` with two request-trade rows and primary trade `electrical`

#### Scenario: Single-trade request unchanged
- **WHEN** staff creates a request with a single trade
- **THEN** the request behaves exactly as before: one required trade, and all existing single-trade flows work

#### Scenario: Reject empty trades set
- **WHEN** staff creates a request with no trades selected
- **THEN** the system rejects creation and requires at least one trade

### Requirement: Approval requires complete brief
A request MUST NOT be approved unless title, description, location, at least one required trade, start date and crew size are present.

#### Scenario: Approve incomplete request
- **WHEN** staff approves a request missing its start date
- **THEN** the system rejects the approval and lists the missing fields

#### Scenario: Approve request with trades set
- **WHEN** staff approves a request whose required-trades set contains two valid trades
- **THEN** approval succeeds and the request enters `approved`

## ADDED Requirements

### Requirement: Record work start
Staff SHALL be able to mark work as started on a booked request, recording a `work_started` event with actor and timestamp. The action MUST be available only for requests in `booked` status.

#### Scenario: Mark work started
- **WHEN** staff marks a booked request as work started
- **THEN** a `work_started` event is stored and the request remains `booked`

#### Scenario: Work start before booking rejected
- **WHEN** staff attempts to mark work started on a request that is not `booked`
- **THEN** the system rejects the action

### Requirement: Response comparison grouped by trade
Staff SHALL be able to view all responses to a request compared side-by-side, grouped by required trade, showing per provider: response type, quoted price or interest, declared workers and available-from date, and the freshness state of the provider's availability. The comparison MUST distinguish confirmed from unconfirmed capacity.

#### Scenario: Compare responses in a two-trade request
- **WHEN** staff opens the comparison view of a request with `electrical` and `drywall` trades and responses on both
- **THEN** responses are grouped under their trade with price, capacity and availability freshness per provider

#### Scenario: Unconfirmed capacity marked in comparison
- **WHEN** the comparison view includes a response from an email-only provider
- **THEN** that provider's availability is labelled "Unconfirmed" in the comparison

# Request Administration Specification

## Purpose
Define how staff create subcontracting requests on behalf of project managers and steer them through an enforced lifecycle, recording provider responses, a single booking, outcomes, cancellations with attribution, and full request history.

## Requirements

### Requirement: Create request on behalf of a PM
Staff SHALL be able to create a request for a project manager with a title, work description, location, required trade, desired start date and estimated crew size; budget, duration and notes are optional. New requests MUST be created in status `draft`.

#### Scenario: Create a draft request
- **WHEN** staff creates a request with title, description, location, trade `electrical`, start date and crew size 3
- **THEN** the request is stored in status `draft` with those fields

### Requirement: Enforced request lifecycle
Requests SHALL move through the states `draft → approved → matched → in_outreach → responded → booked → closed`, with `cancelled` reachable from any pre-booked state. Invalid transitions MUST be rejected.

#### Scenario: Approve a complete draft
- **WHEN** staff approves a draft whose required fields are complete
- **THEN** the request status becomes `approved` and an audit event is written

#### Scenario: Invalid transition
- **WHEN** staff attempts to move a `draft` request directly to `responded`
- **THEN** the system rejects the transition and the status is unchanged

### Requirement: Approval requires complete brief
A request MUST NOT be approved unless title, description, location, trade, start date and crew size are present.

#### Scenario: Approve incomplete request
- **WHEN** staff approves a request missing its start date
- **THEN** the system rejects the approval and lists the missing fields

### Requirement: Record provider responses
Staff SHALL record each provider response against a request with a type (`interest`, `quote`, `decline`), an availability declaration (number of workers and available-from date) for interest and quote, and a reason for decline.

#### Scenario: Record a qualified response
- **WHEN** staff records an `interest` response from a provider with 3 workers available from a given date
- **THEN** the response is stored on the request and the request status becomes `responded`

#### Scenario: Declined response without reason
- **WHEN** staff records a `decline` response without a reason
- **THEN** the system requires a reason before saving

### Requirement: Booking confirmation, first confirmed wins
Staff SHALL confirm a booking by selecting one response, a date range and capacity. Confirming sets the request status to `booked`. A second booking confirmation on the same request MUST be rejected.

#### Scenario: Confirm the first booking
- **WHEN** staff confirms a booking from a response for a date range with capacity 3 workers
- **THEN** the request status becomes `booked` and the booking is recorded with the provider and dates

#### Scenario: Second booking attempt
- **WHEN** staff attempts to confirm a second booking on the already-booked request
- **THEN** the system rejects it and the first booking stands

### Requirement: Outcomes and cancellation attribution
Staff SHALL record a booking outcome: `completion_confirmed` or `accepted_but_not_delivered`; and cancel a request or booking with attribution to `customer` or `provider` plus a reason.

#### Scenario: Record a no-show
- **WHEN** staff marks a booked request as `accepted_but_not_delivered`
- **THEN** the outcome is stored on the booking and counts in reliability metrics

#### Scenario: Customer cancels before booking
- **WHEN** staff cancels an `in_outreach` request attributed to `customer`
- **THEN** the request status becomes `cancelled` with the attribution and reason stored

### Requirement: Request history
Staff SHALL be able to view a request's full history: field changes, outreach entries, responses, booking and outcome events in chronological order.

#### Scenario: Open request detail
- **WHEN** staff opens a request that went through outreach and booking
- **THEN** all outreach entries, responses, the booking and every audit event are listed in chronological order

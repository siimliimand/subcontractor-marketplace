# Spec Delta

## ADDED Requirements

### Requirement: Booking checks imported busy intervals
Booking request creation, confirmation, and widening SHALL consult imported
calendar busy intervals in addition to capacity declarations, rejecting ranges
that overlap an interval with an explicit calendar-conflict reason. Conflict
responses SHALL NOT include feed event details.

#### Scenario: Widening into a calendar-busy week
- **WHEN** widening extends a request into a provider range overlapping an imported busy interval
- **THEN** that provider is excluded from the widened round with a recorded calendar-conflict reason

#### Scenario: Conflict message is opaque about calendar contents
- **WHEN** a booking action is rejected for a calendar conflict
- **THEN** the response says the provider's calendar is busy for the range without naming events or times beyond the requested range

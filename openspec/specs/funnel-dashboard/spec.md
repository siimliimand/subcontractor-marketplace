# Funnel Dashboard Specification

## Purpose
Define the dashboard views computed from audit events: funnel overview metrics with explicit denominator rules, supply coverage against per-trade minimums, and manual effort trends over time.

## Requirements

### Requirement: Funnel overview metrics
The dashboard SHALL show, for any date range: number of eligible requests, the share receiving at least one qualified response within 24 hours, median time from request approval to first qualified response in business hours (Europe/Tallinn), and booking conversion.

#### Scenario: Metrics from pilot data
- **WHEN** staff opens the overview for the pilot period
- **THEN** the four funnel metrics are computed from audit events and displayed with their numerators and denominators

### Requirement: Denominator rules
The success rate MUST exclude customer-cancelled requests from its denominator; booking conversion MUST exclude requests still open; automated responses MUST be excluded from time-to-response (cockpit-era responses are manual, the rule is encoded now).

#### Scenario: Cancelled request excluded
- **WHEN** a request is cancelled by its customer before any response
- **THEN** it is counted in volume but excluded from the success-rate denominator

#### Scenario: Open request excluded from conversion
- **WHEN** a request is still in `in_outreach`
- **THEN** it is excluded from the conversion denominator, not counted as a failure

### Requirement: Supply view
The dashboard SHALL show active providers by trade, with the per-trade minimums for the pilot (electrical 6, plumbing 5, HVAC 4, drywall 5, flooring 4, painting 6) marked as met or unmet.

#### Scenario: Trade coverage
- **WHEN** staff opens the supply view with 7 electrical and 2 flooring providers active
- **THEN** electrical shows met and flooring shows unmet against its minimum

### Requirement: Effort view
The dashboard SHALL show manual effort over time: minutes and intervention counts per request, and the weekly trend.

#### Scenario: Weekly effort trend
- **WHEN** staff opens the effort view covering four weeks of requests
- **THEN** minutes and interventions per request are shown per week, so a declining trend is visible

### Requirement: Weekly dashboard covers all pilot metrics
The dashboard SHALL compute weekly buckets of: new and active PMs; new requests and
requests reaching completion; request success rate (qualified response ≤24h ÷
eligible requests); median time to first qualified response; providers contacted per
request; booking conversion; availability confirmation rate (responses confirming
availability ÷ total responses); cancellations and failed commitments
(accepted-but-not-delivered); repeat usage (PMs with ≥2 requests ÷ active PMs); and
manual effort per completed request. Each metric SHALL use the defined numerator,
denominator, and exclusions, and an empty denominator SHALL render as "no data",
never as zero.

#### Scenario: Week with no eligible requests
- **WHEN** a week bucket has no eligible requests
- **THEN** success and conversion show "no data" rather than 0%

#### Scenario: Exclusions applied
- **WHEN** a request was cancelled by the customer before any response
- **THEN** it is excluded from the success-rate denominator in every bucket it
  appears in

### Requirement: Booking funnel displayed
The dashboard UI SHALL render the booking funnel (requested → confirmed with
conversion) that the API already returns.

#### Scenario: PM opens the dashboard
- **WHEN** the dashboard page loads
- **THEN** the booking funnel numbers are visible alongside the other metric cards

### Requirement: Booking-system adoption share
The dashboard SHALL show the adoption share: providers whose availability channel is
booking_system ÷ all active providers, trended weekly.

#### Scenario: Adoption trending
- **WHEN** staff views the dashboard during the pilot
- **THEN** the current adoption share and its weekly trend are visible

### Requirement: CSV export
Staff SHALL be able to export the weekly dashboard as CSV with one row per week and
one column per metric, suitable for the weekly metrics review without re-querying.

#### Scenario: Export for the Monday review
- **WHEN** staff clicks the dashboard export action
- **THEN** a CSV file downloads containing all weeks in range and all metrics with
  their values (empty denominators as empty cells)

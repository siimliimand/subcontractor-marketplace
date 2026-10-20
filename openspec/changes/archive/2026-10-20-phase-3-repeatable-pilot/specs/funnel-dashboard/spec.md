# Spec Delta

## Purpose

Extend the funnel dashboard into the full weekly pilot dashboard: every 08 metric with an explicit numerator/denominator, weekly buckets, the booking funnel rendered in the UI, adoption share, and CSV export for the Monday metrics review.

## ADDED Requirements

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

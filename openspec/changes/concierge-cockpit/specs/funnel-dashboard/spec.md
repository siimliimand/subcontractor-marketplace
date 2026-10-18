## ADDED Requirements

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

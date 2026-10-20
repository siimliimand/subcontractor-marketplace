# Spec Delta

## ADDED Requirements

### Requirement: Platform-history "Established" badge
The system SHALL display an "Established" badge for a provider with at least 3
completed bookings with positive outcomes, shown with the basis (completed booking
count) and computed from platform history rather than registers. Providers below
the threshold SHALL NOT show the badge. Customer-caused cancellations SHALL NOT
count against the provider's completed record.

#### Scenario: Badge appears at threshold
- **WHEN** a provider's third booking outcome is confirmed as a positive completion
- **THEN** the provider's views show the Established badge with the completed-booking count as its basis

#### Scenario: Badge absent below threshold
- **WHEN** a provider has fewer than 3 completed bookings with positive outcomes
- **THEN** no Established badge is shown anywhere provider comparisons happen

# Provider Verification Specification

## Purpose
Register-backed trust badges for providers: an existence badge from the Äriregister open data and a trade-notification badge from the MTR/Tarvik open-data XML — imported offline into D1, displayed where PMs compare providers, with licence attribution and a pending-confirmation guard on the trade badge.

## Requirements

### Requirement: Registry existence badge from imported Äriregister data
The system SHALL display a "Registered & active" badge for a provider when the most
recent Äriregister import shows the company status as registered and active, and SHALL
show the badge check date. Companies absent from the import or not active SHALL NOT
show the badge.

#### Scenario: Active registered provider
- **WHEN** a provider's registry identifier matches an active entry in the latest
  Äriregister import
- **THEN** the provider detail and comparison views show "Registered & active" with
  the check date

#### Scenario: Dissolved or missing company
- **WHEN** the latest import shows the company dissolved/liquidated, or contains no
  matching entry
- **THEN** no existence badge is shown and the provider's verification panel states
  the last check outcome

### Requirement: Trade notification badge from imported MTR data
The system SHALL display a "Trade notification valid" badge per trade when the most
recent MTR/Tarvik import shows a valid activity notice for that provider's EMTAK
activity in the corresponding trade. Display of this badge SHALL be gated behind a
configuration flag until the TTJA licence confirmation (CC BY-SA 3.0 share-alike) is
recorded; the import pipeline is built regardless.

#### Scenario: Valid electrical notification
- **WHEN** the import shows a valid elektritööd notification for the provider and the
  flag is enabled
- **THEN** the provider's electrical services show "Trade notification valid" with the
  check date

#### Scenario: Flag disabled pending licence confirmation
- **WHEN** the MTR badge flag is disabled
- **THEN** no trade-notification badge renders anywhere, but staff can see the
  imported check results in the verification panel

### Requirement: Offline import only
Register data SHALL enter the system exclusively through staff-run offline imports
into D1; the production request path SHALL NOT call any external register API.
Imports SHALL record source dataset, import timestamp, and row counts, and re-running
an import SHALL be idempotent per registry identifier.

#### Scenario: Import rerun
- **WHEN** staff re-runs the Äriregister import for the same dataset snapshot
- **THEN** verification rows are updated in place without duplicates and the import
  timestamp advances

#### Scenario: No runtime register calls
- **WHEN** any cockpit or public page renders
- **THEN** badge data comes only from previously imported rows

### Requirement: Attribution and licence notices
Verification data derived from Äriregister (CC BY 4.0) and MTR/Tarvik (CC BY-SA 3.0)
SHALL carry source attribution in the system, and the trade badge SHALL remain
suppressed until licence terms are confirmed and recorded.

#### Scenario: Attribution stored
- **WHEN** an import completes
- **THEN** the source register name and licence note are stored with the verification
  records and available in the verification panel

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

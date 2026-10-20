# Booking Core Specification

## Purpose

Model real crew capacity: availability declarations (workers per trade per day with freshness), booking request → confirmation with first-confirmed-wins enforced at the database level, optional 48-hour holds behind a feature flag, and cancellation with attribution.

## Requirements

### Requirement: Availability declarations
Staff SHALL record availability declarations per provider: trade, number of workers, date range, channel (`booking_system`, `email_only`), and a confirmation timestamp. The declaration set per provider-trade MUST be queryable for matching and display.

#### Scenario: Record a declaration
- **WHEN** staff records that a provider has 3 electrical workers available from 2026-11-02 to 2026-11-20
- **THEN** the declaration is stored with the workers count, date range and confirmation timestamp and appears in the provider's availability view

### Requirement: Capacity freshness states
The system SHALL derive a freshness state from the declaration's confirmation timestamp: current (<7 days), aging (7–14 days), stale (14–30 days), expired (>30 days). Expired declarations MUST be treated as unknown capacity: they MUST NOT count toward confirmed capacity in matching, and the UI MUST present them as requiring reconfirmation.

#### Scenario: Expired declaration not counted
- **WHEN** a matching run ranks candidates and a provider's only declaration was confirmed 40 days ago
- **THEN** the provider's confirmed-capacity factor scores zero and the UI shows the capacity as expired

#### Scenario: Aging display
- **WHEN** staff views a declaration confirmed 10 days ago
- **THEN** it is displayed as aging with a reconfirmation recommendation

### Requirement: Unknown capacity never shown as confirmed
A provider with no declaration, an expired declaration, or channel `email_only` MUST be displayed as "Unconfirmed", never as confirmed capacity. An empty declaration history MUST NOT be interpreted as free capacity.

#### Scenario: Email-only provider display
- **WHEN** staff views a provider whose availability is collected only by email
- **THEN** the availability section is labelled "Unconfirmed" regardless of any stated dates

### Requirement: Booking request and confirmation
Confirming a booking SHALL be a two-step flow: a booking request (recording the requested response or hold, date range and capacity) followed by an explicit confirmation. `booking_requested` and `booking_confirmed` MUST be recorded as separate audit/funnel events. Only a confirmation sets the request status to `booked`.

#### Scenario: Request then confirm
- **WHEN** staff requests a booking against a qualified response and then confirms it
- **THEN** two events are recorded in order (`booking_requested`, `booking_confirmed`) and the request status becomes `booked` only after the confirmation

#### Scenario: Request without confirmation
- **WHEN** staff records a booking request but does not confirm it
- **THEN** the request status remains unchanged and no booking is committed

### Requirement: First-confirmed-wins enforced by the database
The database MUST prevent the same provider capacity (provider, trade, overlapping date range) from being committed by two confirmed bookings. When two confirmations race, exactly one MUST succeed and the other MUST fail with a conflict error naming the winning booking. The guarantee MUST hold at the database level, not only in application code.

#### Scenario: Concurrent confirmations for the same capacity
- **WHEN** two staff members simultaneously confirm bookings for the same provider, trade and overlapping dates on different requests
- **THEN** one confirmation succeeds and the other is rejected with a capacity-conflict error naming the winning booking

#### Scenario: Overlap is per trade and date range
- **WHEN** a provider's confirmed booking covers electrical workers in week 48 and a new booking requests electrical workers in week 50
- **THEN** the new booking is accepted because the date ranges do not overlap

### Requirement: Holds behind a feature flag
When the holds feature flag is enabled, staff MAY place a 48-hour hold on a provider's capacity tied to a request; a hold MUST expire automatically after 48 hours and MUST be superseded by a confirmed booking. When the flag is disabled, hold creation MUST be rejected. Holds MUST be tested before the flag is made the default.

#### Scenario: Place and expire a hold
- **WHEN** staff places a hold with the flag enabled and 48 hours pass without confirmation
- **THEN** the hold is expired, no longer blocks capacity, and the expiry is recorded

#### Scenario: Flag disabled
- **WHEN** the holds flag is disabled and staff attempts to place a hold
- **THEN** the system rejects the hold creation

### Requirement: Booking cancellation with attribution
Staff SHALL cancel a booking with attribution (`customer` or `provider`) and a reason. Cancellation MUST release the booking's claimed capacity, record the cancellation event, and feed provider reliability metrics.

#### Scenario: Provider cancels a booking
- **WHEN** staff cancels a confirmed booking attributed to `provider` with a reason
- **THEN** the booking is recorded as cancelled, the capacity is freed for matching, and a reliability-relevant event is stored

### Requirement: Tentative vs confirmed distinction
The system SHALL distinguish a tentative booking request (capacity requested, not
yet confirmed) from a confirmed booking in every view where either appears, using
explicit labelling. An accepted response or requested booking SHALL NOT be described
to the PM as a booked commitment.

#### Scenario: PM views a requested booking
- **WHEN** a booking request exists in `requested` state
- **THEN** the UI labels it "Tentative — awaiting confirmation" and it is never
  counted as a confirmed booking in metrics

### Requirement: Reschedule propose → confirm → record
For a confirmed booking, staff SHALL be able to propose a reschedule (new dates
and/or crew size); the proposal SHALL be recorded and either confirmed or rejected.
Confirmation SHALL re-run the first-confirmed-wins capacity check for the new window;
a conflict rejects the reschedule and names the winner. The booking's final state
records the change history.

#### Scenario: Reschedule confirmed
- **WHEN** a proposed reschedule is confirmed and the new window has capacity
- **THEN** the booking's dates/crew update, the proposal history is retained, and a
  reschedule audit event records both parties

#### Scenario: Reschedule conflicts
- **WHEN** another confirmed booking already occupies the requested capacity in the
  new window
- **THEN** the reschedule is rejected with the capacity-conflict details and the
  original booking is unchanged

### Requirement: Booking-level cancellation with attribution
A confirmed booking SHALL be cancellable at booking level with mandatory attribution
(customer | provider) and reason, recorded on the booking outcome without cancelling
the parent request. Request-level cancellation behaviour is unchanged.

#### Scenario: Provider cancels the booking
- **WHEN** staff records a provider-attributed booking cancellation with a reason
- **THEN** the booking outcome records the cancellation and attribution, the request
  remains open for re-booking, and the failed commitment feeds reliability metrics

### Requirement: Reconfirmation prompts
The system SHALL surface reconfirmation prompts where freshness demands it: aging or
stale declarations behind a live booking get a visible prompt, and staff can
reconfirm with one action that records a fresh declaration carrying the current
timestamp and source. Bookings whose underlying declarations are expired SHALL be
flagged for reconfirmation.

#### Scenario: Stale declaration behind a confirmed booking
- **WHEN** the declaration covering a confirmed booking's window ages past the stale
  threshold
- **THEN** the booking view prompts reconfirmation and a one-click action records the
  refreshed confirmation with actor and timestamp

### Requirement: External-commitment disclaimer
The booking UI SHALL state clearly that the platform cannot know about commitments
made outside the system, on the booking views where a PM might assume capacity
knowledge is complete.

#### Scenario: PM confirms a booking
- **WHEN** the booking confirmation view is shown
- **THEN** the disclaimer about off-system commitments is visible in the same view

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

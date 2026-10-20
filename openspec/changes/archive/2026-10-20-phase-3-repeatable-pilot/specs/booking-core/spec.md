# Spec Delta

## Purpose

Harden bookings for pilot reality: tentative vs confirmed surfaced end-to-end, reschedule as propose → confirm → record, booking-level cancellation with attribution, freshness-driven reconfirmation prompts, and a clear disclaimer about off-platform commitments.

## ADDED Requirements

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

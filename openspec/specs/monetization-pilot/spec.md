# Monetization Pilot Specification

## Purpose
Monetization experiments without a payment processor: hand-billed pilot agreements
per design partner gate the booking interface — the paid part per the fixed rule —
while listing and matching stay free, and every gated view is counted so the
willingness-to-pay experiment produces funnel evidence.

## Requirements

### Requirement: Hand-billed pilot agreements
Staff SHALL be able to record a pilot agreement per partner (the booking-interface
pilot), with plan, start and end dates, price, and notes, and to end one. Agreement
changes are audit-logged. No payment processing happens in the platform — agreements
are records of hand-billed arrangements.

#### Scenario: Agreement recorded and ended
- **WHEN** staff records a pilot agreement for a partner and later ends it
- **THEN** both changes are audit-logged and the partner's entitlement reflects the agreement state at any point in time

### Requirement: Booking interface gated by agreement
When the monetization pilot flag is enabled, partners without an active agreement
SHALL see the booking interface in a gated state — read-only with an upgrade
prompt — while their listing, matching, and request flows remain fully available.
Partners with an active agreement SHALL experience no change. Gated views SHALL be
counted as funnel events.

#### Scenario: Non-agreement partner meets the gate
- **WHEN** the pilot flag is enabled and a partner without an active agreement opens a booking view
- **THEN** the view renders read-only with the upgrade prompt, and a `pilot_gate_blocked` event is recorded

#### Scenario: Flag off means no gating
- **WHEN** the monetization pilot flag is disabled
- **THEN** every partner sees the booking interface exactly as before

### Requirement: Experiment metrics visible to staff
Staff SHALL be able to see per-partner booking usage and gated-view counts, and the
share of partners on agreements, so the pilot's hypothesis can be judged against
recorded behaviour rather than anecdote.

#### Scenario: Weekly pilot readout
- **WHEN** staff opens the pilot metrics view
- **THEN** each partner's booking usage, gated-view count, and agreement status are shown for the recent period

# Spec Delta

## Purpose

Turn the email response flow into the adoption funnel: after a successful automated interaction, email-only providers are offered the booking system, and the offer is audited and rate-limited so it never nags.

## ADDED Requirements

### Requirement: Post-response adoption prompt
When a provider whose availability channel is email_only completes a successful
token response (accept or quote), the confirmation page SHALL include a prompt
offering the booking system with a described next step. Providers already on the
booking system SHALL NOT see the prompt.

#### Scenario: Email-only provider accepts
- **WHEN** an email-only provider submits an accept and lands on the confirmation
  page
- **THEN** the page shows the booking-system signup prompt

#### Scenario: Booking-system provider accepts
- **WHEN** a provider already using the booking system submits a response
- **THEN** no adoption prompt appears

### Requirement: Prompt shown at most once per provider
The adoption prompt SHALL be shown to a given provider at most once; subsequent
responses render the plain confirmation. Each prompt display SHALL be audited with
channel `automated`.

#### Scenario: Second response after a prompt
- **WHEN** the provider responds again after having seen the prompt
- **THEN** the confirmation page shows no prompt

#### Scenario: Prompt audited
- **WHEN** the prompt is rendered
- **THEN** an audit event records the provider and request without embedding the
  contact email

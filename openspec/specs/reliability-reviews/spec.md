# Reliability and Reviews Specification

## Purpose
Reviews tied to genuine completed bookings and reliability metrics displayed only
above minimum sample sizes — so trust signals come from real platform history,
never from open reviews, and new providers are not disadvantaged for lacking history.

## Requirements

### Requirement: Reviews tied to completed bookings
Staff SHALL be able to submit at most one review per booking — a 1–5 rating with an
optional comment — and only for a booking whose outcome is a confirmed completion.
The review records its author and the booking, and is audit-logged. Reviews are
never presented as proof of technical competence or legal compliance.

#### Scenario: Review after confirmed completion
- **WHEN** staff submits a rating and comment for a booking whose outcome is `completion_confirmed`
- **THEN** the review is stored linked to that booking, and a `review_submitted` audit event records the actor

#### Scenario: No review without completion
- **WHEN** staff attempts to review a booking that is not completion-confirmed, or a second review for the same booking
- **THEN** the submission is rejected with an explicit reason

### Requirement: Disputable reviews
A review SHALL be disputable: marking a review disputed hides it from display and
ranking pending staff decision, records the dispute reason, and is audit-logged.
Undisputing restores it. Disputed reviews never feed reliability metrics while
disputed.

#### Scenario: Review disputed
- **WHEN** staff marks a review as disputed with a reason
- **THEN** the review disappears from provider-facing and ranking surfaces, the reason and actor are stored, and the audit log records the dispute

### Requirement: Reliability metrics with minimum samples
The system SHALL compute per-provider reliability metrics — response rate, median
time to first response, completion rate, and average review score — from real
funnel data, and SHALL display each metric only once its minimum sample is met
(5 requests, 5 responses, 3 bookings, 3 reviews respectively). Below the minimum,
the metric shows as insufficient history and carries no ranking penalty. Metrics
SHALL exclude customer-caused cancellations from the provider's completion record.

#### Scenario: Provider above minimums
- **WHEN** a provider has 6 requests, 3 completed bookings, and 3 undisputed reviews
- **THEN** all four metrics are displayed with their sample sizes, the response and completion rates shown with a confidence indicator

#### Scenario: New provider shows no metrics
- **WHEN** a provider has fewer completed bookings than the minimum
- **THEN** the completion metric displays as insufficient history rather than a zero or a penalty

### Requirement: Reliability enters matching with read-back
Reliability SHALL enter the matching factor set through the append-only weights
mechanism, and the explainability read-back SHALL show the reliability component
with its underlying sample sizes. Providers without sufficient history SHALL
receive a neutral weight — history absence is never scored as a negative signal.

#### Scenario: Explainability shows reliability basis
- **WHEN** staff reads a match explanation for a provider whose reliability affects the ranking
- **THEN** the explanation names the reliability component and shows the sample sizes behind it, consistent with the weights version in effect

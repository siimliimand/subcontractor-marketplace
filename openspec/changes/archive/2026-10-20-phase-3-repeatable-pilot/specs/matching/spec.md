# Spec Delta

## Purpose

Close the loop: widening fires automatically on timeout instead of only by hand, ranking factors are fed by real outcomes (response, conversion, completion), weights become tunable without redeploy, and stored match factors become a readable "why this provider ranked here" panel.

## ADDED Requirements

### Requirement: Timeout-triggered widening
When a matching batch has been sent and no qualified response has arrived within a
configurable timeout, the system SHALL automatically widen once toward the widened
batch size, recording `matched` with channel `automated` and the widening reason.
Manual widening remains available; automatic widening SHALL fire at most once per
request and never after a qualified response exists.

#### Scenario: Silence past the timeout
- **WHEN** the scheduled check finds a request in outreach past the timeout with no
  qualified response and no prior widening
- **THEN** the system widens the batch toward 10 with an audit event naming the
  timeout as the reason

#### Scenario: Already answered
- **WHEN** the timeout elapses but a qualified response already arrived
- **THEN** no widening fires

#### Scenario: Widening already done
- **WHEN** the batch was already widened manually
- **THEN** the scheduled check takes no action

### Requirement: Outcome-driven factor inputs
The response-history factor SHALL be computed from the provider's actual response
rate and median response time, and the reliability factor from completion versus
accepted-but-not-delivered outcomes and cancellations, over the provider's recorded
history. Providers with no history score zero on these factors and the missing flag
is shown — the ranking never assumes quality from absent data, and payment never
influences rank.

#### Scenario: Reliable veteran vs unproven newcomer
- **WHEN** a provider with ten completed bookings and no failures is ranked against a
  provider with no history
- **THEN** the veteran's reliability factor scores higher and the newcomer's factor
  is shown as missing rather than defaulted

### Requirement: Tunable weights
Ranking weights SHALL be configurable at runtime (staff-readable; changes limited to
staff with a recorded reason), so pilot tuning does not require redeploy. The active
weights used for each match SHALL be stored with the match results.

#### Scenario: Pilot tuning session
- **WHEN** staff updates a weight with a reason
- **THEN** subsequent matches use the new weights and the match record shows which
  weights were applied

### Requirement: Post-hoc explainability
The stored match factors on an outreach entry SHALL be viewable afterwards ("why this
provider ranked here") showing per-factor contribution, inputs, and missing flags, as
of the time the match was made.

#### Scenario: PM asks why a provider was contacted
- **WHEN** staff opens the outreach panel on a matching-channel entry
- **THEN** the factor breakdown stored at match time is displayed, including which
  data was missing

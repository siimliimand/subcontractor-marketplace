# Matching Specification

## Purpose

Select which providers get contacted for a request: hard eligibility filters, a transparent weighted ranking computed only from data that exists, a diversity rule, and batch sizing with widening on timeout — replacing purely manual provider picks.

## Requirements

### Requirement: Hard-filter candidate selection
For each required trade of an approved request, the system SHALL select candidate providers that (a) have status `active`, (b) offer the required trade as a service, (c) whose service area includes the request location, and (d) have indicated availability covering the requested dates. Providers failing any filter MUST be excluded, and every exclusion MUST be attributable to a specific failed filter.

#### Scenario: Provider outside service area is excluded
- **WHEN** a matching run selects candidates for a request located in Tallinn and a provider offering the required trade only covers Tartu
- **THEN** that provider is not a candidate and the exclusion reason is the location filter

#### Scenario: No availability declaration is not a hard exclusion
- **WHEN** a matching run selects candidates and a provider has no availability declaration for the requested dates
- **THEN** the provider is treated as availability-unknown and its capacity ranking factor scores zero, rather than being filtered out

### Requirement: Weighted ranking with stored factors
The system SHALL rank candidates by a transparent weighted score: confirmed capacity 25%, trade specialisation depth 20%, response history 15%, reliability 15%, proximity 10%, review quality 10%, price fit 5%. Each factor MUST be computed only from data that exists; a factor with no supporting data MUST contribute zero and be marked as missing. The score and per-factor breakdown MUST be stored with each generated outreach entry.

#### Scenario: Ranking uses only available data
- **WHEN** candidates are ranked and no provider has review data yet (Phase 2: no reviews exist)
- **THEN** the review-quality factor contributes zero for all candidates and is reported as missing, and ranking is decided by the remaining factors

#### Scenario: Factor breakdown is stored
- **WHEN** a matching run generates an outreach entry for a provider
- **THEN** the entry stores the total match score and each factor's raw inputs and weighted contribution

### Requirement: Ranking explainability
Staff SHALL be able to see, for any candidate in a matching run, why the provider ranks where it does: the factor weights, each factor's contribution and which inputs were missing. Ranking MUST NOT be influenced by any payment or promotion state.

#### Scenario: Explain a provider's rank
- **WHEN** staff opens the candidate list of a matching run
- **THEN** each provider is shown with its rank, score and a readable factor breakdown including missing-data flags

### Requirement: Diversity rule
An initial matching batch MUST NOT contain more than 2 candidates with the same specialisation within the required trade. The next-ranked candidates of other specialisations fill the batch instead.

#### Scenario: Batch limited per specialisation
- **WHEN** the top 5 ranked candidates include 4 providers with the same specialisation
- **THEN** the initial batch contains at most 2 of them and the remaining slots go to the next-ranked candidates of other specialisations

### Requirement: Batch sizing, widening and stopping
For each required trade the system SHALL generate an initial batch of up to 5 ranked candidates. On timeout without sufficient qualified responses, outreach MAY be widened once toward 10 candidates. Batch generation MUST be refused for requests in `booked` or `cancelled` status, and no new batches MUST be generated once the request has a confirmed booking or is cancelled.

#### Scenario: Initial batch generated
- **WHEN** staff runs matching for an approved multi-trade request with two required trades
- **THEN** up to 5 outreach entries per trade are generated in one batch each, carrying the match score and factors

#### Scenario: Stop after booking
- **WHEN** a request becomes `booked` and a widening or new batch is attempted
- **THEN** the system refuses generation because the request is closed for outreach

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

### Requirement: Reliability factor with sample-size neutrality
Ranking SHALL include a reliability factor fed by reviews and booking outcomes,
versioned through the append-only weights mechanism. Providers without sufficient
history SHALL receive a neutral weight, and the factor SHALL never rank by payment.

#### Scenario: Weight version adds reliability
- **WHEN** a new weights version introduces the reliability factor
- **THEN** previously stored match explanations remain attributable to their original weights version

#### Scenario: Insufficient history is neutral
- **WHEN** a provider below the reliability sample minimums is ranked
- **THEN** the reliability factor contributes neither advantage nor penalty

### Requirement: Region-aware ranking
When a request declares a region, ranking SHALL restrict candidates to providers
that cover that region or have declared no coverage, and the read-back SHALL state
which region filter applied. Requests without a region SHALL rank exactly as before.

#### Scenario: Region restricts candidates
- **WHEN** a request declares region "tartu" and one candidate provider covers only "harju"
- **THEN** the harju-only provider is excluded from the ranked shortlist and the explanation notes the region filter

#### Scenario: Coverage-optional providers stay eligible
- **WHEN** a request declares a region and a candidate has declared no coverage
- **THEN** the candidate remains eligible under the region filter

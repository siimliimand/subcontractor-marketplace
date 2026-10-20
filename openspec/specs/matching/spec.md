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

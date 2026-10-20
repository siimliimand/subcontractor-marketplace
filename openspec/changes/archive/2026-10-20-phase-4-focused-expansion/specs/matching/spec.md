# Spec Delta

## ADDED Requirements

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

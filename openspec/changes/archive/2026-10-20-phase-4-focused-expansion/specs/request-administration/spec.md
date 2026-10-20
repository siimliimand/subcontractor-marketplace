# Spec Delta

## ADDED Requirements

### Requirement: Optional region on requests
Request creation SHALL accept an optional region reference, validated against the
region catalog, stored with the request, and shown on request views. The field
SHALL be optional and its absence SHALL leave all downstream behaviour unchanged.

#### Scenario: Request saved with region
- **WHEN** an approved request is created with region "harju"
- **THEN** the request view shows the region and downstream matching receives it

#### Scenario: Region omitted
- **WHEN** a request is created without a region
- **THEN** creation succeeds and behaves exactly as requests did before this change

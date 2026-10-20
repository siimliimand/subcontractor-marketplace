# Spec Delta

## Purpose

Extend the outreach log so match-generated entries carry their ranking rationale onward: staff can re-open the "why this provider ranked here" breakdown from the entry itself, as of match time.

## ADDED Requirements

### Requirement: Explainability read-back on outreach entries
For outreach entries with channel `matching`, the outreach panel SHALL expose the
stored factor breakdown (per-factor contribution, inputs, missing flags, and the
weights applied at match time) without recomputation.

#### Scenario: Reviewing last week's batch
- **WHEN** staff opens a matching-channel entry created before the current weights
- **THEN** the panel shows the breakdown as stored at match time, including the
  then-active weights

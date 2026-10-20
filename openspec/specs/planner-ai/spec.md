# Planner AI Specification

## Purpose
A bounded subcontractor planner: draft trade/staffing plans for approved requests,
grounded in the platform's own historical booking data — flag-gated until enough
real project data exists to evaluate proposals, with feedback capture building
that evaluation dataset.

## Requirements

### Requirement: Draft plan generation for approved requests
Staff SHALL be able to request a draft plan for an approved request. The plan
SHALL suggest required trades and team sizes grounded in the platform's historical
booking data for similar requests, SHALL be clearly labelled a draft, and SHALL
never book, hold, or message anyone on its own.

#### Scenario: Plan generated from history
- **WHEN** staff requests a draft plan for an approved multi-trade request
- **THEN** the returned plan names suggested trades and team sizes with a reference to the historical data it drew on, and is stored with generation metadata

#### Scenario: Planner never acts
- **WHEN** a draft plan is generated
- **THEN** no booking, hold, or outreach is created as a side effect

### Requirement: Guardrails on availability and scope
Plan generation SHALL be disabled unless its flag is explicitly enabled, SHALL
accept only approved requests, and SHALL degrade gracefully when the AI binding or
historical data is unavailable — an explicit error, never a fabricated plan. Each
generation is audit-logged.

#### Scenario: Flag off
- **WHEN** the planner flag is disabled and staff requests a plan
- **THEN** the request is rejected as unavailable

#### Scenario: Unavailable grounding data
- **WHEN** generation is invoked but no comparable historical bookings exist
- **THEN** the response states that grounding data is insufficient rather than producing an ungrounded plan

### Requirement: Feedback capture
Staff SHALL be able to mark a generated plan as useful or not, with an optional
comment. Feedback SHALL be stored with the plan and counted, so the accumulated
dataset can support the plan's evaluate-before-expanding gate.

#### Scenario: Feedback recorded
- **WHEN** staff marks a plan not useful with the comment "team size too high"
- **THEN** the feedback is stored against the plan and included in feedback counts

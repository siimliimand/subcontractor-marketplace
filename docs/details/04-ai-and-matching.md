# 04 — AI and Matching

Companion to [plan.md](../plan.md) §5.

## Principles

AI makes the marketplace easier to use and better at matching. It is not the reason we build the business. People always confirm before anything is sent or booked. The first version of matching uses transparent, deterministic rules wherever possible.

## Brief builder (MVP)

A PM describes a job in natural language — *"we need an electrical subcontractor for an apartment renovation in Tallinn next month"* — and the system proposes a structured brief:

- Type and scope of work
- Location
- Desired start date and duration
- Required trade and qualifications
- Estimated crew size
- Budget or pricing expectations, if known
- Materials and equipment responsibilities
- Site access and working conditions
- Relevant documents or compliance requirements

Missing information is **flagged, never invented**. The PM reviews and approves the brief before distribution.

## Matching and ranking

### Step 1 — Hard filters (elimination)

- Trade match: provider must offer the required trade.
- Location: provider service area must include the project location.
- Schedule: provider must have indicated availability for the requested dates.

### Step 2 — Ranking (weighted scoring)

| Factor | Weight | Data source |
|---|---|---|
| Confirmed capacity | 25% | Provider availability declarations |
| Trade specialisation depth | 20% | Profile completeness and project history |
| Response history | 15% | Past response rate and speed |
| Reliability score | 15% | Completion rate and cancellations |
| Proximity to site | 10% | Service area and project location |
| Review quality | 10% | Verified reviews from past bookings |
| Price fit | 5% | Stated pricing approach vs budget |

### Step 3 — Diversity rule

Limit initial outreach to at most 2 providers with the same specialisation, to avoid over-concentration.

### Step 4 — Learning loop

Track which providers respond, convert to bookings and complete successfully. Adjust weights based on actual outcomes, not assumptions.

### Explainability

The platform shows why each provider ranks where it does. A provider must not rank highly merely because of a polished profile — and never because it pays for promotion.

## Targeted outreach

Send the request to the **top 5** strong matches first; widen toward **10** only if there is insufficient interest within a defined time. Exact numbers and timeouts are tuned in the pilot.

System behaviour:

- Limit irrelevant notifications.
- Avoid repeatedly contacting the same provider unnecessarily.
- Track which providers received each request (outreach log).
- Stop outreach when the request is filled or cancelled.
- Show the PM the request status and what has been done.

**Why not broadcast:** sending to every match causes notification fatigue and teaches providers to ignore us.

## Subcontractor planner (later feature)

A provider describes a job in detail; AI proposes how many subcontractors and which trades are needed. The provider edits the proposal and confirms before any search starts.

This waits until the core marketplace works and there is enough real project data to evaluate recommendations.

## Subcontractor chain

A subcontractor can itself be a provider with its own subcontractors — one data model serves both roles (see [02-user-flows.md](02-user-flows.md)).

## AI safeguards

- AI briefs and estimates are suggestions, never commitments; they show their reasoning.
- Nothing is sent to providers and no booking is made without a person's confirmation.
- AI proposals and user edits are logged, to learn where the AI is wrong.
- Matching must not treat unverified information as fact.
- Sensitive project and worker data is not sent to AI services without an appropriate legal and security basis.

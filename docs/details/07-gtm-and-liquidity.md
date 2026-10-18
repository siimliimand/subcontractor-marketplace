# 07 — Go-to-Market and Liquidity

Companion to [plan.md](../plan.md) §8.

A marketplace has a cold-start problem: PMs need useful providers, providers need meaningful requests. We solve it in one narrow segment with a high level of personal involvement, and we **build supply first** — customers arrive only when search results are good.

## Phase 1 — Customer discovery

Interview ~10 project managers and ~15 contractors/subcontractors. Focus on recent real examples, never hypothetical interest.

**Questions for PMs**

- Tell us about the last time you needed a subcontractor urgently.
- How did you find potential providers? How many did you contact?
- How long did it take to receive a useful response?
- What caused delays or failed commitments?
- How do you verify qualifications and availability?
- Which part of the process creates the greatest cost or risk?
- Would you use an external platform alongside your existing contacts? Why or why not?

**Questions for providers**

- How do you currently find new projects?
- How far ahead can you reliably estimate team availability?
- Which types of requests are worth responding to? What makes you reject one?
- What information do you need before quoting?
- How much administrative work would you accept in exchange for relevant leads?
- Would you share capacity information, and under what conditions?

**Interview scorecard** (score 1–5, evidence required for each):

| Dimension | Evidence required |
|---|---|
| Problem frequency | How often does this occur? |
| Problem severity | What is the cost of the problem? |
| Current solution satisfaction | How satisfied are they with the current approach? |
| Willingness to change | What would make them switch? |
| Decision authority | Can they adopt a new tool? |
| Willingness to pilot | Will they commit to testing? |

## Phase 2 — Anchor customers

Recruit 3–5 PMs at larger firms as design partners. They test with real requests and give structured feedback, and **import their own preferred subcontractors** so the platform is useful on day one, before the open marketplace is dense.

Seek commitments to run pilot transactions — not expressions of interest.

**Design partner agreement covers:**

- Minimum number of requests during the pilot (e.g. 3–5).
- Structured feedback after each request.
- Permission to use anonymised data for product improvement.
- Weekly check-in calls.
- Optional: willingness to be referenced as an early customer if the pilot succeeds.

## Phase 3 — Build and verify supply

Personally recruit providers in the six pilot trades. **Pre-seed provider profiles from public registers** (Äriregister activity codes) and invite providers personally; listing is free.

Target: **30+ active providers**, balanced across trades — 30 providers concentrated in one trade is not a marketplace.

| Trade | Minimum providers | Rationale |
|---|---|---|
| Electrical | 6 | Highest-demand trade in fit-out |
| Plumbing | 5 | Essential for most projects |
| HVAC | 4 | Specialised; fewer providers |
| Drywall / partitions | 5 | High volume; multiple crews needed |
| Flooring | 4 | Common; schedulable flexibly |
| Painting / finishing | 6 | High volume; many small providers |
| **Total** | **30** | Balanced coverage |

A provider counts as **active** only if: profile usable, contact details valid, recently confirmed willingness to receive suitable requests.

## Phase 4 — Concierge pilot

Run the first requests with partial manual support: we help clarify briefs, contact providers, follow up on responses and record outcomes. This is intentional — it teaches us how matching should work before we automate.

Manual intervention is tracked, so we can distinguish product performance from founder effort.

| Concierge metric | Why it matters |
|---|---|
| Team hours per request | Baseline for automation ROI |
| Number of manual interventions | Automation priorities |
| Provider contact attempts per request | Matching accuracy |
| Reasons for provider declines | Improves eligibility filters |
| Customer satisfaction despite manual work | Tests the underlying value proposition |

## Phase 5 — Repeat and automate

Once the core workflow succeeds, progressively automate: request structuring, provider filtering, targeted outreach, availability updates, booking confirmations, reporting and follow-up.

Expand to more trades and regions **only when** the current segment produces repeat use and reliable outcomes.

## Keeping both sides on the platform

Once two parties meet, they can deal directly next time. The reasons to stay: the booking system and capacity view, document storage, booking history and the audit trail. Retention comes from usefulness, not from making it hard to leave — see [09-monetization.md](09-monetization.md).

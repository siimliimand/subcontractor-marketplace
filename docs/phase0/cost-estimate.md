# 0.8 — Cost Estimate: Build + Runway to Gate 3

**Date:** 18 October 2026 · Basis: Decision 4 (solo founder + AI-assisted build,
bootstrapped), Decision 1 segment, Decision 5 (existing OÜ). Prices from vendor pages
checked 18 Oct 2026; Cloudflare prices are the paid-plan published rates.

## Cash costs until Gate 3 (~4–6 months calendar)

| Item | One-off | Monthly | Notes |
|---|---|---|---|
| Cloudflare Workers Paid | — | **$5** | Includes Workers, D1 (25 GB free tier), Queues, Workers AI daily allocation; Access free ≤50 users |
| Cloudflare Email Service | — | ~$1–5 | Transactional sending; pilot volume ≈ hundreds of emails/wk |
| Domain (if not reusing rajahinta.fi) | ~€15/yr | — | e.g. sending subdomain on existing domain = €0 |
| Registers (Äriregister API, MTR open data) | €0 | €0 | Free per 0.3 findings; RIK contract is no-charge |
| Smart-ID | €0 | €0 | Deferred past Gate 3 |
| Lawyer: ToS + GDPR + DPA review | **€500–1,500** | — | Decision 5 gate: before real provider data |
| Design: cockpit UI already built; PM/provider UI by founder + templates | €0 | — | Tailwind + existing patterns |
| Equipment/software | €0 | — | Existing laptop; all tooling free-tier (GitHub Actions CI public repo) |
| **Total cash** | **~€500–1,500** | **~€7–12/mo** | **≈ €550–1,600 to Gate 3** |

## The real cost: founder time (non-cash)

| Workstream | Estimate | When |
|---|---|---|
| Interview guides + recruiting 10 PMs + 15 contractors | 30–40 h | Weeks 1–2 |
| 25 interviews + scoring + synthesis | 50–60 h | Weeks 2–4 |
| Design-partner agreements + provider recruitment list | 20 h | Weeks 2–4 |
| Engineering (AI-assisted: email pipeline, P0 slice, booking core, AI briefs) | 60–80 h founder-supervision | Weeks 3–8, overlaps discovery |
| Concierge ops (≥5 then ≥10 real requests, onboarding providers) | 60–100 h | Weeks 5–12 |
| Weekly cadence (metrics Monday, demo Friday) | 24 h | Ongoing |
| **Total** | **~250–320 h over ~4–6 months** | ≈ 10–13 h/wk average |

## Runway / kill-cost framing

- Worst case (kill at Gate 1): ~2 months, ~€6 cash burned + ~70 h → cheap lesson, per plan.
- Worst case (kill at Gate 3): full €550–1,600 + ~300 h, and the cockpit + email pipeline
  remain as usable assets (the operator keeps a working request-log tool regardless).
- No external funding assumption anywhere on this path; nothing blocks on cash.

## Explicitly out of these estimates (Phase 4+ only)

Calendar sync vendor work, Smart-ID per-transaction volume, register-derived features
needing legal opinions beyond the one budgeted, R2 document storage (negligible if used),
paid marketing (none — supply-first GTM is manual).

## Budget checkpoints (per implementation plan cross-cutting track)

- End of Phase 1: review spend vs this table; lawyer invoice lands here
- End of Phase 3: monetisation inputs for the paid-booking decision (≥2 willing partners)

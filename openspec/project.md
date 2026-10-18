# Project Context

## Project

Estonian construction subcontractor marketplace — a platform where project managers (PMs) at construction/fit-out firms find subcontractors who are **actually free**, and trade crews receive relevant jobs without paying to be listed.

- **Market:** Estonia, starting with Tallinn and Harju County
- **Pilot segment:** interior fit-out; six trades — electrical, plumbing, HVAC, drywall, flooring, painting
- **Stage:** pre-validation / pre-MVP (no code yet; planning docs complete)
- **Master plan:** `docs/plan.md` (business), `docs/implementation-plan.md` (phased execution), details in `docs/details/01`–`10`

## What makes this product different

- **Capacity, not calendars:** booking system models *people per skill per day* (confirmed / tentative / unconfirmed states), not busy/free.
- **Email-first provider responses:** one-click Accept / Quote / Decline via single-use expiring tokens; no login required. Email flow doubles as the adoption funnel into the booking system.
- **Targeted outreach, never broadcast:** requests go to top 5 ranked matches, widening toward 10 only on timeout. Outreach is a first-class entity (batches, throttling, opt-outs).
- **AI assists, humans confirm:** brief builder drafts structured requests (missing info flagged, never invented); nothing is sent or booked without a person confirming.
- **Trust from Estonian registers:** Äriregister, tax debt, MTR, Smart-ID — each access must be checked for terms before building.

## Current focus

Following `docs/implementation-plan.md`:

- Phase 0 — partner decisions, legal/GDPR kickoff, register access research, infra + analytics event schema
- Phase 1 (wks 1–4) — discovery interviews + foundations: concierge cockpit (internal admin console), email pipeline, funnel analytics
- Gate 1 before any customer-facing build: ≥7/10 PMs report significant pain, ≥3 design partners, ≥15 providers willing

## Tech stack (hard constraint: Cloudflare only)

**The project MUST run entirely on Cloudflare services. No external vendors or APIs.**

- App hosting: Cloudflare Workers (+ Static Assets for the React frontend)
- API framework: Hono (TypeScript) on Workers
- Database: Cloudflare D1 (SQLite) — Drizzle ORM + drizzle-kit migrations
- Authentication (staff/internal): Cloudflare Access (Zero Trust) with JWT validation
- Document storage (later): R2 with `eu` jurisdiction
- Background/scheduled work (later): Cron Triggers, Queues, Workflows
- AI (later, brief builder): Cloudflare Workers AI
- Email (later): Cloudflare Email Service — transactional sending (`send()` binding, SMTP, REST), delivery/bounce events via Queues event subscriptions, suppression lists; open/click tracking self-hosted on Workers
- Data residency: EU — D1 EU location, R2 `eu` jurisdiction, Data Localization Suite where available

## Build vs buy

Build: availability/capacity model, matching algorithm, provider profiles. Platform services all come from Cloudflare (Access, D1, R2, Workers AI, Email Service). Defer: calendar sync (Google/Outlook).

## Core domain invariants

- **Cloudflare-only:** every new dependency must be a Cloudflare service; external SaaS/API calls are not allowed in production code.

- **First confirmed wins:** the database must prevent the same capacity being committed twice; earlier confirmed booking prevails.
- **Empty calendar ≠ free capacity.** Freshness rules: <7d current, 7–14d aging, 14–30d stale, >30d expired.
- **An empty/unknown state is never presented as confirmed.** Email-only providers are labelled "Unconfirmed".
- **Analytics completeness:** a feature is not done until its funnel events fire. Full funnel: `request_created → brief_approved → matched → outreach_sent → email_opened → response_received → qualified_response → quote_submitted → booking_requested → booking_confirmed → work_started → completion_confirmed → review_submitted`. Every step records actor, timestamp, and manual-vs-automated.
- **Monetization rule:** listing and basic matching are free for providers; the booking system interface is the paid part. Nothing else decided.

## Out of MVP scope

Calendar synchronisation, complex workforce scheduling, multi-trade requests, quote comparison side-by-side, tax debt / MTR / Smart-ID verification, reviews tied to bookings, subcontractor planner AI, multi-user company accounts, promoted listings, multi-country.

## Glossary (short)

- **Eligible request** — approved by PM, matched to ≥1 active provider, not customer-cancelled
- **Qualified response** — eligible provider response with availability + quote or concrete interest
- **Active provider** — usable profile, valid contact, recently confirmed willingness to receive requests
- **Design partner** — signed pilot commitment (3–5 requests + structured feedback)
- **Accepted-but-not-delivered** — confirmed booking where the crew did not show

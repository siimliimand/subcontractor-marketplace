# 06 — MVP Scope and Architecture

Companion to [plan.md](../plan.md) §7.

## MVP principle

The MVP is the smallest product that lets real customers submit requests, receive relevant responses, confirm capacity and evaluate outcomes. Learning and successful transactions beat feature completeness.

## Scope in / out

| Area | In the MVP | Later |
|---|---|---|
| Providers | Free profile: services, area, price and pricing model | Promoted listings, documents with expiry reminders |
| Requests | Filter and AI chat that builds a structured brief | Multi-trade requests, side-by-side quote comparison |
| Matching | Ranked matching, top 5–10 notified, one-click Accept / Quote / Decline by email | Ranking tuned with real reliability data |
| Availability | Built-in booking system with capacity per day; email fallback for non-users | Google/Outlook calendar sync, reschedule flows |
| Trust | Business register check | Tax debt, activity register, Smart-ID, reviews tied to bookings |
| AI | Brief builder, ranking | Subcontractor planner |
| Companies | Request, response and booking log | Multi-user accounts, exportable audit trail |

Also excluded from the MVP: complex workforce scheduling, automated subcontractor chain management, advanced predictive AI, automated e-invoicing, enterprise procurement integrations, paid promoted listings, automated compliance verification across every trade, multi-country expansion.

## Feature prioritisation

| Feature | User value | Build effort | Priority |
|---|---|---|---|
| Structured request form | High | Medium | P0 |
| Provider profiles | High | Medium | P0 |
| Basic matching (trade + location + availability) | High | Medium | P0 |
| Email response flow | High | Low | P0 |
| Availability declaration + booking confirmation | High | Medium | P0 |
| AI brief builder | Medium | Medium | P1 |
| Verification badges | Medium | Low | P1 |
| Internal admin dashboard | Medium | Medium | P1 |
| Response comparison view | Medium | Medium | P1 |
| Basic reporting | Low | Low | P2 |

## Build vs buy

Our advantage comes from the construction-specific workflow, capacity data, matching quality and provider network — not from generic infrastructure.

**Hard constraint: the project runs entirely on Cloudflare services. No external vendors or APIs.** Account is a paid plan.

| Component | Recommendation | Rationale |
|---|---|---|
| Availability/capacity model | **Build** | Core differentiator; must reflect construction reality |
| Matching algorithm | **Build** | Core differentiator; construction-specific |
| Provider profiles | **Build** | Core data asset |
| App hosting | Cloudflare Workers (+ Static Assets) | Constraint; paid plan |
| Database | Cloudflare D1 (SQLite), EU location | Constraint; relational integrity; Time Travel backups |
| Authentication | Cloudflare Access (staff) now; email-token flows (providers) later | Staff-only cockpit maps to Access; no custom auth |
| Email | Cloudflare Email Service | Transactional sending to arbitrary recipients after domain onboarding; delivery/bounce events via Queues; suppression lists built in. Open/click tracking self-hosted on Workers |
| AI text processing | Cloudflare Workers AI | Constraint; brief building is not latency-critical |
| Document storage | Cloudflare R2, `eu` jurisdiction | Constraint; S3-compatible API |
| Background work (later) | Cron Triggers, Queues, Workflows | Constraint; paid plan |
| Calendar integration | **Defer** | Not needed for MVP; evaluate after pilot |

Booking system build-vs-adapt is an explicit partner decision (see [03-booking-and-availability.md](03-booking-and-availability.md)); working recommendation is to build the capacity model and adapt or buy only generic calendar plumbing.

## Technical architecture

- **Frontend:** React (Vite) served via Workers Static Assets, mobile-responsive.
- **API:** Hono (TypeScript) on Cloudflare Workers.
- **Database:** Cloudflare D1 (SQLite) with Drizzle ORM + drizzle-kit migrations.
- **Authentication:** Cloudflare Access (Zero Trust) for staff; validated Access JWTs in middleware.
- **AI:** Cloudflare Workers AI for brief building.
- **Email:** Cloudflare Email Service — `send()` binding (SMTP and REST also available), lifecycle events (`message.delivered`, bounces) via Queues event subscriptions, suppression list; self-hosted open/click tracking pixel on Workers.
- **Hosting/residency:** Cloudflare only; D1 EU location, R2 `eu` jurisdiction, EU worker placement.

## Core data entities

- **Company** — legal identity, contact information, verification status.
- **User** — identity, company relationship, role, permissions.
- **Service** — trade, skills, service area, pricing approach and pricing model, qualifications.
- **Availability declaration** — skills, worker counts, date ranges, channel (booking system / calendar / email), last confirmation timestamp.
- **Request** — scope, location, schedule, budget, required qualifications, status.
- **Match** — eligible provider, ranking factors and scores.
- **Outreach / notification** — which providers were contacted, batch number, send and expiry timestamps, throttling, opt-outs. First-class entity, not a log line: outreach rules and notification fatigue depend on it.
- **Response** — interest, quote, capacity declaration, decline reason, timestamp.
- **Booking** — agreed scope, dates, capacity, confirmation status, holds, changes.
- **Document** — type, owner, validity period, access permissions.
- **Review and outcome** — booking reference, completion status, feedback, disputes.
- **Audit event** — status changes, authorisations, timestamps.

## Analytics instrumentation (build in from day one)

Pilot metrics cannot be reconstructed later — log the full funnel from the first request:

`request_created → brief_approved → matched → outreach_sent → email_opened → response_received → qualified_response → quote_submitted → booking_requested → booking_confirmed → work_started → completion_confirmed → review_submitted`

Include actor, timestamps, and whether a step was manual (concierge) or automated, so manual effort per booking is measurable (see [08-metrics-and-pilot-gates.md](08-metrics-and-pilot-gates.md)).

## Security and privacy

- Collect only data the workflow needs.
- Worker names and schedules are personal data under GDPR — keep worker-level information private unless sharing is necessary and legally justified; share the minimum with customers.
- Role-based access; secure, expiring, single-use email-action tokens.
- Protect sensitive documents and credentials; maintain audit logs for important actions.
- Establish retention and deletion policies.
- Never share one customer's confidential project details with unrelated providers.

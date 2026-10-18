## Context

Greenfield: no code, no repo, no Cloudflare resources yet. The cockpit is a staff-only internal tool used to run the concierge pilot (create providers and requests, log outreach, record responses and outcomes, measure manual effort). Pilot scale is small and known: 3–5 design partners, 30+ providers, tens of requests over 12 weeks.

**Hard constraint:** the entire project must run on Cloudflare services — no external vendors or APIs. The account is a paid plan (Queues, Workflows, higher D1/R2 limits available). This constraint supersedes earlier vendor examples in the planning docs.

## Goals / Non-Goals

**Goals:**

- Staff can run the full concierge workflow without spreadsheets or inboxes.
- Every mutation is captured as an immutable audit/funnel event with actor, timestamp and manual/automated flag — pilot metrics are queryable from day one.
- Ship inside Phase 1 (≤2 engineer-weeks including repo, deploy and Access setup).
- Establish the data-model and event conventions every later feature (matching, booking, email responses) builds on.

**Non-Goals:**

- Customer-facing UI, provider self-service, public profiles.
- Email sending (separate change), AI brief builder, matching engine, booking engine with holds/conflicts.
- Multi-role company accounts, promoted listings, monetization.

## Decisions

**D1 — Single Worker app: Hono API + React SPA on Static Assets.**
One Worker serves the API (Hono, TypeScript) and the frontend (React built with Vite, served via Workers Static Assets). *Alternatives:* Next.js via the OpenNext Cloudflare adapter (heavier build, adapter maturity risk for an internal tool), server-side rendering (unnecessary for a cockpit), separate Pages project (two deploy units, no benefit). React is kept from the original plan; Next.js is dropped — the adapter adds risk without benefit here.

**D2 — Cloudflare Access for staff authentication.**
The cockpit is staff-only, which maps exactly to Cloudflare Access (Zero Trust): Access sits in front of the Worker; the app validates the `Cf-Access-Jwt-Assertion` JWT (signature, audience, email) in middleware and maps the email to a `users` row (role `staff`), auto-provisioning on first login. *Alternatives:* custom password/session auth (code + liability for zero product value), Access service tokens (no per-person identity, breaks actor attribution). Team membership is managed in the Zero Trust dashboard, not in app code. Paid account confirmed — no plan gating.

**D3 — D1 (SQLite) with Drizzle ORM + drizzle-kit migrations.**
Relational data with referential integrity (providers → services → requests → responses → bookings → events) rules out KV. Hyperdrive + external Postgres is banned by the constraint. *Alternatives:* raw SQL migrations + query builder (fine, but we lose typed schema without much gain), Prisma (heavier runtime, D1 driver still maturing). D1 limits are comfortable at pilot scale; single-writer contention is acceptable for an internal tool. Migration story: `drizzle-kit generate` → versioned SQL in repo → `wrangler d1 migrations apply` per environment. Time Travel gives point-in-time recovery.

**D4 — Append-only audit/funnel events in D1, written transactionally.**
Every mutation goes through one helper that executes the write and the event insert in the same D1 batch: `actor_user_id, occurred_at, entity, entity_id, action, payload_json, channel ('manual' | 'automated')`. Cockpit actions default to `manual`. Action names are a fixed enum mirroring the 13-step funnel taxonomy (`request_created`, `request_approved`, `matched`, `outreach_sent`, `response_received`, `qualified_response`, `quote_submitted`, `booking_confirmed`, `completion_confirmed`, `request_cancelled`, plus auth/admin events). *Alternatives:* Workers Analytics Engine (high-volume, but poor joins with entities and no transactional guarantees — wrong tool for the system of record), logpush (operational logs, not queryable business events).

**D5 — Dashboard v0 = SQL over D1, rendered server-side.**
The weekly-dashboard questions (request success rate, median time to first qualified response, booking conversion, manual effort, supply by trade) are parameterised SQL queries over the event and entity tables, rendered as read-only HTML pages. Denominator rules (customer-cancelled excluded from success rate; open requests excluded from conversion) live in these queries. Business-hours math uses `Europe/Tallinn`. *Alternatives:* a BI tool (external — banned), Analytics Engine (see D4). If event volume ever outgrows D1 aggregates, a later change can move reporting reads to a replica — writes keep the same schema.

**D6 — Identity and IDs.**
UUIDv4 (text) primary keys for all entities — safe to expose in URLs and merge across environments later. Timestamps stored as UTC ISO-8601 text (SQLite-friendly, sortable).

**D7 — Environments and deploy.**
Two Wrangler environments — `staging` and `production` — each with its own D1 database and Access application; Access policy is exercised on staging before production. Deploy via `wrangler deploy`; secrets via `wrangler secret put` (e.g. Access team domain, audience). A git repository is initialised as part of this change (the working directory is not yet one). CI is deferred — deploys are manual until the pilot proves the need.

**D8 — EU residency.**
D1 database created with EU location hint; when R2 arrives it uses the `eu` jurisdiction; worker placement stays in EU regions. Whether the account needs the Data Localization Suite (EU-only) beyond location hints is an open question for the partner meeting — GDPR exposure in the cockpit is limited (provider business contacts, no worker personal data yet).

## Risks / Trade-offs

- [D1 single-writer contention] → Pilot scale is tens of requests; monitor D1 metrics; acceptable. If booking volume grows, the booking-engine change must design for serialised writes on capacity rows.
- [Email sending is viable but needs operational care: Cloudflare Email Service supports arbitrary recipients after domain onboarding, with delivery/bounce events via Queues and suppression lists; however a new sending domain starts with a conservative daily quota and no reputation, and there is no native open tracking] → Onboard the sending subdomain early and warm it up before pilot volume; build open/click tracking as Workers pixel + redirect links; use `message.delivered`/bounce Queues events as `email_opened`/failure inputs. Confirmed by docs research Oct 2026 — the earlier "Email Workers can only forward" concern no longer applies.
- [Vendor lock-in] → Accepted deliberately (project constraint). Mitigate cheaply where possible: standard SQL, plain TypeScript, no exotic D1 features in the data model.
- [Access misconfiguration locks staff out] → Configure and verify Access on staging first; production policy change only after staging login works; `wrangler rollback` for app-side incidents.
- [Drizzle + D1 maturity] → Escape hatch: any query can drop to raw SQL against the same schema.

## Migration Plan

Greenfield — no migration from existing systems. Sequence: init repo and Worker → create D1 (staging) → apply migrations → configure Access app + policy → deploy staging → verify end-to-end → create production D1 → deploy production. Rollback: `wrangler rollback` for code; D1 Time Travel for data. No deprecations.

## Open Questions

1. Which identity provider for Access (Google OTP, GitHub, email OTP) for the 3–5 team members? — partner meeting.
2. Is the Data Localization Suite (EU-only processing) needed beyond D1 EU location hints for pilot-stage GDPR comfort? — partner meeting / legal review.
3. Email operational details for the pipeline change: sending-subdomain choice (`send.<domain>`), warm-up schedule, open-tracking pixel design — input to the email-pipeline change, not a blocker here.

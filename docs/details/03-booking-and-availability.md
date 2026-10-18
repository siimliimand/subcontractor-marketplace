# 03 — Booking and Availability

Companion to [plan.md](../plan.md) §4.

## Why this is the core differentiator

The booking system is a must-have from day one: it is what turns a directory into a tool people return to. A conventional calendar shows busy/free; construction companies need to know **how many qualified workers are available, for which trade, at which location, for which period**.

Availability is also the hardest problem to solve reliably. The MVP therefore includes a deliberately small booking system — capacity per skill per day, simple holds and conflict tracking, email fallback — while calendar synchronisation and complex workforce scheduling wait.

## Availability channels

Providers choose how availability is shown:

1. **Built-in booking system** — full confirmed/tentative data, checked by the system.
2. **Connected calendar** — e.g. Google Calendar or Outlook; the system interprets it as capacity where possible.
3. **Email only** — no system; availability is assumed and asked by email (labelled "Unconfirmed").

## Availability states

| State | How it works | How it appears to the PM |
|---|---|---|
| **Confirmed** | Provider uses the booking system or a connected calendar; the system checks free people per day | "Available from [date], [n] workers free" |
| **Tentative** | Provider marked days as soft-free or has an open hold | "Tentatively free, may change" |
| **Unconfirmed** | Provider uses no system; availability assumed, asked by email | "Availability unconfirmed, will be asked by email" |

An empty calendar must never be interpreted as proof of free capacity. A positive response must not automatically be described as a booked commitment.

## Capacity freshness rules

| Time since last confirmation | Status | Display |
|---|---|---|
| < 7 days | Current | Confirmed availability |
| 7–14 days | Aging | Likely current; reconfirmation recommended |
| 14–30 days | Stale | Uncertain; reconfirmation required |
| > 30 days | Expired | Unknown; must be reconfirmed |

## Capacity model

Availability is modelled with:

- Provider and team
- Trade and relevant skills
- Number of workers
- Available dates and working hours
- Location and travel constraints
- Key equipment where relevant
- Existing commitments and confirmed bookings
- Last confirmation timestamp

Example: a company has eight workers in total, but only three qualified electricians available in a specific week. The system represents the relevant capacity — people by skill per day — not merely busy/free.

## MVP availability features

- Providers state the number of available workers by date or date range.
- Providers confirm availability in response to a specific request.
- Each response records when availability was last confirmed.
- The system distinguishes tentative from confirmed commitments.
- Customers request a booking and receive a confirmation.
- Booking conflicts and changes are recorded.
- Providers act through a mobile-friendly interface or secure email links.

## Booking rules

- **Holds:** a requested crew is reserved for a limited time (for example 48 hours) while the customer decides. Test whether time-limited holds are needed before making them a default.
- **Conflicts:** if two customers want the same crew, the first confirmed booking wins. The system prevents the same capacity being unknowingly committed twice within the platform.
- **Changes:** reschedule and cancel flows for both parties, because construction schedules slip. Cancellations are recorded and attributed.
- **External commitments:** the platform cannot know about bookings made outside the system. This limitation is communicated clearly; unconfirmed providers are labelled as such.
- **Reconfirmation:** required when the requested work date changes materially or availability data goes stale.

## Email fallback doubles as an adoption funnel

Providers without accounts are not blocked — they are the growth channel:

- One-click links (Accept / Quote / Decline) with secure single-use tokens and an expiry; no login required.
- The email also asks **how many people the provider can commit and from what date**, so a capacity picture builds even for non-users.
- After repeated successful interactions, offer the calendar view and signup. The email flow thus converts email-only providers into booking-system users.

## Build vs buy decision

**Decision for partners:** build the booking system ourselves, or start from an existing scheduling component and adapt it?

Working recommendation: the availability/capacity model is our core data asset and must reflect construction reality, so it is built. Generic calendar synchronisation and scheduling infrastructure are candidates to buy or defer. See [06-mvp-scope-and-architecture.md](06-mvp-scope-and-architecture.md) for the full build-vs-buy table.

## Explicitly out of MVP

- Google/Outlook calendar synchronisation (evaluate after the pilot).
- Complex workforce scheduling and automated conflict prevention across multiple teams.
- Reschedule flow automation beyond basic propose/confirm/recording.

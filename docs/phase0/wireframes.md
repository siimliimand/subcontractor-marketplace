# 0.7 — Key-Screen Wireframes (Phase 2 build reference)

**Status:** Draft v1. Four screens per plan.md §14. Text wireframes; the cockpit screens
(already live) are the interaction baseline — visual style follows the existing Tailwind
UI. Multi-trade requests are IN (decision log #3) and reflected here.

---

## 1. Provider onboarding (staff-assisted via cockpit first; self-serve later)

```
┌──────────────────────────────────────────────────────────────┐
│ New provider                                        [staff]  │
├──────────────────────────────────────────────────────────────┤
│ STEP 1 — Identity        [Auto-fill from Äriregister →]      │
│  Registry code [ 12823456 ]  [Look up]                       │
│  Name:        OÜ Elektrimees          (read-only, verified)  │
│  Status:      registered · active     ✓ badge source: RIKE   │
│  Contact:     email [ musta@elektrimees.ee ]                │
│               phone [ +372 …        ]                        │
│                                                              │
│ STEP 2 — Services (repeat per trade)                         │
│  Trade [electrical ▾]  Skills [ installations, panels  ]     │
│  Area  [Harju ▾]       Pricing model (hour | m² | project)   │
│  Rate range [ 35–50 €/h ]                                    │
│  MTR/Tarvik notification: [auto-checked ✓ valid to 2027-05]  │
│                                                              │
│ STEP 3 — Capacity baseline                                   │
│  Crew size [ 8 ]  Workers by trade: electrical [ 4 ]         │
│  Availability channel: (●) booking system ( ) email only     │
│  Next free window: [ 2026-11-03 ]  (fresher data wins later) │
│                                                              │
│              [Save provider]  → writes provider_created      │
└──────────────────────────────────────────────────────────────┘
```
Notes: registry look-up pre-fills step 1 and triggers the badge check (0.3 findings);
"email only" providers show the Unconfirmed label everywhere (details/03).

## 2. Request via AI brief builder (PM-facing, Phase 2)

```
┌──────────────────────────────────────────────────────────────┐
│ New request                                                  │
├──────────────────────────────────────────────────────────────┤
│ Describe the work in your own words:                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ "need to rewire 400 m² office floor in Ülemiste, start   │ │
│ │  in ~3 weeks, evenings OK"                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                        [Draft the brief ✨]  │
│ ──────────────────────────────────────────────────────────── │
│ AI-drafted brief — edit anything before approving:           │
│  Trades:   electrical · drywall      [multi-select]          │
│  Location: Tallinn, Ülemiste                                 │
│  Window:   2026-11-09 → flexible      Crew: [ 4–6 ]          │
│  Site:     evenings OK; elevator access                      │
│  Missing (flagged, NOT invented): budget range? materials?   │
│                                                              │
│  [Edit]  [Approve & match]  → request_created + approved     │
│  (approval logs proposal vs final diff for AI measurement)   │
└──────────────────────────────────────────────────────────────┘
```
Notes: AI never fills missing fields — it flags them (details/04 safeguard); approval
is the funnel gate (event-tracking-plan #2); multi-trade selection drives
`request_trades`.

## 3. Response email (one-click, single-use token)

```
Subject: New request: Warehouse rewiring — electrical crew (4 people) needed

Hi OÜ Elektrimees,

A project manager needs an electrical crew:

  Work:      rewiring, 400 m² office floor
  Location:  Tallinn, Ülemiste
  Window:    from 2026-11-09, evenings possible
  Crew:      4 people
  Your rate model fits: hour

Can your crew do this?
  [ Accept ]  [ Submit quote ]  [ Decline ]

  Accept = "we can commit, here's availability" (next screen:
  how many people, from what date — 30 seconds, no login)
  Links expire 2026-10-25. One-time use.

Prefer the calendar? [Switch to the booking system]  (adoption funnel)
```
Notes: token = single-use expiring HMAC (Phase 1 wk3 email pipeline); the answer page
records `response_received` (+ `qualified_response` if capacity + date present);
open-tracking pixel adds `email_opened`.

## 4. Availability view (provider-facing; cockpit supply view exists for staff)

```
┌──────────────────────────────────────────────────────────────┐
│ OÜ Elektrimees — capacity                    [week ◀ ▶]      │
├──────────────────────────────────────────────────────────────┤
│              Mon 9    Tue 10   Wed 11   Thu 12   Fri 13      │
│ electrical     4        4        2†       2†       4         │
│ drywall        0        2        2        2        2         │
│                                                              │
│ † = tentative (soft-free or open hold)                       │
│ Legend: [4 confirmed] [2 tentative] [0 booked]               │
│                                                              │
│ Holds: Warehouse rewiring holds 2 electrical, expires in 31h │
│ [Confirm held booking]  [Release hold]                       │
│                                                              │
│ Last confirmed: 2026-10-18 → status chip: Current (<7 days)  │
└──────────────────────────────────────────────────────────────┘
```
Notes: freshness chip logic (<7/7–14/14–30/>30 days) per details/03; confirmations
from response emails (screen 3) write into this grid; bookings decrement the
confirmed counts (first-confirmed-wins at DB level, migration 0003).

---

## Screen inventory for Phase 2 (build order)

| Wk | Screen | Events exercised |
|---|---|---|
| 5 | Provider onboarding (cockpit-assisted) | provider_created, provider_updated |
| 5–6 | Request form + lifecycle (cockpit exists; PM-facing form new) | request_created/approved |
| 6 | Matching v1 result view (why this provider — explainability) | matched |
| 7 | Booking core + availability grid | booking_confirmed, work_started |
| 7–8 | AI brief builder | brief split events, approval diff |
| 8 | Response comparison view + email flow e2e | response_received, qualified_response, quote_submitted |

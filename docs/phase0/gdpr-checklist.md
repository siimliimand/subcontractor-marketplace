# 0.2b — GDPR / Privacy Checklist (pilot stage, for lawyer review)

**Status:** DRAFT. Controls the pilot's data handling. Lawyer review before real provider
data collection (Decision 5). Design principle from details/06: **collect only what the
workflow needs; worker-level data is NOT collected.**

## 1. What we process (data-processing register v0)

| Data | Subjects | Purpose | Lawful basis | Where |
|---|---|---|---|---|
| Staff: name, email (from Access JWT) | Employees of operator | Cockpit auth, audit trail | Art 6(1)(f) legitimate interest / contract | D1 EU (`users`, `audit_events.actorEmail`) |
| Provider company: name, reg. code, contact email/phone, trade(s), service area, pricing, capacity declarations (headcount, dates) | Legal persons + named contact persons | Matching, outreach, booking | Art 6(1)(b)/(f) + consent at onboarding | D1 EU (`companies`, `services`, `requests`) |
| Customer contact (PM) name/company/email | PM design partners | Request handling | Art 6(1)(b) contract | D1 EU (`requests.createdBy*`, cockpit) |
| Registry data pulled (Äriregister/MTR open data): status, EMTAK, board names | Legal persons (+ board = natural persons) | Verification badges, pre-seeding | Art 6(1)(f); public-register data, GDPR still applies to board names | D1 EU (provider fields) + source registries |
| Outreach records: which provider contacted, channel, outcome | Providers | Effort metrics, opt-outs, notification-fatigue control | Art 6(1)(f) | D1 EU (`outreach_entries`) |
| Time entries / audit events | Operator staff | Concierge effort measurement, security log | Art 6(1)(f) | D1 EU (`time_entries`, `audit_events`) |

**Explicitly not collected:** worker names, individual worker schedules, personal ID
codes (Äriregister open data contains none since 11/2024), health or biometric data,
payment data (nothing is paid during pilot).

## 2. Roles and processors

- Operator = controller for all of the above. No joint controllers at pilot stage.
- Processors: **Cloudflare** (Workers + D1 EU + Access + Email Service when onboarded) —
  EU residency maintained (D1 EEUR location; R2 not yet used); ** lawyer to attach/verify
  Cloudflare DPA**.
- Government registries queried as independent sources (RIK, TTJA, EMTA).

## 3. Controls implemented in the product (already built)

- Access-gated staff tooling; JWT validation + allowlist; every mutation writes an
  immutable audit event with actor + timestamp (accountability, Art 5(2)).
- Capacity declared as **headcount per trade per date** — the GDPR-sensitive
  worker-schedule data never enters the system.
- EU residency: D1 EU location; no non-EU processors added without checklist update.

## 4. Procedures to write before pilot data collection

- [ ] **Privacy notice** (ET + EN) for providers and PMs: what/why/where/how long, their
      rights, contact — one page each
- [ ] **Retention & deletion:** audit events (append-only) — define retention (e.g. 3 y
      for security log); provider profile deleted within 30 days of request, registry
      snapshots refreshed daily so stale copies age out; outreach entries retained
      [X months] for opt-out honouring
- [ ] **Data-subject rights procedure:** intake email, 30-day SLA, export + erase runbook
      (SQL runbook exists: staging-reset pattern; production erasure procedure to write)
- [ ] **Opt-out handling:** provider "do not contact" flag already modelled in outreach
      rejections — document that requests honour it automatically
- [ ] **Breach procedure:** Cloudflare status + who notifies (72 h rule), draft template
- [ ] **DPIA mini-screening:** marketplace for B2B services, no special-category data, no
      automated decision-making with legal effect (ranking is assistive, PM decides) —
      expect "full DPIA not required" conclusion, but write it down
- [ ] **Cloudflare DPA** review by lawyer (processor contract, Art 28)
- [ ] **Tax-debt data** (EMTA): if we ever display it — separate legal opinion required
      (no published reuse terms; see register-findings.md §3). Pilot: manual checks only,
      results kept as internal notes, not displayed.

## 5. Open questions for the lawyer

1. Board-member names from Äriregister: display in cockpit OK? (public register +
   legitimate interest analysis)
2. FIE providers are natural persons → full GDPR subject rights; confirm the notice and
   retention lines above satisfy them
3. Outreach to providers sourced from public registers: B2B cold-contact rules under
   Estonian/ePrivacy rules for *commercial* email — pilot outreach is request-relay
   (transactional) not marketing; confirm classification
4. Registry data + share-alike (MTR CC BY-SA 3.0): does publishing derived badge data
   trigger share-alike on our platform data? (Likely no — badge is a computed statement,
   not a derived dataset — confirm.)

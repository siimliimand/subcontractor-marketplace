# 0.3 — Public Register Access and Reuse: Research Findings

**Date:** 18 October 2026
**Purpose:** Gates badge work (Phase 3) and provider profile pre-seeding (Phase 2). Researched against official sources; UNVERIFIED items flagged for follow-up.
**Decision it feeds:** Decision 3 scope (business register badge in MVP), Decision 5 legal review agenda.

---

## Summary table

| Register | What we get | Access | Cost | Reuse terms | Verdict |
|---|---|---|---|---|---|
| Äriregister (RIK) | Legal existence, status, EMTAK codes, board, shareholders, annual reports | Daily open-data files + free real-time API (contract needed) | **Free** | **CC BY 4.0** | ✅ Use now — pre-seeding + existence badge |
| MTR / Tarvik (TTJA) | Trade notifications (elektritööd, gaasitööd, ehitus…), licences, precepts, bans | Public no-login search + daily open-data XML | **Free** | **CC BY-SA 3.0** (from metadata only — confirm with TTJA) | ✅ Use for trade-skill badge; share-alike caveat |
| EMTA tax arrears | Per-company overdue tax debt (>€100), unfiled declarations | Public per-company web inquiry only, **no bulk API** | Free | **No reuse terms published — legal gap** | ⚠️ Manual checks only at pilot scale; legal review before productising |
| Smart-ID (SK ID Solutions) | Strong auth for providers | Commercial REST API | From €60/mo (€0.109/tx) | Commercial agreement | ⏸ Deferred past Gate 3 (not needed; email tokens suffice for pilot) |

---

## 1. Äriregister (e-Business Register) — use immediately

- **Open data files** (https://avaandmed.ariregister.rik.ee): 12 datasets — simple/general data, registry cards, board members, shareholders, beneficial owners, pledges, rulings, annual reports. Most updated **daily**. No personal ID codes since 11/2024. Beneficial-owner open data ends 10.07.2026 (MoF decision) — don't build on it.
- **License: CC BY 4.0** (confirmed via portal terms). Attribution: credit RIK as source + licence notice; commercial use and derivatives allowed.
- **Free API**: requires a signed contract with RIK (apply via e-äriregister portal, processed ≤5 working days), but **no fee** when limited to the free API services. Limits: 50,000 responses/day, 1 concurrent request, 20/min for documents. Real-time data. WSDL: `https://ariregxmlv6.rik.ee/?wsdl`; newer REST API with API keys also exists.
- **Public no-login quick search** also exists for ad-hoc checks.

**Actions:** sign the free RIK API contract now (5-day lead, zero cost). Pre-seed pilot provider profiles from daily open-data files (name, status, EMTAK, address, board). Badge "Registered & active" = registry status check at match time.

## 2. MTR → Tarvik (TTJA) — trade notifications

- **Domain moved:** `mtr.mkm.ee` is **dead (NXDOMAIN)**. Register lives at **https://mtr.ttja.ee** since 20.06.2022 (TTJA is the controller since 01.05.2021, MSÜS § 8(4)). Since 25.06.2025 notifications progressively migrate to **Tarvik** (https://tarvik.ttja.ee).
- **Relevant content:** economic-activity notices for **Elektritööd, Gaasitööd, Surveseadmetööd, Masinatööd** (Seadme ohutuse seadus) and construction activity notices — Ehitamine, Projekteerimine, Omanikujärelevalve, etc. (Ehitusseadustik). Note: these are *undertaker-level* trade notifications, not per-building *ehitusteated* (those live in EIS — separate check if ever needed).
- **Public search without login:** yes (undertaker search, notice search, precepts, bans, EMTAK).
- **Open data:** daily XML dump — https://mtr.ttja.ee/opendata/avaandmed_ettevotjad.xml (schema: https://mtr.ttja.ee/opendata/schema… see andmed.eesti.ee dataset `7a8b778f-23af-4f8f-a5fd-5b2cdd623f79`). No REST API found.
- **License: CC BY-SA 3.0** per open-data metadata — commercial reuse OK, **but share-alike** (derived datasets must carry the same licence) and attribution. ⚠️ *UNVERIFIED beyond metadata — confirm with TTJA (info@ttja.ee) before building the badge.*

**Actions:** badge "Trade notification valid" for electrical/gas/construction trades from MTR/Tarvik data. Email TTJA to confirm licence + ask about Tarvik migration timeline for our six trades. Open-data XML also feeds pre-seeding (who has valid notifications, by county via address).

## 3. EMTA tax arrears — manual only for now

- **Public inquiry:** https://apps.emta.ee/saqu/public/taxdebt (input: registry code). Shows collectible overdue claims >€100 (imputed interest excluded), unfiled declarations, debt breakdown, disputed/scheduled portion. Related: KMKR-number check (`/saqu/public/kmkrnr`), tax-behaviour rating (maasikas.emta.ee/rating/search), quarterly aggregates (MKS § 27(3)/(5)/(6)).
- **Legal basis:** Maksukorralduse seadus **§ 27 "Avalikud andmed"** — disclosure permitted if total arrears exceed €100.
- **⚠️ Legal gap:** EMTA publishes no reuse terms for this data. Displaying "has tax debt" on our platform needs a legal opinion (AIS § 24ff reuse analysis + GDPR for FIE natural persons). **Lower-risk pilot pattern:** concierge runs the public inquiry manually per provider at onboarding; no automated badge; revisit at legal review.

## 4. Smart-ID — deferred, priced, not blocking

- SK ID Solutions, eIDAS/PSD2 compliant; transaction-based monthly billing (e.g. Plan I: 550 tx min, €0.109/tx, €60/mo minimum; Authentigate aggregator from €29/mo if we later want multiple eIDs under one contract). QES-level signing on qualified accounts.
- **Decision:** not needed before Gate 3 — provider auth via single-use email tokens (per plan), staff auth via Cloudflare Access. Revisit if design partners demand strong provider identity.

---

## Follow-ups (owner: founder, before badge work in Phase 3)

1. Email TTJA: confirm CC BY-SA 3.0 licence + Tarvik migration timeline for elektritööd/ehitus notifications
2. Sign free RIK API contract (before Phase 2 pre-seeding)
3. Add EMTA tax-debt reuse question to the lawyer review (Decision 5)
4. Confirm EIS/ehitusteated scope only if customers ever ask for per-building notice data

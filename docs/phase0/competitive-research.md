# 0.9 — Competitive Research: Estonian Construction Portals, Procurement Tools, Scheduling Software

**Date:** 3 November 2026 (every URL below fetched during this session; per-pricing entries carry their check date)
**Purpose:** Inventory who already serves Estonian construction firms in subcontractor discovery, procurement/quotation, and crew scheduling; what each product costs; and whether any of them can show a project manager free crew capacity by day — the bet this marketplace is built on (plan.md §4).
**Decision it feeds:** Decision 6 — day-30 go/no-go synthesis (sole sanctioned revision point for pilot targets); discovery interview guides (`docs/phase0/interview-guides.md`, SUBC-002); evidence framing of the Competitive-response risk row in `docs/details/10-risks-and-legal.md` line 20 (that file is deliberately not edited here).

---


## Executive summary

**Research date:** 3 November 2026. **15 products inventoried** (8 portals/directories, 3 procurement/quotation, 4 scheduling), every one fetched this session; bad and dead seeds recorded, not hidden.

**Headline verdict per category.** *Portals:* marketplace-style matching portals **do exist** (Hange.ee with a subcontracting stream and 5%-success-fee monetization; Osavo; Rementor) — "no portal exists" must never be our claim. Company discovery is commoditized (EB sells a 21,877-firm live database for €119–899/yr); job boards serve permanent hiring, not crews. *Procurement:* Estonia's official register is a threshold boundary condition (works ≥ €60k), not a competitor for private fit-out sourcing; the private SaaS benchmark (Prokuria) is not Estonian and is sales-led; an Estonian estimate-document generator (Quostra) opens **January 2027** and will raise PMs' "describe → priced documents" expectations mid-pilot. *Scheduling:* every verified tool faces **inward** — no product shows a requester free crew capacity per day; Estonian fabricators already pay €120/mo flat for internal capacity scheduling (EZIIL) after deleting Excel sheets, proving willingness to pay and naming the true incumbent: a spreadsheet.

**Top 3 exploitable gaps.** (1) **Requester-facing crew capacity is unclaimed in all 15 products** — decision #2's capacity-per-skill-per-day display has no incumbent. (2) **Response speed is unoptimized** — portals move jobs to firms; none optimizes time-to-qualified-response (<4 h target, §9). (3) **Nobody lets providers list free** — every B2B incumbent charges somebody a subscription, ad, or success fee; plan §10's free-listing rule is a wedge, not a sacrifice.

**Top 3 threats.** (1) **Hange.ee extends toward crew matching** — closest structural analog with ratings and transaction infrastructure (Low-Medium; interviews must measure its pilot-segment usage). (2) **Portal attention crowding** — providers' notification budget already occupied by Hange-class feeds (Medium; tests notification-fatigue assumptions). (3) **Adjacent-tool entrants** — EZIIL owns a capacity engine with Estonian install base; Quostra builds Estonian construction data — a cross-company capacity marketplace from that direction is a 24-month risk, not a 12-month one (Low near-term; monitor at day-30).

**Competitive-response risk (details/10 line 20): `Medium` likelihood survives this evidence** — Hange's real network effects prove incumbents can copy models; but no incumbent collects availability *data*, which is precisely the moat that takes provider behavior over time to build. Revisit at day-30 with interview measurements (see Competitive-response risk section).

---

## Method and verification contract

- Every product entry was fetched via `fn_web_fetch` during this session (2026-11-03). Seed leads were treated as leads, not ground truth: two of the seven planner seeds turned out wrong or dead and are recorded as dropped below, not silently included.
- **No invented prices.** Where public pricing could not be confirmed from an official page, the pricing finding is exactly `Not public (sales-led)`. Where a claim could not be confirmed from an official source, it is flagged `UNVERIFIED` inline with what would confirm it; all UNVERIFIED items are mirrored in the sources appendix.
- **Search channel note:** `fn_web_fetch` is text-only (no JS rendering). Estonian/English queries were run through Bing SERP fetches; DuckDuckGo Lite and Mojeek served bot-challenges and were abandoned (details in the appendix). JS-heavy sites (Osavo, Rementor, CV.ee services page) yield thin text — where that prevented verification, the gap is flagged rather than guessed at.
- Excel / MS Project is treated as the documented scheduling status quo (baseline finding, interviews) and is kept outside the product minimums.

---

## 1 — Estonian construction portals and directories

### What we are looking for, and why it matters to the pilot bet

The pilot's viability claim is that PMs at interior fit-out firms in Tallinn/Harju have no fast way to find a crew that is *actually free* across the six pilot trades (electrical, plumbing, HVAC, drywall, flooring, painting). Category 1 asks: who already solves subcontractor **discovery** for these firms? A strong incumbent here threatens the top of our funnel; a weak one is our cold-start opening. The specific questions:

1. Does a marketplace-style matching portal (post work → providers respond) already exist for construction in Estonia?
2. Do directories/job boards cover all six pilot trades in Harju?
3. Does anything expose **current crew availability** — not company lists, not job feeds — to a requester?

### Headline findings

- **Marketplace-style matching portals do exist** — the honest answer to question 1 is yes, not no. Hange.ee runs rated construction procurements including a dedicated subcontracting (Alltöövõtt) stream with transaction-fee monetization; Osavo and Rementor match renovation jobs to builders. "No portal exists" is therefore **not** our differentiation claim and must not appear in interviews or GTM copy.
- **No inventoried product exposes crew capacity per day.** Every Category 1 product scores `none` on availability coverage (see the fit matrix). Portals move *jobs* to *firms*; none moves *free people per day* to a requester. This is the exploitable gap the plan bets on (plan.md §4: "an empty calendar never means free capacity" — no incumbent even has a calendar to be wrong about).
- **Company discovery is commoditized; capacity discovery is unsolved.** A PM can already buy a 21,877-firm construction database with live procurement intelligence (eb.ee, €119–899/yr) or browse free directories (KVruum, MTR cross-reference). The unsolved half is *which of these firms can start on my site on Tuesday*.
- **Employment job boards are an indirect substitute.** CV Keskus and CV.ee serve permanent-position hiring with active construction categories; some PM urgency is met by hiring staff instead of subcontracting. Interviews should test whether this substitution is real or marginal.

### Inventory

Summary (availability classes per the Research Contract; details per product below):

| # | Product | URL | Type | Side served | Availability coverage | Pricing (checked 2026-11-03) |
|---|---|---|---|---|---|---|
| 1.1 | Ehitusbörs (EB) | https://eb.ee | Construction object + procurement intelligence database, free ads | Demand-side discovery + supply-side lead feed | none | €119/mo · €299/3mo · €499/6mo · €899/12mo (+24% VAT) |
| 1.2 | Hange.ee | https://www.hange.ee | Marketplace-style procurement portal with ratings, incl. subcontracting stream | Two-sided marketplace | none | Post: 0–15 € · Win: 5%+VAT of bid (min 20 €+VAT, max 825 €+VAT) · Premium+ €699/3mo+VAT |
| 1.3 | Osavo | https://osavo.ee | Marketplace: post a job, verified builders quote | Two-sided marketplace (consumer→builder) | none | Customers free (stated); provider side Not public (sales-led) |
| 1.4 | Rementor | https://rementor.ee | Marketplace: post project, match from Rementor worker pool; warranty tracking | Two-sided marketplace (renovation) | unknown | UNVERIFIED (JS-rendered) |
| 1.5 | Ehitusuudised | https://www.ehitusuudised.ee | Construction news portal + industry TOPs + jobs section | Internal tool — media, not a marketplace | none | Jobs section Not public (page 404 at check) |
| 1.6 | CV Keskus | https://www.cvkeskus.ee | Largest Estonian job board; construction a top sector | Supply-side job feed (permanent hiring) | none | Not public (sales-led) |
| 1.7 | CV.ee (CV-Online) | https://cv.ee | Job board; `cvonline.ee` redirects here; Ehitus/kinnisvara category | Supply-side job feed (permanent hiring) | none | Not public (sales-led) |
| 1.8 | KVruum | https://kvruum.ee | Company directory for builders/service providers, self-listing | Demand-side discovery | none | Not public |

**1.1 Ehitusbörs (eb.ee) — the professional's procurement radar**

- URL: https://eb.ee (operator OÜ Spetsialist Meedia, reg. code 11416175; terms at https://spetsialist.ee/kasutustingimused)
- What it does: live database of Estonian construction objects (68,540) and companies (21,877 — both counts displayed on the homepage at check). Tracks each object through its lifecycle (planning → building permit → contractor chosen → completed), names contractors and contact persons, covers public procurements *and* smaller private design/build tenders. Visitors can post a procurement or contractor ad free ("Kuuluta tasuta!").
- Side served: demand-side discovery (firms watch for upcoming objects/tenders to bid on) and a lead feed for subcontractors; also usable by a PM to profile potential subcontractors.
- Availability coverage: **none** — object pipeline data only; nothing about a firm's current crew capacity.
- Pricing (checked 2026-11-03, operator's official price list, valid from 07.03.2026, excl. 24% VAT): monthly €119; 3 months €299; 6 months €499; 12 months €899; auto-renewing.
- Notes: prices itself as a "kutseline ehitushankeportaal" (professional construction-procurement portal). Key inference, clearly labelled as ours: PM-side firms **already pay four figures a year** for construction sourcing intelligence — evidence that sourcing information has proven willingness to pay, while *live capacity* remains absent from the product. Sibling international editions exist (Leedu/Ukraina/Moldova links on site; buildinginfo.eu seen in search results).

**1.2 Hange.ee — the closest structural analog to our marketplace**

- URLs: https://www.hange.ee (marketplace), https://www.hange.ee/hinnakiri (pricing)
- What it does: procurement-style marketplace where private persons, apartment associations, companies and public institutions post construction/renovation "hanked" (tenders); registered firms bid; winners get rated (star ratings with review text, dated, visible on the homepage). Homepage at check shows recent rated jobs including bathroom renovations, electrical work, flooring/vinyl installation, tiling — i.e., the six-trade profile is represented at small-job scale. Streams: **Erahanked** (private), **Alltöövõtt** (subcontracting), **Avalik sektor** (public sector), **Hanketeated** (procurement notices). Pricing page claims 1000+ construction/renovation procurements per month on the platform.
- Side served: two-sided marketplace.
- Availability coverage: **none** — matching is job-level; no crew-capacity or calendar concept appears anywhere on the public pages.
- Pricing (checked 2026-11-03, official hinnakiri, prices incl. VAT unless noted): posting a procurement — 3 days €0, 7 days €9, 14 days €12, 30 days €15. For participants in Erahanked: success fee **5%+VAT of the winning bid amount** when selected, minimum €20+VAT, maximum €825+VAT. Premium+ package: €699+VAT per 3 months (notifications, visible contacts, logo, 3 free offer edits — else €2.90 per edit, €4.90 to open competitors' offers). Alltöövõtt + Avalik sektor stream: **0% success fee** (monthly package fee, selected at signup).
- Notes: the most direct incumbent analog — transaction-fee monetization on *construction work actually won* (our plan.md §10 rules out booking fees for providers; Hange proves Estonian firms will accept success fees, which is both a monetization datapoint and a pricing threat if they entered our niche). Ratings exist, but rate *completed jobs*, not ongoing availability. Consumer-weighted job mix at check.

**1.3 Osavo (osavo.ee)**

- URL: https://osavo.ee
- What it does: marketplace where a customer describes needed construction/renovation work ("Lisa töö — kirjelda, mida vajad") and receives price quotes from performers the site describes as verified ("kontrollitud tegijatelt"); tagline "leia ehitaja või lisa töö tasuta" (find a builder or add work for free).
- Side served: two-sided marketplace, consumer→builder orientation.
- Availability coverage: **none** observable.
- Pricing (checked 2026-11-03): customer posting free (stated on homepage). Provider side: **Not public (sales-led)** — no pricing page found; `/hinnakiri` returned 404.
- Notes: JS-rendered; public detail on scale and provider economics is thin.

**1.4 Rementor (rementor.ee)**

- URL: https://rementor.ee (FAQ page path `/testing`)
- What it does: "Leia ehitajad" — customers post a project and select a performer from Rementor's worker pool; the platform tracks **warranties** on completed work (search-engine snippet shows a warranty-status view, e.g. an 18-month warranty on a bathroom renovation, active status). Differentiator appears to be warranty assurance rather than capacity.
- Side served: two-sided marketplace, renovation/consumer.
- Availability coverage: **unknown** — the site is a JS-rendered SPA; its FAQ and project flow could not be read textually in this session.
- Pricing: **UNVERIFIED** — search snippet of the FAQ suggests project posting may be free ("Kas projekti lisamine on tasuta?"), but the FAQ content was not fetchable this session. To confirm: open rementor.ee and rementor.ee/testing in a JS-capable browser; record provider-side fees.
- Notes: included because it is a live marketplace-style portal (the category's existence question), not for depth.

**1.5 Ehitusuudised (ehitusuudised.ee)**

- URL: https://www.ehitusuudised.ee
- What it does: leading Estonian construction news portal (part of the Äripress/Äripäev-family topic-site network), industry revenue TOP rankings (e.g., infrastructure TOP, materials producers TOP), conferences; carries a "Tööpakkumised" (job offers) element in navigation and advertising products.
- Side served: internal tool — media, not a marketplace.
- Availability coverage: **none**.
- Pricing (checked 2026-11-03): the jobs-section URL `ehitusuudised.ee/toopakkumised` returned **404**; job-advertising pricing Not public. News subscription sold via the site.
- Notes: not a competitor for matching, but the channel where Estonian construction firms' attention lives — relevant later as a supply-recruitment marketing channel, recorded here so GTM planning can find it.

**1.6 CV Keskus (cvkeskus.ee)**

- URL: https://www.cvkeskus.ee (service page: https://www.cvkeskus.ee/toopakkumise-avaldamine)
- What it does: self-described largest Estonian job portal by volume of job ads; construction ("tööstus ja ehitus") named among its main sectors; employers publish job ads, search a CV database, buy VIP placement.
- Side served: supply-side job feed — **permanent employment hiring**, not project crew sourcing.
- Availability coverage: **none**.
- Pricing (checked 2026-11-03): **Not public (sales-led)** — the ad-publishing page lists services (job ad publishing, CV database, VIP ads, mirroring to partner channels) with a "request info" CTA and no published prices.
- Notes: an indirect substitute for crew sourcing — in a pinch a PM can post an employment ad instead of subcontracting; interviews should test how often urgency is actually met this way.

**1.7 CV.ee / CV-Online (cvonline.ee)**

- URLs: https://cv.ee (cvonline.ee redirects here); employer services at https://cv.ee/et/services
- What it does: major Estonian job board (CV-Online group); active "Ehitus / kinnisvara" category — 292 ads at check; consultative employer sales line published (+372 6990 555).
- Side served: supply-side job feed (permanent hiring).
- Availability coverage: **none**.
- Pricing (checked 2026-11-03): **Not public (sales-led)** — the services page is JS-rendered and shows a consultation CTA rather than prices.
- Notes: second employment channel; same substitution logic as 1.6.

**1.8 KVruum (kvruum.ee)**

- URL: https://kvruum.ee/leia-ehitaja
- What it does: Estonian company directory ("Ehitajate ja teenusepakkujate kataloog") for construction, landscaping, electrical and other service providers; firms self-list ("Lisa oma ettevõte"); category/filter browsing.
- Side served: demand-side discovery (find firms).
- Availability coverage: **none**.
- Pricing (checked 2026-11-03): **Not public** — no pricing page surfaced in this session's fetches or searches.
- Notes: small-scale free-style directory; demonstrates that *finding a firm* is a solved, low-value commodity; nothing here answers *who is free*.

### Verified context, not inventoried

- **Leia24 (leia24.ee)** — general classifieds-style marketplace ("kus vajadus kohtub meistriga") with Ehitaja/Torumees categories and quote comparison; **18 total listings** across all categories at check — consumer classifieds scale, not PM-grade sourcing. Fetched and verified; excluded from the inventory for scale.
- **MTR/Tarvik (mtr.ttja.ee)** — regulatory register of trade notifications; **not a discovery portal**. Access/licence findings live in `docs/phase0/register-findings.md` §2 (verified 18 October 2026; CC BY-SA caveat) — cross-referenced here rather than duplicated.

### Dropped and dead seed leads

- **kodutoo.ee — seed wrong.** Fetched: it is a homework-tutoring site ("Kodutöö · Õpiabi"), not a home-services marketplace. No home-services marketplace by that name found; the seed is recorded as a mismatch.
- **ehitus360.ee — dead.** DNS lookup failed for both apex and www (checked 2026-11-03). Recorded as dead, not silently dropped.
- **Search-process note:** the marketplace-existence question was answered positively (Hange.ee, Osavo, Rementor found via Estonian-language Bing queries), so no "absence headline" applies. Two Estonian-language Bing queries were mis-parsed by the engine (returned unrelated results) and are listed in the appendix for honesty.

---

## 2 — Procurement and quotation tools

### Why procurement tools matter to the pilot

The ideal pilot customer is a PM at a larger firm (details/01): larger firms have **established procurement processes and existing software** — named there as a trade-off of the segment. Two consequences: (a) our requests will compete with entrenched procurement workflows, so "send request → get quotes" must be lighter than the tools they already run; (b) sourcing **above public-procurement thresholds** is legally channelled through Estonia's official register — anchor customers with any public-sector clients cannot simply switch to a private marketplace for that spend. This section inventories the official channel, the private procurement SaaS layer, and Estonian quotation/estimate tooling.

### Headline findings

- **The official public channel is a boundary condition, not a competitor.** Estonian construction procurements at or above the simple-procurement threshold (€60,000 for works) must be published in the national riigihangete register; at/above the international threshold they are additionally published via the EU Official Journal (TED) (thresholds per the Riigihangete seadus, as summarised in the Wikipedia article fetched this session — see entry 2.1 for verification status). Typical interior fit-out work sits **below** these thresholds — private sourcing — so the official channel does not touch the pilot's core flow. It matters only where an anchor PM's organisation or its clients are public-sector bodies.
- **The "Estonian-founded procurement SaaS" seed was wrong.** Prokuria's official about-page states offices in the **US, UK and Romania** (founded 2016; acquired by CenterPoint Group in 2026 per third-party reports). It is nonetheless a real procurement SaaS with a **construction vertical** — recorded here as the private-SaaS benchmark, with Estonian relevance UNVERIFIED.
- **An Estonian quotation/estimate product is being built right now and opens January 2027.** Quostra (Estonia product) generates Estonian-standard estimate documents (ehitustööde eelarve, töömahtude loetelu, tehniline kirjeldus) from a guided questionnaire, using reference prices with national and **regional county coefficients** (its worked example: Estonia, Tartu County ×1.03). Pricing is not public yet (founder waitlist). This does not touch crew capacity — but it means the *estimate/quote* layer of our future workflow has a funded entrant arriving mid-pilot. Worth monitoring; interviews should ask PMs how they produce estimates today.
- **No Estonian cost/estimate *data* service could be verified.** The seed kalkupank.ee does not resolve (DNS, checked 2026-11-03) and no alternative surfaced in Estonian/English queries; the public construction-price indices (Statistics Estonia) are government-hosted and unreachable from this session's network (see entry 2.1 note). Estimating data sources are an interview question, not a settled fact.
- **Adjacent (verified, not inventoried):** Finbite (finbite.eu) — Baltic e-invoice operator ("largest e-invoice operator in the Baltics, 11+ years") with one-click purchase-invoice approval workflows. Invoice *approval*, not RFQ — procurement-adjacent plumbing that larger PM firms may already run.

### Inventory

| # | Product | URL | Type | Side served | Availability coverage | Pricing (checked 2026-11-03) |
|---|---|---|---|---|---|---|
| 2.1 | Riigihangete register (Estonian public e-procurement) | riigihanked.ee (UNVERIFIED-live, see entry) | Official public-procurement register & e-procurement environment | Demand-side channel (public buyers publish; suppliers bid) | none | Free to publish/bid (public regime; UNVERIFIED-live) |
| 2.2 | Prokuria | https://www.prokuria.com | Private procurement SaaS (RFQ/RFP, SRM, auctions), construction vertical | Internal tool (procurement team) + supplier-facing events | none | Not public (sales-led; module + user-tier estimator gates the number behind a work email) |
| 2.3 | Quostra (Estonia product) | https://quostra.com/ee-en/software | Cost estimating/quotation document generator for Estonian construction | Internal tool (architects, lead designers, client reps) | none | Pre-launch (opening January 2027); not public — founder waitlist |

**2.1 Riigihangete register — Estonia's official e-procurement environment**

- URL status: **UNVERIFIED-live.** The planner seed `riigihanked.rik.ee` **no longer resolves** (DNS NXDOMAIN, checked 2026-11-03). `riigihanked.ee` **resolves** in DNS but did not serve this session's fetcher; all Estonian government sites (riik.ee, rahandusministeerium.ee, rtk.ee, eesti.ee) refused this session's requests (403/network). To confirm the current official URL and terms: open riigihanked.ee in a browser from an unrestricted network.
- What it does (per the Wikipedia *Riigihange* article fetched this session, which cites the Riigihangete seadus): the register in which Estonian public procurements are published. Thresholds: **simple procurement** — works ≥ €60,000 (goods/services ≥ €30,000) published in the register under simplified procedure; **national threshold** — works contracts ≥ €150,000 (goods/services ≥ €60,000) under full procurement procedure; **international threshold** (set by the European Commission) — additionally published in the EU Official Journal supplement (TED).
- Who must use it: contracting authorities/bodies as defined by the Public Procurement Act (state, municipalities, public-law entities and others). Suppliers register to submit bids.
- Availability coverage: **none.**
- Pricing: participation in the public regime is free for suppliers per the public-procurement regime — **UNVERIFIED-live** (confirm any user fees for the current environment in the browser check above).
- Notes for the pilot: private interior fit-out sourcing stays below these thresholds; the register matters (i) as the procurement *backdrop* larger firms operate under, and (ii) because hange.ee (entry 1.2) already mirrors small public-sector procurement workflows for its users.

**2.2 Prokuria — the private procurement SaaS benchmark**

- URLs: https://www.prokuria.com (product), https://www.prokuria.com/pricing (pricing estimator), https://www.prokuria.com/about-us (company)
- What it does: no-code procurement platform — automated sourcing (RFP/RFQ/RFI, auctions, intake), supplier relationship management (onboarding, scorecards, compliance), SpendIQ spend analytics, procurement workflows (requests, orders, approvals). AI-drafted RFx and standardized bid scoring. Marketing pages name an explicit **construction vertical** ("Construction — automate your procurement … find and recruit the best suppliers").
- Side served: internal tool for a buyer's procurement team; suppliers participate in events **without creating a login** (stated on the pricing page).
- Availability coverage: **none** — it sequences RFQs, not crew calendars.
- Pricing (checked 2026-11-03): **Not public (sales-led)** — the pricing page is a module + user-tier estimator (Team <10, Business 10–50, Enterprise >50 users) that gates the monthly figure behind a work email; implementation, integrations and custom work priced on a scoping call.
- Estonian relevance: **UNVERIFIED** — official about-page (fetched) states offices in the **US, UK and Romania**, founded 2016, co-founders Ionel Naftanaila and Radu Dobre; no Estonian customers or locale claimed. The planner seed's "Estonian-founded" claim is contradicted by the official page. Third-party profiles (Tracxn via Bing SERP) locate the company in Bucharest and report a 2026 acquisition by CenterPoint Group — UNVERIFIED (third-party source; confirm via official press release if it ever matters).
- Notes: relevant as the shape of "procurement software larger firms could adopt" — a multi-week-sales, demo-gated, per-user-priced buyer-side tool. Its "suppliers participate without login" design choice is a useful counterpoint to our one-click email responses.

**2.3 Quostra — Estonian construction estimating, pre-launch**

- URL: https://quostra.com/ee-en/software (Estonia product; the root site is the founder's French estimation consulting practice)
- What it does: guided questionnaire (new build / renovation / demolition; storeys, spaces, floor areas — "no drawings to import") → engine derives quantities from a reference library, prices them with reference prices × national coefficient × **regional (county) coefficient** (worked example in the page: plasterboard stud partitions, €41.26/m² reference, Estonia/Tartu County ×1.03 → €42.50/m²) → outputs Estonian-standard editable documents: **Ehitustööde eelarve** (Excel/PDF), **Töömahtude loetelu** (Excel/PDF), **Tehniline kirjeldus** (Word/PDF). Every line keeps its derivation ("figures you can defend").
- Side served: internal tool for architects, lead designers, client representatives.
- Availability coverage: **none.**
- Pricing (checked 2026-11-03): **not public** — page states "Opening in January 2027", 150 founder places via waiting list, no obligation before opening. (The French consulting arm prices missions in credits, e.g. from €1,725 excl. VAT — different product, listed here only to show the operator's price familiarity.)
- Notes: the estimate/quote layer for Estonian construction is being productised by an entrant arriving ~mid-pilot (Jan 2027). For us it is **complementary pressure, not overlap**: it prices the *work*, we source the *crew*. But if it succeeds, PMs' expectation of "describe project → priced documents" will rise, and our AI brief builder will be compared to it. Monitor at day-30 synthesis.

### Dropped leads and gaps recorded honestly

- **kalkupank.ee — dropped.** DNS does not resolve (checked 2026-11-03); no search confirmation found. Recorded as a dead/unconfirmable seed, not silently included.
- **Tender aggregators beyond the register:** no separate Estonian tender aggregator verified beyond EB (entry 1.1, which already mirrors public+private tenders) and Hange.ee (entry 1.2, private + small public sector). TED/OJEU is the international layer of the official channel (see 2.1).
- **Statistics Estonia construction price indices** — public cost-data reference, government-hosted; unreachable from this session's network (**UNVERIFIED-live**). Interviews should ask what PMs actually use for estimates today.
- **Finbite (finbite.eu)** — verified fetch; procurement-*adjacent* (invoice/approval workflows, Baltic-wide), not RFQ/quotation — kept out of the inventory to stay within scope; recorded for the larger-firm software-stack question in interviews.

---

## 3 — Scheduling and capacity software

### The analysis question: who can show a requester free crew capacity?

Decision #2 locked our booking system as **capacity per skill per day**, built ourselves; plan.md §4 defines what a PM must see: "Available from [date], [n] workers free", in Confirmed / Tentative / Unconfirmed states, with "an empty calendar never means free capacity". Category 3 therefore asks a sharper question than "does scheduling software exist": **does any existing tool expose free-crew-capacity to a *requester*** — a project manager hiring a crew — rather than a busy/free calendar to the crew's own employer? A tool that schedules a firm's *own* people (shifts, departments, tasks) is an internal instrument; it is a competitor only if its vendor chooses to expose that capacity across company boundaries — a strategic pivot, not a feature toggle.

### Headline findings

- **No inventoried tool exposes crew capacity per day to an external requester.** Every entry scores `busy-free calendar only` or weaker: EZIIL shows department workload to the fabricator running the shop; Procore's Resource Management schedules the GC's own labour and fleets; Fieldwire assigns field tasks to a project's own team; Planday shifts a venue's own staff. All capacity views face **inward**. The requester-facing availability gap our §4 targets is unclaimed in every tool we verified.
- **Estonian industrial firms already pay for capacity-planning SaaS.** EZIIL's own site names Estonian steel fabricators as customers — Enefit Solutions (industrial steelwork, Estonia) "deleted 12 separate Excel sheets"; B&W Metall (Estonia, 100 t/week) and Kane Metall (Estonia) also cited — at **€120/month flat, whole-team pricing**. This is direct evidence that (a) Estonian project businesses buy crew/workload scheduling tools, and (b) the incumbent status quo these tools displace is **Excel** — our real scheduling competitor in interviews is a spreadsheet.
- **Global construction suites: no verified Estonian presence.** Procore and Fieldwire (by Hilti) are verified live products, but neither page fetched this session claims Estonian or Baltic customers; adoption here is **UNVERIFIED** and is a named interview question. The construction-specific seeds Buildertrend and Fonn could not be verified (WAF-blocked; see appendix) — neither was inventoried.
- **Even time-tracking vendors now say "capacity planning".** Toggl's homepage markets "Time Tracking Software & Capacity Planning Tool" — again inward-facing (your team's hours), but the vocabulary is reaching adjacent categories. Nobody verified here aims capacity at *cross-company crew sourcing* — the words exist, the marketplace use does not.
- **Baseline (status quo, not a product):** Excel and MS Project are the assumed scheduling status quo at Estonian PM firms — documented as the thing our §4 Confirmed/Tentative/Unconfirmed states must beat, to be confirmed in interviews ("what do you plan crews in today?"). Kept outside the product minimums per the Research Contract.

### Inventory

| # | Product | URL | Type | Side served | Availability coverage | Pricing (checked 2026-11-03) |
|---|---|---|---|---|---|---|
| 3.1 | EZIIL | https://eziil.com | Production/job scheduling for custom steel fabricators | Internal tool (own shop's departments) | busy-free calendar only (departmental workload, internal) | From €120/mo (≈$140), flat whole-team pricing |
| 3.2 | Procore | https://www.procore.com | Construction project management platform (execution, cost, resource mgmt) | Internal tool (GC/specialty contractor's own crews) | busy-free calendar only (own labour/equipment; no requester view) | Not public (sales-led) |
| 3.3 | Fieldwire (by Hilti) | https://www.fieldwire.com/pricing/ | Construction field/plan management, tasks, RFIs, budget | Internal tool (project team) | none (task/plan coordination; no capacity calendar) | Basic $0 (5 users) · Pro $39 · Business $64 · Business Plus $89 per user/mo, annual billing |
| 3.4 | Planday | https://www.planday.com/pricing | Generic workforce scheduling / shift planning (Xero-integrated, service-sector) | Internal tool (own staff) | busy-free calendar only (shifts, leave — internal) | From £2.99/user/mo (Starter, min 5 users); Plus per-user tier (price loads dynamically); Pro custom |

**3.1 EZIIL — scheduling SaaS Estonian fabricators actually run**

- URL: https://eziil.com (homepage carries pricing and named customer results)
- What it does: lightweight production planning, scheduling and job tracking for custom steel fabricators (15–150 people): project scheduling with per-department workload views, double-booking prevention, on-time-delivery indicators, task assignment to workers' phones, live planned-vs-actual profitability per job, drawing/document management, EN 1090/AISC traceability.
- Side served: internal tool — the fabricator plans its **own** shop; nothing faces a hiring requester.
- Availability coverage: **busy-free calendar only** — and stronger than that wording implies for the firm itself ("see the next three months", "3 months of shop capacity ahead" per customer quotes) — but all of it faces inward.
- Pricing (checked 2026-11-03): **from €120/$140 per month, flat whole-team pricing, not per user**; live in under a week; cloud, mobile apps.
- Estonian relevance: **verified via the official site's customer list** — Enefit Solutions (industrial steelwork, Estonia), B&W Metall (Estonia), Kane Metall (Estonia) named with quotes; also UK/US/Australian customers. (Company origin not stated on the fetched page — not asserted here.)
- Notes: the strongest single datapoint that Estonian project businesses adopt crew/workload scheduling SaaS and abandon Excel for it. Steel fabrication is not interior fit-out — but the pattern (project shop, multiple concurrent jobs, capacity anxiety, Excel displacement) is the pattern our §4 booking system targets. Interviews: ask fabricator-side PMs if they know EZIIL; ask fit-out PMs what the construction-world equivalent is that they use.

**3.2 Procore — the global construction suite**

- URL: https://www.procore.com (product pages incl. Resource Management fetched)
- What it does: construction platform spanning project execution, cost management, and **Resource Management** — its marketing: "Schedule the right crew and fleet every time", labour forecasting ("92% of expert-level contractors agree Procore improved their ability to forecast labor needs", per its Dodge Construction Network ROI report citation), plus AI agents drafting RFIs, reviewing submittals, building daily logs.
- Side served: internal tool — the contractor's own crews, fleets, and financials.
- Availability coverage: **busy-free calendar only** — crew scheduling exists, but it serves the company running the work; a third-party PM cannot see "[n] workers free on Tuesday" in any subcontractor's Procore.
- Pricing (checked 2026-11-03): **Not public (sales-led)** — homepage has a "See pricing" CTA; the pricing page returned 404 to this session's fetch and Procore publishes no public tiers there. Quoted per-annual-contract sales model is the industry norm — do not cite figures.
- Estonian relevance: **UNVERIFIED** — no Estonian/Baltic customers or locale claimed on fetched pages; the ideal pilot firm (mid-size fit-out) is far below Procore's typical customer scale.
- Notes: matters as the ceiling of the category — if Estonia's larger GCs ever standardise on Procore, subcontractor *crew capacity* could in principle flow through its network. That is a years-scale, enterprise-sales scenario, and the day-30 synthesis does not need to price it in; interviews just note any Procore touchpoints.

**3.3 Fieldwire (by Hilti) — field coordination with transparent pricing**

- URL: https://www.fieldwire.com/pricing/ (pricing page, multi-currency incl. EUR)
- What it does: mobile-first construction plan viewing, task management, sheet compare, checklists, reports; Business Plus adds RFIs, submittals, change orders and Budget. Sold to specialty contractors, GCs and owners; "Set Up a Project for Free" entry tier.
- Side served: internal tool (project team coordination).
- Availability coverage: **none** — plans and tasks, not capacity.
- Pricing (checked 2026-11-03, USD page; EUR selectable): **Basic $0** per user/month (≤5 users, ≤3 projects, 100 sheets); **Pro $39**, **Business $64**, **Business Plus $89** per user/month billed annually; enterprise options via contact.
- Estonian relevance: **UNVERIFIED** — no Estonian presence claimed on fetched pages; Hilti's tool distribution in Estonia is plausible but unconfirmed.
- Notes: the per-user $39–89 range is a useful pricing anchor for construction-team software sold per seat; note it prices *users inside one company*, which cannot price cross-company availability data.

**3.4 Planday — generic workforce scheduler plausibly used in Estonia**

- URL: https://www.planday.com/pricing (UK-market page fetched)
- What it does: shift scheduling, time tracking, working-time compliance warnings, leave management, payroll reporting, team communication; Pro tier adds auto-scheduling. Service-sector DNA (hospitality/retail references on page) with Xero payroll integration.
- Side served: internal tool (a venue's own staff).
- Availability coverage: **busy-free calendar only** — shift/leave calendar for employees; nothing a hiring PM can query.
- Pricing (checked 2026-11-03): public tiers — **Starter from £2.99/user/month (min 5 users)** per the page title/positioning; Plus tiered per user (price rendered dynamically, not captured in the text fetch); **Pro custom**; 30-day trial. Estonian-market prices not verified this session.
- Estonian relevance: **UNVERIFIED (per contract, usage in Estonia is an assumption to test)** — no Estonian customers/locale claimed on the fetched page. Interviews: ask provider-side contractors whether they run shift tools (Planday or others) — if some do, §4 Tentative state could later integrate with them.
- Notes: represents the *generic* scheduler lane. Its model shows workforce scheduling sold per internal user — again structurally inward-facing.

### Baseline finding (status quo, kept outside the inventory)

**Excel / MS Project status quo.** No URL by design. The plan's problem statement and EZIIL's own customer stories ("deleted 12 Excel sheets") both point to spreadsheets as the scheduling incumbent at Estonian project firms. The §4 booking system's real competitor on day one is a PM's spreadsheet plus phone calls; interview guides should capture what tool (if any) each interviewee actually uses for crew planning — see the hand-off in the Synthesis section.

### Adjacent category, clearly labelled

**Toggl Track (toggl.com)** — time tracking with a "Capacity Planning Tool" tagline on its homepage (verified fetch 2026-11-03). Estonian-founded reputation is widely known, but the fetched page does not state origin — **UNVERIFIED** from this session's fetch; confirm if ever load-bearing. Included as context only: time tracking of one's own team is *not* crew scheduling, and Toggl faces inward like every other entry — it merely shows the "capacity" vocabulary migrating into adjacent tools.

### Dropped and blocked leads

- **Buildertrend (buildertrend.com) — not inventoried: WAF-blocked.** Both `/` and `/pricing/` returned HTTP 403 to this session's fetcher. The product exists as a US residential-construction management suite per its search-engine presence, but the contract requires a fetched official URL — verify in a browser before ever citing.
- **Fonn — not inventoried: WAF-blocked, origin corrected.** The seed lead resolves to **Access Fonn**, a mobile-first construction site-management app owned by The Access Group (Norwegian-origin project-management tool for construction, per Bing SERP descriptions of theaccessgroup.com, Google Play and LinkedIn). Official pages (theaccessgroup.com, fonn.com) returned HTTP 403; fonn.ee / fonnbuild.* do not resolve. The planner seed implied an Estonian/Baltic product — nothing fetched supports that. Verify in a browser before citing.
- **PMtech Group — not inventoried: unverifiable.** Listed by a third-party market-map page (ensun.io, rate-limited this session) among Estonian-relevant construction software; no official domain could be resolved or fetched (pmtech.lv DNS fail, pmtech.eu fetch fail). Left out rather than asserted.

---

## 4 — Fit assessment against the pilot segment

Scoring dimensions per the Research Contract: **(a)** 6-trade interior fit-out discovery coverage in Tallinn/Harju; **(b)** availability data class, mapped to plan §4's Confirmed / Tentative / Unconfirmed states where relevant; **(c)** marketplace side served; **(d)** pricing model vs plan §10's free-listing rule (listing + basic matching free for providers; booking interface is the paid part); **(e)** displacement risk — concretely, what it would take for this product to add capacity-based matching, assessed against the details/10 moats (network effects, provider relationships, availability data quality, transaction history).

Verdict scale: `Strong` (already serves the pilot job well) / `Partial` (serves an adjacent slice or proves the mechanics) / `None` (does not serve it).

| # | Product | (a) 6-trade fit-out coverage, Tallinn/Harju | (b) Availability data (§4 mapping) | (c) Side served | (d) Pricing vs §10 free-listing | (e) Displacement path to capacity matching | Verdict |
|---|---|---|---|---|---|---|---|
| 1.1 | Ehitusbörs (EB) | Firm/object discovery: covers all trades Estonia-wide incl. Harju (21,877-firm DB) | none — object pipeline, no crew data | Both sides (intel demand-side; lead feed supply-side) | Charges subscribers (€119–899/yr); providers don't list — no conflict, no alignment | Would need crew-capacity inputs from subscriber firms; EB's data model is public-record based, not relationship based — structural mismatch | **Partial** — firm discovery commoditized; capacity untouched |
| 1.2 | Hange.ee | All six trades present as categories; rated jobs include electrical, tiling, flooring, bathroom renovation | none — job-level flow; no calendar exists to be wrong about | Two-sided marketplace | **Contradicts §10**: provider pays 5% success fee (cap €825+VAT); posting paid after 3 days | Closest path: add capacity fields + freshness rules to profiles; would need providers to maintain calendars they don't have today; consumer job mix would have to shift B2B | **Strong** — closest structural analog; the displacement threat to watch |
| 1.3 | Osavo | Renovation jobs incl. pilot trades at consumer scale | none | Two-sided marketplace (consumer→builder) | Customers free; provider side sales-led | Small scale; B2B crew matching would be a repositioning, not an extension | **Partial** — proves Estonian consumer appetite for quote-matching |
| 1.4 | Rementor | Renovation focus; pilot trades plausible (UNVERIFIED — JS site) | unknown | Two-sided marketplace (renovation) | UNVERIFIED (FAQ suggests free posting) | Warranty-trust angle ≠ capacity; unknown scale | **Partial** — its warranty tracking is the relevant innovation, not its matching |
| 1.5 | Ehitusuudised | News reach across Estonian construction incl. Harju | none | Media (no marketplace) | Ad/subscription model; not provider-facing | Not applicable — a channel, not a product | **None** (as competitor); prime supply-recruitment channel |
| 1.6 | CV Keskus | Construction among top sectors; Tallinn-weighted | none | Supply-side job feed (employment) | Charges employers for ads — not a provider listing model | Would need a crew-capacity product line; employment ≠ project sourcing | **None** — indirect substitute via hiring; interview question, not a threat |
| 1.7 | CV.ee | Ehitus/kinnisvara active (292 ads) | none | Supply-side job feed (employment) | Charges employers (sales-led) | Same as 1.6 | **None** — same substitution logic |
| 1.8 | KVruum | Construction/electrical/landscaping directory, nationwide incl. Harju | none | Demand-side discovery (static) | Not public; free-style directory appearance | No infrastructure beyond listings; capacity would be a new product | **None** — static directory; evidence discovery is a commodity |
| 2.1 | Riigihangete register | Public construction works ≥ €60k channel-wide | none | Demand-side channel (public buyers) | Free public regime | Not applicable — legal boundary condition, not a product | **None** — below-threshold fit-out sourcing untouched |
| 2.2 | Prokuria | n/a Estonia (UNVERIFIED relevance) | none | Internal procurement tool + supplier events | Per-user/module SaaS, sales-led | RFQ engine exists; crew capacity is a different domain; Estonian install base unproven | **None** — benchmark for workflow shape, not a market presence |
| 2.3 | Quostra (Estonia) | Estonia-wide estimate documents incl. Harju coefficients | none | Internal tool (architects/designers) | Pre-launch; founder waitlist | Estimate layer, not matching; **complementary** — raises brief/quote expectations we must meet | **None** (for matching); timing pressure on our brief builder |
| 3.1 | EZIIL | Steel fabrication, not the 6 trades; Estonian customer base verified | busy-free calendar only — departmental workload for the firm itself (§4 has no state for inward data) | Internal tool (own shop) | Flat €120/mo whole-team — smaller than seat-based; no provider listing concept | **Most credible displacement path in category**: it owns a capacity engine + Estonian SME install base; would need a cross-company exposure product decision + requester side built | **Partial** — not our segment today; the conceptual neighbor with real Estonian traction |
| 3.2 | Procore | n/a Estonia (UNVERIFIED presence) | busy-free calendar only — GC's own crews | Internal tool (GC/specialty) | Enterprise sales-led; far above pilot-firm scale | Would require Baltic GTM + subcontractor network data; years-scale enterprise motion | **None** near-term; ceiling threat only |
| 3.3 | Fieldwire | n/a Estonia (UNVERIFIED presence) | none — tasks/plans | Internal tool (project team) | Freemium $0–$89/user/mo | Different domain (field coordination); capacity would be a new model | **None** |
| 3.4 | Planday | n/a Estonia (UNVERIFIED usage) | busy-free calendar only — own staff shifts (nearest thing to §4 Tentative's data source) | Internal tool (venue staff) | From £2.99/user/mo; SaaS per internal user | Generic shifts ≠ construction crews; plausible future *integration* source for Tentative state, not a competitor | **None** — watch as integration surface, not displacement |

**Read of the matrix:** only one `Strong` (Hange.ee) and two `Partial`s with real relevance (EB for discovery commoditization, EZIIL for capacity-engine adjacency). Availability column (b) is the wall: nothing approaches §4's "Available from [date], [n] workers free" — eleven products have no availability concept at all, three (EZIIL, Procore, Planday) hold inward busy/free calendars that only the firm itself sees, and one (Rementor) could not be assessed from official pages. The §4 three-state model is not an increment on any incumbent; it is a missing column.

---

## 5 — Synthesis: exploitable gaps and threats

### Exploitable gaps (inventory evidence → implication for MVP/GTM)

1. **Requester-facing crew capacity is unclaimed.** Evidence: all 15 entries score `none` or inward `busy-free calendar only` on availability; §4's display exists in zero products. → MVP: build decision #2 exactly as locked; make the §4 three-state availability view the first thing a design-partner PM sees. GTM: the promise is "see who is actually free", never "find subcontractors" — the latter is Hange's/EB's already-taken claim.
2. **Time-to-qualified-response is unoptimized by anyone.** Evidence: portals distribute jobs (Hange: 1000+/month claimed; EB: live object feed) but none reports or optimizes response time; our §9 median <4 h target has no incumbent analog. → MVP: one-click Accept / Quote / Decline by email is the wedge metric; measure and market the median response time from the concierge pilot onward.
3. **Providers pay everywhere except the consumer portals.** Evidence: EB charges subscribers (€119–899/yr), Hange charges posters + 5% winner fees, CV boards charge employers (sales-led); only Osavo/Rementor-style consumer posting is free. → GTM: recruit the 30+ providers (§8) against "listing is free — your trade's discovery tools all charge somebody"; §10's free-listing rule is competitively aligned with a real gap in the market, not a constraint on it.
4. **Multi-trade coordination has no home.** Evidence: Hange/EB/Osavo organize single-scope jobs; no inventoried product coordinates electrical + plumbing + HVAC + drywall + flooring + painting as one request (decision #3 made multi-trade IN). → MVP: keep multi-trade requests; they are the one feature with no analog in the inventory; showcase them to anchor PMs.
5. **The estimate layer is being productised without us (timing, not a gap to fill).** Evidence: Quostra Estonia opens January 2027 with Estonian-standard estimate documents and regional price coefficients. → Expectation management: our AI brief builder should produce briefs that a PM can hand to their estimating process (or Quostra) without rework; revisit at day-30 whether estimate-adjacent output becomes table stakes.

### Threats (evidence → likelihood → what interviews validate or invalidate)

1. **Hange.ee extends into capacity-based matching.** Evidence: closest structural analog (two-sided, construction, ratings, transaction fees, Alltöövõtt stream); displacement path requires provider-side calendar data it does not collect and a B2B shift in a consumer-weighted job mix. Likelihood: **Low-Medium** (12-month). Interviews: how many pilot-segment PMs and providers already use Hange, for which job sizes, with what satisfaction; would its 5% winner fee transfer to crew hiring? If Hange is already the pilot segment's default channel, upgrade this threat and pre-plan counter-positioning (segment density + capacity data + response speed).
2. **Provider attention is already occupied by portal feeds.** Evidence: Hange claims 1000+ procurements/month; EB pushes live object notifications; providers on multiple feeds face the notification fatigue details/10 already rates Medium. Likelihood: **Medium**. Interviews: how many feeds/portals a typical provider runs today, which they mute, what makes them ignore a request. Validates our top-5-not-everyone outreach rule (plan §5) or forces re-tuning.
3. **Adjacent-tool entrants pivot to cross-company capacity.** Evidence: EZIIL owns a working capacity engine and Estonian SME install base (€120/mo flat); Quostra builds Estonian construction reference data launching Jan 2027; both are one strategic decision away from *exposing* capacity outward, but each would need a marketplace side they don't have. Likelihood: **Low** (12-month), **Medium** (24-month). Interviews: none directly; day-30 monitoring item. Watch for EZIIL/Quostra product announcements; both plausibly partner rather than compete with a provider-capacity marketplace (data sellers, not rivals).
4. **Employment substitution absorbs urgent crew demand.** Evidence: CV Keskus ("largest job portal", construction a top sector) and CV.ee (292 construction ads) serve permanent hiring; some urgent demand is met by hiring instead of subcontracting. Likelihood: **Low-Medium**. Interviews: for the last 3 urgent crew needs — did the PM hire, subcontract, or delay? If hiring dominates, the segment's urgency claim weakens and day-30 should re-examine §9's request-success denominators.
5. **Enterprise platform entry (Procore-class).** Evidence: no verified Baltic presence; enterprise sales motion far above pilot scale. Likelihood: **Low** near-term. Action: none beyond monitoring; note any Procore/Fieldwire touchpoints surfacing in interviews.

### Inputs for the day-30 go/no-go synthesis (decision-log #6)

Decision #6 makes day-30 the sole sanctioned revision point for pilot targets. What this research contributes to that synthesis:

- **Targets unchanged by this evidence.** Nothing verified here contradicts §9's targets or the §4/§10 design rules; kill/pivot thresholds (G1 <4/10 + no provider interest → stop, etc.) stand. This research *adjusts positioning and interview emphasis*, not targets.
- **Positioning input:** GTM and interview copy must not claim "no portals exist". The verified landscape is "portals exist for company discovery and job distribution; none shows crew capacity or optimizes response time".
- **Interview measurements that would change the segment bet:** (i) if pilot-segment PMs already source crews through portals in under a day with acceptable reliability, the time-saving value prop narrows to capacity-trust/no-show reduction — reweight §9 metrics accordingly; (ii) if providers report Hange success fees as their normal cost of winning work, free-listing recruitment strengthens and a post-Gate-3 success-fee option becomes validated (does not change §10 for the pilot); (iii) if providers already maintain digital shift calendars (Planday/EZIIL-class), §4 Tentative-state integrations move from hypothesis to Phase-4 roadmap item.
- **Monitoring items for day-30:** Quostra launch state (Jan 2027 target); any EZIIL outward-capacity announcement; Hange product changes around profiles/calendars; Prokuria (or any construction vertical of it) appearing in Estonian procurement conversations.

### Interview hand-off (for `docs/phase0/interview-guides.md`, SUBC-002)

The synthesis above hands the guides named-tool ammunition. Question seeds (paraphrase freely; show names on screen where useful):

1. Which of these do you use today — Ehitusbörs (eb.ee), Hange.ee, Osavo, Rementor, CV Keskus/CV.ee, none of them? *(PM and provider versions)*
2. Do you pay a subscription for finding work or firms (e.g. EB at €119–899/yr)? What do you get for it — worth it?
3. Hange.ee charges the winning bidder 5% of the bid (min €20, max €825, +VAT) on private procurements. Do you pay success fees anywhere? Would you pay one for crew hires?
4. What do you plan crews in today — Excel, MS Project, a shift tool (Planday?), a production planner (EZIIL?), nothing structured?
5. When you shortlist a firm from a portal or directory, how do you find out whether they are actually free on your dates? *(maps directly to §4's Confirmed/Tentative/Unconfirmed)*
6. For the portals you tried and abandoned — what did they not do for you? *(test our UNVERIFIED scale/usage claims against lived experience)*
7. Have you bid on public procurements through the national register? Roughly what share of your work sits under the €60k works threshold? *(sizes how much the official channel constrains the segment)*
8. How do you produce estimate documents (ehitustööde eelarve) today — Excel from scratch, spreadsheet templates, a hired economist, software? *(tests the gap Quostra is betting on)*
9. Providers: what share of last quarter's jobs came through portals vs phone calls and referrals? What share of portal leads was relevant to your trade and area?
10. If a system showed "[n] workers free from [date]" for a crew, would you trust it on day one? What would earn that trust — freshness, ratings, a deposit, nothing?

These seeds are consumed by `docs/phase0/interview-guides.md` (owned by task SUBC-002); the existing guides ask generic "which channels/tools" questions — the named-tool seeds above sharpen them. This file deliberately does not edit the guides.

### Competitive-response risk (framing `docs/details/10-risks-and-legal.md` line 20 — that file is not edited)

The risk register row, verbatim:

> | Competitive response | Existing players or new entrants copy the model | Medium | Network effects, provider relationships, availability data quality and transaction history as moats |

Assessment of each named moat against the actual named incumbents (evidence from sections 1–3):

- **Network effects.** Counter-evidence is real: Hange.ee already runs two-sided construction liquidity (1000+ procurements/month claimed, rated winners, transaction fees) — a copy-the-model starting position exists. Qualification: its liquidity is consumer/small-job shaped; nothing verified shows B2B crew liquidity in the six pilot trades at Tallinn/Harju density, and EB's 21,877-firm database is *information*, not relationships. Verdict: the moat is contestable but real — decision #1's density-over-coverage logic (decision-log rationale) is precisely the play that makes network effects accrue to us first. **Credible if we win segment density.**
- **Provider relationships.** Every B2B incumbent monetizes providers or their counterparts (EB subscriptions; Hange success fees; CV-board employer ads); none offers free listing with matched relevance — our §10 rule is unique in the verified set. Current provider "relationships" with incumbents are transactional, not loyal. Verdict: **strongest near-term moat**; the free-listing wedge converts provider recruitment from a cost into a message.
- **Availability data quality.** No incumbent collects *any* availability data (verified across all 15 — the fit matrix's column (b) is uniformly none/inward). The first mover must accumulate provider behavior over months — a data asset that cannot be copied by shipping a feature. This is also our highest-risk mitigation area (details/10 rates stale availability High), so the moat and the risk are the same asset managed well or badly. Verdict: **the decisive moat; window open now, closes as soon as anyone collects the data.**
- **Transaction history.** Partial counter-evidence: Hange's winner ratings are job-level history buyers can consult. But booking-linked reliability data (accepted-but-not-delivered rates, reschedules, per-trade reliability — §9's reliability metric) is unclaimed. Verdict: **partial moat**; Hange proves history matters to buyers, ours must be deeper (capacity + reliability, tied to real bookings).

**Verdict on the `Medium` likelihood: survives this evidence — keep it.** The evidence cuts both ways: Hange's existence strengthens the "existing players copy" mechanism (that is what likelihood measures), while the absent availability-data layer weakens the *speed* of any copy (that is what the moats protect). Practical reading: Medium stays; the day-30 synthesis should re-score with interview measurements of Hange's pilot-segment usage share — if Hange is already the default channel for interior-fit-out PMs, upgrade toward High and treat counter-positioning as launch-critical; if portals are marginal to the segment, downgrade toward Low.

---

## 6 — Sources appendix

**Research performed:** 3 November 2026, single session. All product pages and pricing sources fetched live via `fn_web_fetch` (text-only; no JS rendering). Search queries were executed as Bing SERP fetches — DuckDuckGo Lite and Mojeek were tried first and abandoned after serving bot-challenge pages; one Estonian-language query set was also mis-parsed by Bing (below).

### Queries run (Estonian and English)

| Query (engine) | Outcome |
|---|---|
| `ehitusportaal ehituse portaal allhankijad Eesti` (Bing) | ✅ yielded EB (eb.ee), e-ehitus context, ehitusuudised |
| `leia ehitaja portaal remont kodutööd platvorm Eesti` (Bing) | ✅ yielded Rementor, Osavo, Hange.ee, KesTeeb, KutsuAbi, KVruum, Leia24 |
| `cvkeskus.ee töökuulutuse hind hinnakiri tööandjale` (Bing) | ✅ located CV Keskus ad-publishing page |
| `eb.ee ehitusbörs tellimuse hind` (Bing) | ✅ located operator terms page (spetsialist.ee) with EB price list |
| `rementor.ee platvorm tehnikud hind tasuta tegiad` (Bing) | ❌ mis-parsed (returned time-zone pages) |
| `tööjõu vahendus ehitus Eesti allhankijad personal` (Bing) | ❌ mis-parsed (returned English "indeed" results) |
| `"rementor" ehitajad platvorm` / `"hanked.riik.ee"` / Estonian procurement queries ×3 (Bing) | ❌ mis-parsed or SERP-thin (Monza Circuit, Kayak, YouTube, Equifax, generic Estonia encyclopedia results) |
| `Estonian public procurement register e-procurement "riigihanked"` (Bing) | ❌ mis-parsed |
| `Prokuria Estonian procurement software founders` (Bing) | ✅ surfaced Tracxn profile (Bucharest origin) + acquisition reports |
| `"ehituse kalkulatsiooni tarkvara"` (Bing, quoted) | ❌ zero results (Bing limitation on niche Estonian phrases) |
| `Estonian construction estimating software cost calculation` (Bing, English) | ✅ yielded Quostra (Estonia) and the ensun Estonia market map (EZIIL, PMtech) |
| `EZIIL construction workforce planning software` (Bing) | ❌ mis-parsed (returned US real-estate results); EZIIL verified by direct fetch instead |
| `Directo majandustarkvara ehitus tööobjektid` (Bing) | ❌ mis-parsed (returned Vitesse Energy investor pages) |
| `Fonn construction management software Baltic` (Bing) | ✅ resolved seed to Access Fonn (The Access Group, Norwegian origin; Google Play, LinkedIn listings) |

### Fetched-URL ledger (outcomes this session)

Fetched successfully (200): `www.ehitusuudised.ee`, `kodutoo.ee` (wrong seed — homework site), `www.cvkeskus.ee`, `eb.ee`, `eb.ee/tellimine` (no prices rendered), `cvonline.ee` → redirect `cv.ee/et`, `rementor.ee` (+`/testing`, JS-thin), `osavo.ee` (JS-thin), `www.hange.ee`, `www.hange.ee/hinnakiri` (full pricing), `spetsialist.ee/kasutustingimused` (full EB pricing), `www.cvkeskus.ee/toopakkumise-avaldamine` (no public prices), `cv.ee/et/services` (JS-thin), `kvruum.ee/leia-ehitaja`, `leia24.ee`, `www.prokuria.com`, `www.prokuria.com/pricing` (estimator, email-gated), `www.prokuria.com/about-us`, `et.wikipedia.org/wiki/Riigihange` (thresholds, cites the statute), `finbite.ee` → `finbite.eu`, `www.directo.ee` (JS-thin), `quostra.com` (French arm), `quostra.com/ee-en/software` (full Estonia product), `eziil.com` (full: pricing + named Estonian customers), `www.procore.com`, `www.fieldwire.com/pricing/` (full pricing), `www.planday.com/pricing` (tiers; GBP page), `toggl.com/track/` → `toggl.com`.

Hard failures and blocks (recorded, never silently included): `ehitus360.ee` and `www.ehitus360.ee` — DNS NXDOMAIN (dead seed); `riigihanked.rik.ee`, `hanked.riik.ee`, `kalkupank.ee`, `fonn.ee`, `fonnbuild.com`, `fonnbuild.ee`, `pmtech.lv` — DNS do-not-resolve; `www.riigihanked.ee` — DNS resolves, fetch refused; `riigihanked.ee` — fetch failed; `www.rahandusministeerium.ee/en`, `www.rtk.ee`, `www.riik.ee` (fetch failed), `e-estonia.com/?s=procurement`, `www.theaccessgroup.com/en-gb/construction/products/fonn`, `fonn.com`, `buildertrend.com` and `buildertrend.com/pricing/` — HTTP 403 (government/WAF blocks); `simap.ted.europa.eu/national-procurement-portals` — 202 challenge page; `web.archive.org` snapshot lookup for the register — 404/429; `osavo.ee/hinnakiri` — 404; `www.cvkeskus.ee/hinnakiri` — 404; `ehitusuudised.ee/toopakkumised` — 404; `www.procore.com/en-us/pricing` — 404; `ensun.io/search/construction-software/estonia` — 429 (twice).

DNS probes via local resolver (read-only, documented for the register/fonn investigations): `www.riik.ee`, `www.rik.ee`, `rahandusministeerium.ee`, `rtk.ee`, `eesti.ee`, `hanked.ee` resolve; the domains listed as NXDOMAIN above genuinely do not exist from this network.

### UNVERIFIED items (with what would confirm each)

1. **Official riigihangete register URL + live terms** (entry 2.1) — old `riigihanked.rik.ee` dead; `riigihanked.ee` resolves but refused this session's fetcher; all Estonian gov sites 403-blocked the session network. Confirm by opening riigihanked.ee (and hanked.riik.ee if applicable) in a normal browser; capture the environment's supplier-fee terms. Threshold figures (€30k/€60k/€150k, TED layer) come from the fetched Wikipedia *Riigihange* article citing the Riigihangete seadus — statutory text cross-check recommended at legal review (Decision 5).
2. **Prokuria Estonian relevance** (2.2) — official about-page states US/UK/Romania; no Estonian customers claimed. Any Estonian usage would surface in interviews; Tracxn's Bucharest origin + 2026 CenterPoint acquisition are third-party (SERP) — confirm via official press release if load-bearing.
3. **Rementor pricing and scale** (1.4) — JS-rendered FAQ suggests free project posting; content not fetchable. Confirm in a JS-capable browser: posting fees, provider fees, worker-pool size.
4. **Osavo provider-side pricing** (1.3) — customer posting free (stated); provider economics not public (no pricing page; 404 on /hinnakiri). Confirm via browser walkthrough or contacting the operator.
5. **EZIIL company origin** (3.1) — Estonian customers verified on the official site; the company's own origin country is not stated on the fetched page. Confirm from company registry if ever load-bearing.
6. **Estonian presence of Procore, Fieldwire, Planday, Buildertrend, Fonn** (3.2–3.4 + appendix) — no Estonian/Baltic claims found on fetched pages; adoption here is an interview question ("which of these have you touched?"), not a settled fact.
7. **Buildertrend and Fonn (Access) product facts** — official pages 403-blocked; SERP descriptions only. Verify in a browser before citing either in any downstream doc.
8. **Toggl Estonian origin** (adjacent note) — widely known but not stated on the fetched page; confirm from official sources if ever load-bearing.
9. **Statistics Estonia construction price indices** — government-hosted reference for cost data; unreachable this session. Fetch from an unrestricted network when estimate-data questions matter.
10. **EB international editions (buildinginfo.eu; Leedu/Ukraina/Moldova links)** — seen on official pages/search results; scope and pricing not investigated this session. Relevant only if Baltic expansion (Phase 4) returns.

No prices appear in this document that were not read from an official fetched page on 2026-11-03, except where explicitly marked UNVERIFIED above.

---

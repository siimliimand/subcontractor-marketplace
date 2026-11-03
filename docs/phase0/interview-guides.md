# P1.A — Discovery Interview Guides (PMs + contractors)

**Date:** 3 November 2026
**Status:** Ready for Phase 1 interviews. Companion to `docs/details/07-gtm-and-liquidity.md` Phase 1; feeds Gate 1 (`docs/details/08-metrics-and-pilot-gates.md`, lines 75–84).
**Purpose:** Turn the raw question lists and scorecard in `docs/details/07-gtm-and-liquidity.md` Phase 1 into interview kits a founder can run this week: per-question evidence capture, an operationalised 6-dimension scorecard, a recruiting pipeline for ~10 PMs + ~15 contractors, and lawful-outreach consent guidance.
**Decision it feeds:** Gate 1 go/no-go (`docs/details/08-metrics-and-pilot-gates.md`); Workstream C conversion targets (`docs/implementation-plan.md` lines 72–84: ≥3 PM commitments, ≥15 provider expressions); day-30 synthesis (`docs/plan.md` §14). Decision-log #4 names interviews the critical path, not code.

---

## 1. Purpose and how to use

- **What this is.** The evidence-collection instrument for Phase 1 discovery: one English master guide (analysis, scoring, structure) plus Estonian field wording (spoken delivery). Use this file to run ~10 project-manager interviews and ~15 contractor/provider interviews — the interview count in `docs/plan.md` §14 line 230 and `docs/details/07-gtm-and-liquidity.md` Phase 1.
- **Who runs it.** The founder, solo (decision-log #4: "Interviews and recruitment are the critical path, not code"). The guides are designed for one person scheduling, interviewing, and scoring.
- **Segment (decision-log #1).** Interior fit-out, Tallinn + Harju County, six trades: electrical, plumbing, HVAC, drywall/partitions, flooring, painting/finishing. Every question and probe is scoped to this segment; do not broaden during interviews.
- **The anti-hypothetical rule (`docs/implementation-plan.md` line 60).** Log concrete recent examples, never hypotheticals. Every claim should be anchored to a dated, countable recent case ("the electrical job in September where I called nine firms"), not a general opinion ("usually it takes a while"). The interview guide enforces this through follow-up probes on every question.
- **EN master vs ET field versions.** This file is the English master: structure, scoring, evidence rules. The Estonian field wording appears under every English question and in the consent script so an interviewer can print and read it aloud — the founder plans in English, interviews in Estonian. Analytical guidance (what a question feeds, weak-answer patterns) stays English-only by design.
- **Budget context (`docs/phase0/cost-estimate.md` lines 25–26).** This deliverable unblocks "Interview guides + recruiting 10 PMs + 15 contractors (30–40 h, weeks 1–2)" and "25 interviews + scoring + synthesis (50–60 h, weeks 2–4)". Budget roughly 45–60 minutes per interview plus scoring.
- **Out of scope.** The interviews themselves are human work and are not part of this file's completion; nothing here marks them done.

## 2. Recruiting pipeline (~10 PMs + ~15 contractors)

### 2.1 Target funnel

Over-invite to land the Gate 1 denominators (10 PMs, 15 providers) with attrition margin.

| Stage | PMs | Providers | Rule of exit |
|---|---|---|---|
| 1. Identify | ~20 | ~30 | Company-level candidate list built (§2.2 channels) |
| 2. Outreach | ~20 | ~30 | Personal invitation sent (§2.4 consent guidance) |
| 3. Agreed + consented | ~12 | ~20 | Verbal consent via the §3 script before any interview |
| 4. Scheduled | ~11 | ~17 | Calendar slot fixed |
| 5. Interviewed | **10** | **15** | Session done (Gate 1 denominators) |
| 6. Scored | 10 | 15 | 6-dimension scorecard filled within 24 h, evidence quotes attached (§6) |
| 7. Follow-up / conversion | ≥3 PM commitments | ≥15 provider expressions | Workstream C weeks 3–4 targets (`docs/implementation-plan.md` line 77) |

### 2.2 Sourcing channels (grounded in repo findings)

1. **Founder's own network first.** Warm introductions give the highest consent rate and are the lowest-risk channel while the cold-contact classification is open with the lawyer (see §2.4). Decision-log #4 makes recruitment the founder's core work.
2. **Äriregister open data (`docs/phase0/register-findings.md` §1).** Filter by EMTAK construction codes 41–43 and Harju county; licence CC BY 4.0. Export **company-level fields only** (name, EMTAK, county) — not board-member names, which are natural-person data.
3. **MTR/Tarvik trade-notification holders (`docs/phase0/register-findings.md` §2).** For the licensed trades (electrical and construction activity notices): public no-login search and daily open-data XML. Use for candidate identification only; the CC BY-SA 3.0 share-alike caveat means do not republish derived datasets.
4. **Referrals.** End every interview by asking each interviewee for one or two names ("who else should I talk to?") — snowball sourcing converts trust you have already earned.
5. **Conversion, not new acquisition.** Interviewees who score high on willingness (§6) are the design-partner and provider-recruitment pipeline (Workstream C). The recruiting funnel for the pilot is the interview funnel.

### 2.3 Interview tracker — fields only

Track each candidate across the funnel with these fields. **The tracker and every filled interview record live outside this repository** (a private founder file/spreadsheet — see §7): interviewee contact details are personal data (`docs/phase0/gdpr-checklist.md` §1) and personal data must never enter git.

| Field | Values / format |
|---|---|
| Interview ID | `P1-NNN` |
| Date | YYYY-MM-DD |
| Interviewee type | PM / provider |
| Trade(s) | electrical / plumbing / HVAC / drywall / flooring / painting |
| County | Harju / other |
| Company size band | <5 / 5–20 / 21–100 / >100 people (providers: also OÜ / FIE) |
| Acquisition channel | network / registry / referral / other |
| Consent status | notes-only (default) / recording-yes (+date) / declined |
| Scorecard scores | 6 dimensions, 1–5 or blank (§6) |
| Evidence refs | quote IDs per score |
| Gate-1 facts | time drain Y/N; failed commitment in last 6 months Y/N; pilot commitment (PM); expression of willingness (provider) |
| Follow-up action | what, owner, date |
| Opt-out registered | Y/N — do-not-contact flag |

### 2.4 Consent guidance at each recruiting stage (references `docs/phase0/gdpr-checklist.md`)

| Stage | Data touched | Guidance |
|---|---|---|
| Identify | Company name, EMTAK, county from registry exports | Keep it company-level. Board names are natural-person data (`docs/phase0/gdpr-checklist.md` §1) — do not pull them into the tracker. |
| Outreach | Contact person's email/phone | Interviewee contact details are personal data (`docs/phase0/gdpr-checklist.md` §1). The ePrivacy B2B cold-contact classification for commercial outreach is still an open lawyer question (`docs/phase0/gdpr-checklist.md` §5, question 3) — therefore prefer warm channels, keep outreach personal and low-volume (individual messages, not campaigns), and include an opt-out line in every invitation ("if you would rather not hear from me, say so and I will not contact you again"). Log every opt-out in the tracker and honour it. |
| Consenting | Interview notes and recordings | Get verbal consent with the §3 script before the interview. FIE providers are natural persons with full GDPR rights (`docs/phase0/gdpr-checklist.md` §5, question 2) — treat a sole trader exactly like a consumer. |
| Recording | Audio files | Recordings only with a clear yes; default is notes-only. Delete recordings once the summary is written. |
| After | Anonymised summaries | The published privacy notice (ET + EN) is still pending per `docs/phase0/gdpr-checklist.md` §4 — see §3 for honest wording. Filled records and the tracker stay outside the repo; only anonymised findings may later be written into docs. |

## 3. Consent & intro script

Spoken at the start of every interview, both sides (PM and provider). Delivered in Estonian in the field — the Estonian field version lives in §3.2 of this file — with the English master below for reference.

### 3.1 English master

> Hello! My name is [name]. Together with Rajahinta OÜ I am preparing a pilot project: we are researching how subcontractors are found for interior fit-out projects in Tallinn and Harju County, so that a tool can be built that makes sourcing faster and more reliable — across six trades: electrical, plumbing, HVAC, drywall and partitions, flooring, and painting and finishing.
>
> This conversation takes about 30–45 minutes. I have [7 / 6] questions about your everyday work; what matters most to us are concrete recent examples, not general opinions.
>
> I will take notes regardless. Do you also agree that I record the conversation as audio? (Recording is voluntary — if not, I will rely on notes only.) Recordings are used for internal analysis only and are deleted once the summary is written. Summaries are anonymised: neither your name nor your company's name appears in them.
>
> You can skip any question, and you can stop the conversation at any time — that is completely fine. I only ask for what the research needs: trade, region, crew size. Your contact details are used only for this research and are deleted whenever you ask.
>
> One honest note: our public privacy notice is still being finalised with a lawyer and will be complete before pilot data collection starts. If you have questions about how your information is used, I will answer them or pass them on to the company.

### 3.2 Estonian field version

> Tere! Minu nimi on [nimi]. Koos Rajahinta OÜ-ga valmistame ette pilootprojekti: me uurime, kuidas leitakse alltöövõtjaid siseviimistlusprojektides Tallinnas ja Harjumaal, et ehitada tööriist, mis muudab alltöövõtjate leidmise kiiremaks ja usaldusväärsemaks — kuues erialas: elektritööd, sanitaartehnilised tööd, ventilatsioon ja kliima, kipsplaat- ja vaheseinatööd, põrandatööd ning värvimis- ja viimistlustööd.
>
> See vestlus võtab aega umbes 30–45 minutit. Küsimusi on [7 / 6] teie igapäevatöö kohta; kõige väärtuslikumad on konkreetsed hiljutised näited, mitte üldised hinnangud.
>
> Märkmeid teen kindlasti. Kas te nõustute, et salvestan vestluse ka helisalvestisena? (Salvestamine on vabatahtlik — kui mitte, piirdun ainult märkmetega.) Salvestist kasutan ainult sisemiseks analüüsiks ja kustutan selle, kui kokkuvõte on valmis. Kokkuvõtetes on kõik anonüümne: ei mainita teie ega teie ettevõtte nime.
>
> Iga küsimuse võite vahele jätta ja vestluse võite igal ajal katkestada — see on täiesti normaalne. Küsin ainult seda, mida uuring vajab: eriala, piirkond, meeskonna suurus. Teie kontaktandmeid kasutan ainult selle uuringu tarbeks ja kustutan need alati, kui te seda palute.
>
> Üks aus märkus: meie avalik privaatuspoliitika on veel advokaadi läbivaatusel ja valmib enne pilootprojekti andmete kogumist. Kui teil on küsimusi, kuidas teie andmeid kasutatakse, vastan neile hea meelega või edastan need ettevõttele.

**Script rules:** never promise a published privacy notice (it is still in draft — `docs/phase0/gdpr-checklist.md` §4; lawyer review pending per decision-log #5). Recording consent must be an explicit yes; silence or hesitation is notes-only. Say the six trades by name — it signals segment seriousness and screens out-of-segment candidates.

## 4. PM interview guide (7 questions)

Each question: canonical English (verbatim from `docs/details/07-gtm-and-liquidity.md` Phase 1), Estonian field wording, and evidence guidance in four parts — **Feeds** (what the answer evidences), **Probes** (follow-ups that force concreteness), **Record verbatim** (what to quote in scoring), **Weak-answer patterns** (politeness and vagueness to challenge). Target ~45 minutes for the full set. In the Estonian field wording the interviewee — the project manager, *projektijuht* — is addressed in polite plural („te).

### PM-1 — "Tell us about the last time you needed a subcontractor urgently."

**ET:** „Rääkige, millal te viimati vajasite kiiresti alltöövõtjat."

- **Feeds:** Problem frequency + Problem severity; the Gate 1 thresholds "≥7/10 PMs describe sourcing as a significant time drain" and "≥5/10 report failed commitments or no-shows in the past 6 months" (`docs/details/08-metrics-and-pilot-gates.md` lines 75–84); the baseline "Average PM time spent on sourcing" (`docs/details/01-segments-and-market.md` line 74). Opens the interview with a concrete case that all later questions anchor to.
- **Probes:** When exactly — date or week? Which trade and what scope (m², systems)? What made it urgent? How many firms did you call that day? How long until someone confirmed? What did you or the crew do while waiting? What did the delay cost — penalties, overtime, slippage?
- **Record verbatim:** the concrete case — project type, dates, trades, number of firms contacted, hours spent sourcing, delay length, money at stake.
- **Weak-answer patterns to challenge:** hypotheticals ("usually we would call our guys"); a story with no date or counts; politeness bias ("everything always works out"); vague frequency ("sometimes it's hard"). Challenge gently: "When exactly was that? How many did you call? How long until a useful answer? What did the delay cost?"

### PM-2 — "How did you find potential providers? How many did you contact?"

**ET:** „Kuidas te leidsite võimalikke alltöövõtjaid? Kui mitmega võtsite ühendust?"

- **Feeds:** Current solution satisfaction; the baselines "Providers contacted per request" and "Subcontracting requests per company per month" (`docs/details/01-segments-and-market.md` lines 76–77); evidence for the Willingness-to-change dimension (what alternatives they already know).
- **Probes:** Which channels exactly — own contact list, colleague referrals, registries, portals? How is the list maintained? Average contact count per request — and in the urgent case from PM-1? Have you tried any portal or register? What happened?
- **Record verbatim:** the channel list with contact counts ("called 8 firms, 3 answered, 1 quoted"), plus any tool or site names they mention.
- **Weak-answer patterns to challenge:** "my network" without counts; "I know everyone" (probe: what happens when your first choice is unavailable?); inability to give a per-request number. If no number surfaces, ask them to recall the last request and count on their fingers.

### PM-3 — "How long did it take to receive a useful response?"

**ET:** „Kui kaua kulus, enne kui sõite kasuliku vastuse?"

- **Feeds:** Problem severity (time cost); Gate 1 significant-time-drain threshold; baseline "Average PM time spent on sourcing" (`docs/details/01-segments-and-market.md` line 74); the pilot target "Time to response < 4 business hours" (`docs/details/08-metrics-and-pilot-gates.md`) that discovery baselines will calibrate.
- **Probes:** In the concrete case from PM-1 — hours or days? What counts as "useful" for them — a reply, a price, a confirmed crew? How many reminders did it take? Did anyone commit and then withdraw?
- **Record verbatim:** the duration ("4 days, 6 calls, first useful answer on Thursday") and their definition of "useful".
- **Weak-answer patterns to challenge:** "it depends" without a case; "fast enough" (probe: fast enough is how many hours?); declining to estimate. Anchor to the PM-1 case: "In that September job — how many days?"

### PM-4 — "What caused delays or failed commitments?"

**ET:** „Mis põhjustas viivitusi või kokkulepete mittetäitmist?"

- **Feeds:** Problem severity; the Gate 1 threshold "≥5/10 report failed commitments or no-shows in the past 6 months" (`docs/details/08-metrics-and-pilot-gates.md` lines 75–84). This is the reliability pain that motivates the pilot's availability-confirmation metric.
- **Probes:** What exactly happened — no-show, missed deadline, quality failure, price change after agreement? How many such incidents in the last 6 months? What did the worst one cost — penalty clause, overtime, client trust?
- **Record verbatim:** one or more specific incidents dated within the last 6 months, with costs; the exact words they use for no-shows (useful later in outreach copy).
- **Weak-answer patterns to challenge:** "that never happens to us" (probe: how do you protect against it — and did that protection ever fail?); blaming subcontractors in general without naming an incident; hypothetical risks instead of real ones.

### PM-5 — "How do you verify qualifications and availability?"

**ET:** „Kuidas te kontrollite kvalifikatsiooni ja kättesaadavust?"

- **Feeds:** Current solution satisfaction + Willingness to change; validates the verification-badge work seeded by `docs/phase0/register-findings.md` (MTR/Tarvik notifications, Äriregister status).
- **Probes:** Do you check trade notifications (MTR/Tarvik), references, insurance, registry status? How long does a check take? Have you ever been burned by skipping it? For an unknown firm — what is the minimum check?
- **Record verbatim:** the actual checks and their cost ("I call two references — that's a day gone"), the sites and tools used.
- **Weak-answer patterns to challenge:** "I just know them" (probe: and for a firm you don't know?); "references" without describing how; no recall of any check ever failing. These usually hide that verification is skipped under time pressure — probe the last urgent case.

### PM-6 — "Which part of the process creates the greatest cost or risk?"

**ET:** „Milline osa protsessist tekitab kõige suuremat kulut või riski?"

- **Feeds:** Problem severity (ranks the pain); the week-4 problem-severity map in `docs/implementation-plan.md` (Phase 1, Workstream A); decides what the product must fix first — sourcing, verification, chasing, or reliability.
- **Probes:** Cost per project in hours or euros? Which risk does the client notice? Rank the steps: finding, verifying, chasing responses, no-shows, price surprises. What makes the worst step worse?
- **Record verbatim:** their ranking and the reason attached to numbers ("chasing is the worst — half a day per request, sometimes for nothing").
- **Weak-answer patterns to challenge:** "everything is a problem" (force a 1st-worst choice); "no real problems" (cross-check against PM-1–PM-4 evidence and quote the contradiction back neutrally); answers that contradict earlier stories.

### PM-7 — "Would you use an external platform alongside your existing contacts? Why or why not?"

**ET:** „Kas te kasutaksite oma seniste kontaktide kõrval ka välist platvormi? Miks või miks mitte?"

- **Feeds:** Willingness to change + Willingness to pilot + Decision authority; the Workstream C target "≥3 PM commitments to pilot participation" (`docs/implementation-plan.md` lines 79–84). Pain without this answer converting is a pivot signal, not a win.
- **Probes:** What would it have to prove in the first week? What would make you stop using it? Who else in your company would have to agree? What if it already contains firms you trust? What if it contains your competitors' crews?
- **Record verbatim:** their condition list ("if it has real available firms in November, I would post a request this month") and the name/role of any decision gatekeeper.
- **Weak-answer patterns to challenge:** polite interest without conditions ("sure, sounds great" — probe: what would it have to show on day one?); "we're too small / too specific" (probe against the concrete PM-1 case); interest with no authority to commit (route to Decision authority scoring).

## 5. Provider interview guide (6 questions)

Same four-part structure. Providers are frequently FIEs (sole traders) — natural persons with full GDPR rights (`docs/phase0/gdpr-checklist.md` §5, question 2); keep the §3 script's minimal-data promise especially visible. Target ~30 minutes.

### PR-1 — "How do you currently find new projects?"

**ET:** „Kuidas te praegu uusi projekte leiate?"

- **Feeds:** Problem frequency + Current solution satisfaction on the supply side; the baseline "Subcontractor utilisation rates" (`docs/details/01-segments-and-market.md` line 75); Gate 1's provider-interest threshold (≥15 expressions) needs this context to interpret.
- **Probes:** Which channels — general contractors you know, other subcontractors' referrals, public procurements, portals? How many new clients in the last 6 months? Were there idle months? How did those months end?
- **Record verbatim:** channels with counts ("3 new GC clients this year, 2 through referrals"), plus idle periods and what triggered work again.
- **Weak-answer patterns to challenge:** "we have enough work" (probe: has that held for 12 straight months? — still map their channels, the platform is for future gaps too); vague "word of mouth" without a recent example; "everyone knows us" (probe: which of those people would you call this month?).

### PR-2 — "How far ahead can you reliably estimate team availability?"

**ET:** „Kui palju ette saate oma meeskonna kättesaadavust usaldusväärselt hinnata?"

- **Feeds:** The core assumption "Providers will share availability information" (`docs/details/08-metrics-and-pilot-gates.md`, success threshold: 70% maintain current availability); capacity-declaration design (headcount per trade per date, per `docs/phase0/gdpr-checklist.md` §3); baseline "monthly capacity and gaps" (`docs/details/01-segments-and-market.md` line 75).
- **Probes:** Horizon in weeks — and when does it become guesswork? How does one new order change the plan? How often do schedules slip, per month? Could you update a shared calendar or list — how often, and what would make that annoying?
- **Record verbatim:** the reliable horizon ("2–3 weeks, after that it depends"), crew size per trade, and the update frequency they could realistically keep.
- **Weak-answer patterns to challenge:** "we're flexible" without a horizon (probe: if I asked about next Tuesday, next month, next quarter?); claimed perfect foresight (probe: what broke your last plan?); no crew count given.

### PR-3 — "Which types of requests are worth responding to? What makes you reject one?"

**ET:** „Millistele päringutele tasub vastata? Mis paneb teid päringust keelduma?"

- **Feeds:** Willingness to change (defines what a "relevant request" is); matching and eligibility-filter design; the concierge metric "Reasons for provider declines" (`docs/details/07-gtm-and-liquidity.md` Phase 4); Gate 1 provider-expressions quality (expression ≠ any request, expression = relevant ones).
- **Probes:** What makes a request rejectable — unclear scope, too small, distance, impossible schedule, payment terms, missing drawings? Minimum job size? How many requests did you decline last month, and why?
- **Record verbatim:** their reject checklist ("no drawings → skip; over 50 km → skip; start under two weeks → skip") and the profile of a request they would accept.
- **Weak-answer patterns to challenge:** "we look at everything" (probe: which request did you decline last, and why?); no minimum size; claiming to answer all (cross-check with their actual response behaviour on PR-1 counts).

### PR-4 — "What information do you need before quoting?"

**ET:** „Millist teavet te vajate enne hinnapakkumise tegemist?"

- **Feeds:** Willingness to change; request/brief structure — direct input to the AI brief builder and request form; feasibility of the "Time to response < 4 business hours" target (`docs/details/08-metrics-and-pilot-gates.md`).
- **Probes:** Which documents — drawings, areas, room list, schedule, site access, existing conditions? Do you quote remotely or after a site visit, and for what job sizes? What is most often missing, and what does that cost you?
- **Record verbatim:** the pre-quote checklist and the usual missing pieces ("no electrical layout → first quote is a guess, re-quote later").
- **Weak-answer patterns to challenge:** "depends" with no items (force: a 200 m² office fit-out — what do you need to price it?); "I always visit the site" (probe: for small jobs too? what do you do before the visit?).

### PR-5 — "How much administrative work would you accept in exchange for relevant leads?"

**ET:** „Kui palju halduslikku tööd oleksite nõus tegema asjakohaste tööpakkumiste eest?"

- **Feeds:** Willingness to change + Willingness to pilot (adoption friction); onboarding design; the assumption "Email-based responses reduce friction" (`docs/details/08-metrics-and-pilot-gates.md`).
- **Probes:** Today's admin — quotes, invoices, declarations; how many hours per week? Would you register a profile once? Update capacity weekly? Answer three structured questions per request? Where exactly is the limit — logins? Per-request forms? Anything requiring an app?
- **Record verbatim:** the acceptable-effort statement ("10 minutes per request, no logins — email only") as a concrete boundary.
- **Weak-answer patterns to challenge:** "no admin at all" (probe: you already write quotes — what makes this different?); enthusiasm without limits (probe: what if it's five minutes per request, every day?); "depends on the money" without an effort figure.

### PR-6 — "Would you share capacity information, and under what conditions?"

**ET:** „Kas ja millistel tingimustel te jagaksite teavet oma võimekuse kohta?"

- **Feeds:** Willingness to pilot (provider side) → the Gate 1 threshold "≥15 providers express willingness to receive relevant requests" (`docs/implementation-plan.md` line 84, `docs/details/08-metrics-and-pilot-gates.md` lines 75–84); the assumption "Providers will share availability information" and its 70% success threshold.
- **Probes:** Share what — free/busy dates, crew count per week, "next free slot"? To whom — everyone, or only in response to a fitting request? Fears: competitors poaching crews, being flooded with junk requests, being locked into commitments? What would make sharing feel safe? Would weekly updates be realistic?
- **Record verbatim:** their yes/no plus the exact conditions ("only free days, updated weekly, not visible to other providers") — the condition list is the product requirement.
- **Weak-answer patterns to challenge:** flat refusal without explored conditions (probe each fear separately — refusals often soften to conditional yeses); "yes to everything" without limits (probe: what if a competitor sees your crew dates?); conditional yes with vague conditions (probe until the condition is operational).

## 6. Scorecard operationalised

Source: `docs/details/07-gtm-and-liquidity.md` Phase 1 ("Interview scorecard (score 1–5, evidence required for each)"). Dimensions verbatim; anchors below operationalise the 1–5 scale for the construction domain.

**Scoring rules (both mandatory):**

1. **Evidence-required rule:** a score without a quoted observation from the interview is invalid. Write the supporting quote (or its log reference) next to every score; scores without evidence are discarded at synthesis.
2. **Blank-when-unknown rule:** if the question was not asked or the answer stayed unclear, leave the dimension **blank** — never default to 3. Blank is information: synthesis reports coverage per dimension.

### 6.1 Dimensions and anchors (1 / 3 / 5)

| Dimension | Score | Anchor (concrete observation required) |
|---|---|---|
| **Problem frequency** | **5** | Names 3+ concrete incidents within the last 3 months, or states the problem occurs on most projects and estimates occurrences per month ("every project, I lose a day or two chasing subs"). |
| | **3** | Recalls 1–2 concrete instances in roughly the last 6 months; the problem shows up on some projects (a few per quarter), not all. |
| | **1** | Cannot recall a concrete recent instance; talk stays abstract ("it happens"), or they say it is rare ("maybe once a year"). |
| **Problem severity** | **5** | Can name a recent project where a sourcing failure cost a specific measurable delay or penalty — days of slippage, a late-completion penalty, overtime bill, lost client ("the electrical rough-in slipped two weeks; we paid €4k in penalties"). |
| | **3** | Describes concrete costs (hours spent calling, schedule pressure, coordination rework) but cannot attach them to a named project or a number. |
| | **1** | Cannot recall a concrete instance; claims the problem has cost them nothing or is manageable. |
| **Current solution satisfaction** | **5** | Actively dissatisfied: describes broken workarounds, abandoned alternatives (a portal they quit, a spreadsheet that rots), or open complaints about how unreliable their current channels are. |
| | **3** | Mixed: their own long-term contacts work; frustration concentrates on urgencies, new trades, verification, and chasing responses — they manage but grumble. |
| | **1** | Genuinely satisfied with current contacts and process; no frustration expressed even when probed on urgent cases. |
| **Willingness to change** | **5** | Already experimenting (new channels, tools, registries) or states concretely what would make them switch and asks to hear more ("show me it has available crews in November and I'll try it"). |
| | **3** | Open in principle: will try a tool that fits the current workflow without extra admin; wants to see their own trades and firms in it first. |
| | **1** | Committed to current relationships; explicit resistance ("we only work with people we know"); no plausible trigger to change. |
| **Decision authority** | **5** | Personally selects subcontractors and approves engagement; can commit the company to a pilot during the interview. |
| | **3** | Shortlists and recommends but needs a superior's or client's sign-off; can champion the tool internally. |
| | **1** | No authority over sourcing or tooling choices; executes decisions made by others. |
| **Willingness to pilot** | **5** | Concrete commitment: agrees to send real requests within 2–4 weeks, schedules the follow-up during the interview, or names the project they would trial it on. |
| | **3** | Positive but non-committal: agrees to a next meeting or to review material — without a date or a named project. |
| | **1** | Declines or deflects ("maybe later", "send something and we'll see") with no agreed follow-up. |

**Provider-side reading of the same dimensions** (score provider interviews on the same 1–5 scale):

- *Problem frequency / severity* = how often finding new work (or filling schedule gaps) is a real struggle, and what idle weeks or missed margins cost them.
- *Current solution satisfaction* = satisfaction with today's lead sources (GC relationships, word of mouth, portals).
- *Willingness to change* = readiness to accept a structured, request-relay channel instead of/alongside today's channels.
- *Decision authority* = the person interviewed decides commercial commitments (for FIEs, usually trivially 5).
- *Willingness to pilot* = willingness to receive relevant requests with stated conditions — this is the counter that feeds "≥15 provider expressions".

### 6.2 Estonian labels and anchor-band summaries

Full anchor analysis (§6.1) stays English-only; these Estonian labels and one-line band summaries are for the Estonian-speaking interviewer during the session.

| EN dimension | ET label | Anchor-band summary (ET) |
|---|---|---|
| Problem frequency | Probleemi sagedus | 1 = ei suuda ühtegi konkreetset juhtumit meenutada; 3 = 1–2 konkreetset juhtumit viimase ~6 kuu kohta; 5 = mitu konkreetset juhtumit viimase 3 kuu jooksul. |
| Problem severity | Probleemi tõsidus | 1 = kulu ei ole nimetatav; 3 = kulu on mainitud, aga ilma konkreetse projektita; 5 = hiljutine projekt koos mõõdetava viivituse või rahalise kahjuga. |
| Current solution satisfaction | Rahulolu praeguse lahendusega | 1 = praegune viis rahuldab täielikult; 3 = saab hakkama, aga kurnab (kiired juhtumid, uued erialad); 5 = praegune viis on katki, alternatiivid on proovitud ja maha jäetud. |
| Willingness to change | Valmidus muutuseks | 1 = jääb seniste kontaktide juurde; 3 = hindab, kui see sobib olemasoleva töövooga; 5 = otsib ise juba lahendusi ja tahaks kohe proovida. |
| Decision authority | Otsustusõigus | 1 = ei otsusta; 3 = soovitab, otsustab ülemus või tellija; 5 = otsustab iseseisvalt ja saab pilotiga liitumise koheselt kinnitada. |
| Willingness to pilot | Valmidus pilotiga liituda | 1 = keeldub või venitab; 3 = nõus järgmiseks kohtumiseks ilma kuupäevata; 5 = lubab 2–4 nädala jooksul esitada päringuid või nimetab konkreetse projekti. |

### 6.3 Gate 1 mapping

Each Gate 1 threshold (`docs/details/08-metrics-and-pilot-gates.md` lines 75–84; `docs/implementation-plan.md` lines 79–84) reads the scorecard as follows:

| Gate 1 threshold | Scorecard dimensions | How evidence maps |
|---|---|---|
| ≥7/10 PMs describe sourcing as a significant time drain | Problem frequency + Problem severity | A PM counts when **both** dimensions score ≥3 with quoted time/cost evidence; otherwise they do not count toward the 7. |
| ≥5/10 report failed commitments or no-shows in the past 6 months | Problem severity (via PM-4 evidence) | Counts when the log quotes a specific incident dated within the last 6 months. |
| Kill signal: <4/10 significant **and** no provider interest | Current solution satisfaction + Willingness to change (both sides) | Suspect the kill path when frequency <3, severity <3 and satisfaction ≥4 dominate the PM set while provider Willingness-to-pilot stays blank/1. |
| Pivot signal: pain is real but in a different trade cluster or region | All dimensions, cut by trade + county | Use the log's trade and county fields (§7) to detect the pain concentrating elsewhere. |
| ≥3 PM commitments to pilot participation | Decision authority + Willingness to pilot | Counts when Decision authority ≥3 **and** Willingness to pilot = 5 with a scheduled follow-up; "interest" alone never counts. |
| ≥15 providers express willingness to receive relevant requests | Willingness to pilot (provider reading; PR-6) | Counts when a provider agrees to receive relevant requests with stated conditions (score ≥3 with the condition quoted). |

## 7. Interview log template

One record per interview. **Storage rule (repeated): the log, the tracker, and every filled record live outside this repository.** Interviewee details are personal data (`docs/phase0/gdpr-checklist.md` §1); only anonymised findings may later be written into docs.

```text
INTERVIEW LOG — P1-NNN                     Date: YYYY-MM-DD  Interviewer: [name]
Type: PM | Provider         Trades: [six-trade list]      County: Harju | other
Firm size band: <5 | 5–20 | 21–100 | >100   Legal form (provider): OÜ | FIE
Channel: network | registry | referral | other
Consent: notes-only (default) | recording-yes (YYYY-MM-DD) | declined
Opt-out registered: Y/N

Evidence quotes (short verbatim, per question)
  Q1: "..."   Q2: "..."   Q3: "..."   Q4: "..."   Q5: "..."   Q6: "..."   Q7: "..." (PM only)

Scorecard (1–5 or blank; each score must reference a quote above)
  Problem frequency: [ ]  Evidence ref: [ ]
  Problem severity: [ ]  Evidence ref: [ ]
  Current solution satisfaction: [ ]  Evidence ref: [ ]
  Willingness to change: [ ]  Evidence ref: [ ]
  Decision authority: [ ]  Evidence ref: [ ]
  Willingness to pilot: [ ]  Evidence ref: [ ]

Verbatim highlights (3–5 best quotes)

Gate-1 facts
  Sourcing = significant time drain: Y / N     Failed commitment / no-show last 6 months: Y / N
  PM pilot commitment: [state + scheduled date]   Provider expression of willingness: [conditions]

Follow-up actions (what, owner, due)            Opt-out honoured in tracker: Y/N/NA
```

---

*Question texts are copied verbatim from `docs/details/07-gtm-and-liquidity.md` Phase 1 — the source of truth; score this file's wording as authoritative for evidence capture only. Interview records stay outside the repo (see §2.3, §7).*

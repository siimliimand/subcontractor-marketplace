# 05 — Trust and Verification

Companion to [plan.md](../plan.md) §6.

In construction, trust matters more than price. Estonian public registers let us verify providers more cheaply than a generic marketplace could. Requirements and data access change, so **each item below must be checked before building**.

## Estonian data sources and trust elements

| Element | Purpose | Status |
|---|---|---|
| Business register (Äriregister) data, incl. activity codes | Verify the company exists; pre-seed provider profiles | Checked 2026-11-03 ([register-findings](../phase0/register-findings.md) §1): daily open data + free real-time API (contract to sign), CC BY 4.0 — use now for pre-seeding + existence badge |
| Tax debt information (Tax and Customs Board) | Large firms avoid subcontractors with arrears | Checked 2026-11-03 ([register-findings](../phase0/register-findings.md) §3): public inquiry for arrears >€100 — manual checks only at pilot scale; reuse terms to lawyer review |
| Economic activities register (MTR) | Many construction activities require registration | Checked 2026-11-03 ([register-findings](../phase0/register-findings.md) §2): mtr.ttja.ee public search + daily open-data XML, CC BY-SA 3.0 pending TTJA confirmation; import + verification code shipped, badge gated by `MTR_BADGES_ENABLED` |
| Smart-ID / Mobile-ID login | Strong identity for both sides; signals seriousness | Checked 2026-11-03 ([register-findings](../phase0/register-findings.md) §4): priced (from €60/mo), deferred, not blocking — provider auth = email tokens, staff auth = Cloudflare Access |
| Documents on profile | Insurance, certificates, safety training, references, with expiry reminders | Design needed |
| Reviews tied to completed bookings | Prevents fake or open reviews | Shipped 2026-11-03: booking reviews live (one review per completed booking, `src/worker/routes/reviews.ts`) |
| Reliability metrics | Response rate, acceptance rate, accepted-but-not-delivered | Collected from day one |

Do not assume every trade requires the same registrations, or that every register can be freely queried or republished.

## Staged verification

**Stage 1 — Basic identity**

- Confirm the company exists; record official business details and registration identifier.
- Identify the person authorised to manage the profile.
- Clearly indicate which details have been verified.

**Stage 2 — Trade and compliance**

- Identify relevant registration requirements per trade; check official registers where access and reuse are permitted.
- Collect insurance, qualifications, safety documentation and references.
- Track document validity dates.

**Stage 3 — Performance history**

- Record response behaviour, confirmed bookings, cancellations and completion confirmations.
- Allow reviews tied to genuine platform transactions.
- Show reliability information once sufficient data exists.

## Verification display

| Verification level | Badge | What it means |
|---|---|---|
| Business registered | ✓ Registered | Company exists in the Business Register |
| Contact verified | ✓ Contact | Email and phone confirmed |
| Trade registered | ✓ Licensed | Required trade registration confirmed (where applicable) |
| Insurance current | ✓ Insured | Liability insurance verified and current |
| Platform history | ✓ Established | Minimum 3 completed bookings with positive outcomes |

## Reliability scoring

Collected from day one; displayed only above minimum thresholds, so new providers are not disadvantaged for lacking history.

Inputs: response rate, time to first response, acceptance rate, cancellation rate, confirmed completion rate, customer feedback, availability accuracy.

| Metric | Minimum sample | Display format |
|---|---|---|
| Response rate | 5 requests | Percentage with confidence indicator |
| Completion rate | 3 bookings | Percentage with sample size noted |
| Average response time | 5 responses | Median hours |
| Review score | 3 reviews | Average with count |

Metrics must account for sample size, request relevance, customer-caused cancellations and legitimate schedule changes.

## Reviews

- Reviews are available only after a genuine booking or completed job.
- Both parties can dispute an inaccurate review through a defined process.
- Reviews are never presented as proof of technical competence or legal compliance unless the underlying information was actually verified.

## Languages and authentication

- **Estonian and English from day one.** Russian soon after — many tradespeople work in it.
- Smart-ID / Mobile-ID are evaluated on actual value, cost and user requirements. They are not prerequisites for proving the marketplace concept.

## Later integrations

E-invoicing and employee registration data — subject to legal feasibility and customer demand.

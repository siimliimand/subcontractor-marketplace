# 10 — Risks and Legal

Companion to [plan.md](../plan.md) §11.

## Risk register

| Risk | Why it matters | Likelihood | Mitigation |
|---|---|---|---|
| Cold start / insufficient liquidity | Requests fail to receive responses; no providers means no customers, and the reverse | High | One narrow segment; supply first; anchor customers import their own subcontractors; manual matching during pilot |
| Poor or stale availability data | PMs lose trust in search results | High | Label confidence clearly; freshness rules and reconfirmation; rank confirmed providers higher |
| Provider no-shows / cancellations | Projects delayed; customers lose confidence | High | Record commitments; track accepted-but-not-delivered; clear cancellation and dispute workflows |
| Low repeat usage | Platform becomes a one-off directory | High | Measure repeat sourcing; improve the full workflow; test paid operational features |
| Weak economics | High manual effort or low willingness to pay prevents scale | High | Track cost per successful booking; test pricing before expanding |
| Low-quality leads | Providers ignore notifications | Medium | Structured briefs; eligibility filters; small-batch outreach |
| Notification fatigue | Providers stop responding | Medium | Send to top matches first; expire requests; limit volume |
| Long enterprise sales cycles | Customer acquisition slow and expensive | Medium | Design partners test quickly while discovery continues with larger firms |
| Overbuilding | Development consumes time before demand is validated | Medium | Narrow MVP; gate feature requests on pilot evidence; defer advanced scheduling and AI |
| AI errors | Wrong briefs or matches damage trust | Medium | Human confirmation on everything; show reasoning; log corrections |
| Disintermediation | Revenue and usage leave the platform | Medium | Booking, capacity view, documents and audit trail as reasons to stay (see [09-monetization.md](09-monetization.md)) |
| Competitive response | Existing players or new entrants copy the model | Medium | Network effects, provider relationships, availability data quality and transaction history as moats |
| Regulatory or data issues | Fines, disputes, restricted data access | Medium | Legal review before processing sensitive data or integrating registers |
| Construction seasonality | Estonian construction slows in winter; availability and request volume shift with the season | Medium | Schedule pilot phases with the season in mind; interpret pilot metrics relative to season; revisit targets across seasons |
| Small market | Estonia has a limited number of relevant firms | Medium | Aim for high coverage of the pilot segment; keep the data model ready for Latvia, Lithuania, Finland |

## Legal review — before launch

Items to check with an Estonian lawyer:

- **GDPR:** lawful basis for processing personal data, including worker schedules and contact information. Worker names and availability are personal data — decide early what is shared; share the minimum with customers.
- **Data minimisation, access controls, retention and deletion.**
- **Terms of use** and the platform's contractual role: the platform connects parties and **is not a party to the contract** between customer and provider; liability for work quality, no-shows and cancellations sits with the parties, within the limits the terms define.
- **Subcontracting chains:** responsibilities in construction subcontracting arrangements.
- **Construction registrations:** which trades require registration and what we may verify or claim.
- **Public-register reuse:** access methods, permitted uses and republication rules for Äriregister, Tax and Customs Board data and MTR (see [05-trust-and-verification.md](05-trust-and-verification.md)).
- **Reviews and verification claims:** disputes, defamation risk, what badges may assert.
- **Liability and cancellations:** handling of failed commitments.

The platform should not assume that describing itself as an intermediary removes every legal responsibility.

## Long-term context

If the initial marketplace works, the platform can evolve from subcontractor discovery into a broader construction capacity and coordination system: multi-trade sourcing for complex projects, workforce capacity planning, supplier performance history, document and compliance management, procurement workflows, preferred-supplier management, integrations with construction PM and financial systems, and expansion to Latvia, Lithuania and Finland.

These remain strategic direction, not commitments for the first product. The long-term advantage comes from trusted relationships, accurate capacity information, a high-quality matching workflow and transaction history that improves operational decisions over time.

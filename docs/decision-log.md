# Decision Log — Phase 0

**Meeting:** partner session, 18 October 2026 (founder + AI chair)
**Attendees:** Siim Liimand (founder)
**Rule:** every decision has an owner and a deadline. Revisions only via the sanctioned checkpoints noted per decision.

| # | Decision | Choice | Owner | Deadline / checkpoint |
|---|---|---|---|---|
| 1 | Pilot segment | **Interior fit-out, Tallinn + Harju County, 6 trades** (electrical, plumbing, HVAC, drywall, flooring, painting). Liquidity-first: density over coverage. Expansion to other clusters/regions only in Phase 4 via the same playbook. | Founder | Locked; segment changes only via Gate 1 pivot criterion |
| 2 | Booking system | **Build fully ourselves** on D1 (capacity per skill per day, holds behind flag, first-confirmed-wins at DB level, email fallback). Generic calendar sync stays deferred to Phase 4. Cloudflare-only constraint intact. | Engineering (founder + AI) | Build in Phase 2 wks 7; calendar decision revisited Phase 4 |
| 3 | MVP scope | **Confirmed the §7 in/out table, with one change: multi-trade requests are IN.** Consequences: Request model needs a required-trades set (migration on cockpit schema), matching/outreach per trade, comparison view grouped by trade. P0 + AI brief builder + comparison view. One-trade-per-request limitation dropped. | Engineering | Scope frozen; changes only at phase gates |
| 4 | Team & budget | **Solo founder + AI-assisted build. Bootstrapped** (founder time + Cloudflare paid plan + register fees until Gate 2). Founder wears product, research, supply, ops, legal. Interviews and recruitment are the critical path, not code. Gate calendar stretches right; sequence and kill criteria unchanged. | Founder | Spend reviews at Phase 1 and Phase 3 checkpoints |
| 5 | Company & legal | **Pilot runs under the existing OÜ** (Rajahinta). Separate entity only if partners join / Gate 3 passes. **ToS + GDPR/privacy checklist drafted immediately** (AI, for founder review); **professional lawyer review before the first real provider data is collected.** Worker names/schedules are personal data. | Founder (drafts: AI) | Drafts within 1 week; lawyer review before pilot data collection |
| 6 | Success criteria | **Pilot targets + kill/pivot criteria confirmed as provisional** (plan.md §9, details/08). North star: % of eligible requests reaching a useful confirmed outcome within acceptable time. **Single sanctioned revision: day-30 synthesis.** Kill discipline pre-committed: G1 <4/10 + no provider interest → stop; G2 <50% qualified even manually → stop; G3 repeat <25% + effort not declining → stop/pivot. | Founder | Revision window: day-30 synthesis only |

## Why narrow segment (recorded rationale for Decision 1)

Marketplaces die from thinness, not missing coverage. Construction availability is local
(trades × radius), so breadth dilutes match rate per recruited provider. Early trust forms
on the first request; a zero-match request loses the PM permanently. Estonia is compact —
post-pilot expansion is incremental, and retrenchment from "failed everywhere" is impossible.

## Open items created by this meeting

- Multi-trade request model → engineering design before Phase 2 build (fits cockpit schema evolution)
- ToS + GDPR checklist + data-processing register → drafted task (0.2)
- Register research findings → gates badges + profile pre-seeding (0.3)
- Day-30 synthesis meeting → sole revision point for targets (Decision 6)

## CI gate decision — 3 November 2026 (SUBC-007)

**Decision: the "Full Suite" CI gate expectation is formally RETIRED for this repository.** The existing single-job CI workflow (`.github/workflows/ci.yml`, job `test`) **is** the full suite: it runs the complete 38-file vitest suite (`npx vitest run`, `@cloudflare/vitest-pool-workers` + miniflare D1) after build and typecheck on every push to `main` and every pull request. No sharded "Full Suite" workflow (smoke tier, Test shards 1/4–4/4, `test-timings-shard-1..4` artifacts) will be introduced. Owner: founder. Re-evaluation trigger: **full-suite wall time exceeding ~15 minutes on CI, or a demonstrated tiering need** (e.g. flaky-slow tests blocking iteration) — at that point, shard with timing data per the gate-template pattern.

Evidence (2026-11-03, SUBC-007):

| Factor | Measurement | Implication |
|---|---|---|
| Historical run durations (all 8 runs) | 22–40s each | Far below any sharding threshold |
| Fresh post-fix run #9 (id 41664619280, c149faa) | 48s wall, all steps green | Same conclusion after 6 landings of code+migration changes |
| Local full suite | 38.8s (`npx vitest run`) | Suite is inherently fast; parallel shards would add orchestration overhead for no wall-time gain |
| Suite scope in CI | Single `test` job = full 38-file suite | There is no smoke tier to separate — the whole suite already runs every push |
| Repo visibility | Public | Actions minutes free; no cost pressure to reduce run time |
| Maintenance model | Solo founder | Fewer workflows = less maintenance; one green check is simpler to reason about than five shard artifacts |

The Fusion post-merge gate template referencing "Full Suite" lives outside this repository (engine-side); the operator may update that template separately — for this repo, the template's expectation maps onto the single `test` job of `ci.yml` until/unless the template is changed.

## Auto-push mechanism decision — 3 November 2026 (SUBC-008)

**Decision: landings on `main` reach GitHub via a cron-driven push-when-ahead watchdog (`scripts/push-main-when-ahead.mjs`, pure logic in `scripts/ci-currency-lib.mjs`) chained with `scripts/verify-ci-currency.mjs`, plus a repo-level landing gate — "a landing is NOT complete until the watchdog exits 0" — as the always-active compensating trigger.** Rejected: (a) a post-merge push step inside the merger path — the merge flow is engine-side and cannot be edited from this repository; (b) a `post-merge` git hook — invisible, unverifiable host state, silently lost on any host rebuild; (c) gate-only documentation without a script — that is exactly the skippable manual procedure that produced the 2026-10-18 → 2026-11-03 silent rot. Owner: founder. Re-evaluation trigger: **if the Fusion engine later offers a native post-merge hook, migrate the push into the engine's merge flow and retire the cron line**; also re-evaluate if the 10-minute cadence proves too slow for landing-to-green latency expectations.

Evidence (2026-11-03, SUBC-008):

| Factor | Observation | Implication |
|---|---|---|
| Merger path location | Fusion engine log: "AI merge: merging fusion/subc-007 into main (clean room at 82aa7efa)" — no push step, no repo-side hook point | Post-merge push cannot be added from inside this repository |
| Landings that never reached GitHub | `274053d` (SUBC-007) and `3d117da` (SUBC-004) sat on local main while `git ls-remote origin refs/heads/main` stayed at `82aa7efa` (observed live at planning and re-confirmed at execution) | The manual procedure is not a mechanism — drift recurs silently without a trigger |
| Tooling present on host | `crontab` at `/usr/bin/crontab`, `gh` at `/usr/bin/gh`, crond active; node only at `/usr/local/bin/node` | A 10-minute cron tick is viable; the line must reference `/usr/local/bin/node` (cron PATH lacks it) |
| SUBC-007 Actions run durations | runs #1–#10: 22–48 s wall each | An 8-minute green-poll cap after push is a generous bound (poll every 15 s) |
| fusion worktree branches | `fusion/subc-004` … `fusion/subc-009` exist locally; none ever on origin | Watchdog must (and does) push exactly `refs/heads/main`, never `fusion/*` — guarded by `assertMainRef` + hardcoded refspec, unit-tested |
| Install reality at delivery | fusion crontab spool denies read/write to agent identities (`fopen`/`mkstemp` Permission denied, no sudo); systemd user bus and `at` unavailable | Cron line ships as a one-time operator install (documented in `agents.md` § "Auto-push on landing"); the landing gate is the active trigger from day one |
| Credential reality at delivery | gh OAuth token scopes `admin:public_key, gist, read:org, repo` — no `workflow`; GitHub remote-rejected the push of main containing SUBC-007's `ci.yml` edit | Ordinary landings push fine; workflow-file landings need the one-time `gh auth refresh -s workflow` (operator, browser step) — recorded in `agents.md` alongside the drift response |

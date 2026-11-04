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

## CI merge gate, lint baseline, and failure alerts — 2026-11-04 (SUBC-013, supersedes SUBC-007)

**Decision: this entry completes — and supersedes — SUBC-007's CI gate decision.** SUBC-007 cured the push transport and added the currency guard (`verify-ci-currency.mjs`), `workflow_dispatch` backfill, and the "single `test` job IS the full suite" decision; its landing reached GitHub only later (workflow-scope rejection, resolved by the founder's one-time `gh auth refresh -s workflow`). SUBC-013 now completes the pilot-period CI contract SUBC-007 could not: **(1)** `ci.yml` fires on **every push (any branch)** plus every pull request and `workflow_dispatch`; **(2)** a lint gate (`npm run lint`, ESLint 9 flat config) runs before build/typecheck/test in the unchanged-id `test` job; **(3)** every failing run (any event, any branch — but never a cancelled run) triggers a `notify` job that opens or comments on a `ci-failure` issue; **(4)** a `ci-merge-gate-pilot` ruleset requires the `test` check for PR merges into `main` while leaving direct pushes legal. Owner: founder. Re-evaluation trigger: **pilot end (Gate 3 / day-90 go/no-go)** — re-evaluate the ruleset (keep, tighten to strict, or retire), the react-hooks rule set, and whether `no-explicit-any` should be enabled.

**Lint baseline (recorded):** `@eslint/js` recommended + `typescript-eslint` recommended (non-type-checked) + the classic react-hooks pair + `globals` (node for `scripts/*.mjs` and the config file, browser+worker for `src/**`), covering `src/**/*.{ts,tsx}`, `test/**/*.ts`, and the root config files; ignores dist/, node_modules/, .wrangler/, .fusion/, docs/, migrations/ and generated declaration sidecars. Execution sweep: **48 errors → 0** (44 `no-unused-vars`, 3 `prefer-const` auto-fixed, 1 base `no-unused-vars`; fixed by deleting/underscore-prefixing bindings — zero behavioral changes, no test or assertion touched), 4 `react-hooks/exhaustive-deps` warnings remain. **`no-explicit-any` stays off** (recorded deferral: `any` appears in Cloudflare bindings plumbing; tightening is a follow-up, not a pilot gate). **`exhaustive-deps` starts at "warn"** (warnings never fail the script). **eslint-plugin-react-hooks is limited to the classic pair** (`rules-of-hooks` error, `exhaustive-deps` warn): v7's bundled `recommended` preset additionally enables the React Compiler rule suite (purity, immutability, set-state-in-render, …), which would demand behavioral rewrites across the UI — out of scope for a non-behavioral baseline. Per-file `eslint-disable` comments are forbidden; rules may only be relaxed in `eslint.config.mjs` with a justification comment and a decision-log record (this paragraph is that record).

**Merge-gate ruleset (recorded):** ruleset **26516182** `ci-merge-gate-pilot` (host-level, unversioned by design — same precedent as SUBC-007's HTTPS remote switch), target branch `refs/heads/main`, enforcement active, rules `required_status_checks` (context **`test`**, integration 15368, strict policy **false**) + `non_fast_forward` + `deletion`. **No `pull_request` rule and no admin bypass** — the direct-push landing flow (engine merge + `push-main-when-ahead.mjs`) must keep working; required checks with strict=false gate PR merges only. Verified live: probe PR #1 reported `mergeStateStatus: BLOCKED` with the required check failing, and a real merge attempt was refused ("base branch policy prohibits the merge"). Branch protection API remains unused (deprecated).

**Failure notification (recorded):** two layers. (a) Issue layer — the `notify` job (`needs: test`, `if: failure()`, `permissions: issues: write`) uses the runner's preinstalled `gh` with `GITHUB_TOKEN` (no secrets) to idempotently ensure the `ci-failure` label and then create-or-comment: a second failure comments on the open issue instead of creating a new one (dedupe proven live: runs #16/#17). Cancelled runs never notify (deliberate — concurrency-cancelled runs are not failures). A job with no checkout must pass `-R "$GITHUB_REPOSITORY"` to every gh call (found live: gh cannot infer the repo without a working tree). (b) Email layer — GitHub's default failure email to the push-triggering actor (siimliimand's token drives every push) needs no setup, and the founder's repo watch subscription is **confirmed active** (PUT `/subscription` succeeded 2026-11-04; the planning-time 404 premise was stale after the token refresh). Close `ci-failure` issues with a comment when triaged — never delete them; they are the alert history.

**Sharding stays retired.** SUBC-007's "single `test` job IS the full suite" decision is reaffirmed unchanged: the pilot CI adds lint (seconds) before the existing build/typecheck/test pipeline; no shards, no smoke tier. The `workflow_dispatch` backfill trigger is preserved unchanged.

Evidence (2026-11-04, SUBC-013):

| Factor | Observation | Implication |
|---|---|---|
| Every-push trigger | Run #13 (id 41795985187): push event on non-main branch `ci-gate-probe/20261104`, success, step `Run npm run lint` = success | The unfiltered `push:` trigger fires for every branch; the lint gate runs green in CI |
| PR trigger + merge block | Run #17 (pull_request) failed by design; PR #1 `mergeStateStatus: BLOCKED`; `gh pr merge` refused: "base branch policy prohibits the merge" | The ruleset gates PR merges on the `test` check exactly as intended |
| Failure alerting + dedupe | Run #16 (push) → notify created ci-failure issue #2; run #17 (pull_request) → notify commented on issue #2 (no second issue) | The founder gets a visible, single-threaded alert per failure episode; both email + issue layers live |
| Cancelled-run semantics | Run #15 cancelled mid-flight by run #17 (per-ref concurrency, cancel-in-progress); notify did not fire | Superseded runs cannot spam the founder — matches the design note |
| Direct-push preservation | Ruleset has no `pull_request` rule/strict policy; the repo's landing flow (engine merge + watchdog push) is unaffected | PR gating without breaking the direct-push landing model |
| Lint sweep cost | 48 errors → 0 with zero behavioral changes; full vitest suite green before and after | The baseline is safe to enforce on every landing for the pilot |
| Credential state | `workflow` scope present on the gh token (founder refresh); probe pushes touching `ci.yml` accepted | The one-time operator action recorded at SUBC-008 was completed; no outstanding credential blocker |

**Addendum (2026-11-04, operator):** the "Direct-push preservation" expectation above was
disproven live: with the ruleset `active`, a direct landing push to `main` was rejected
(`push declined due to repository rule violations`) — required-status-check rulesets on a target
branch apply to direct pushes as well, independent of `strict=false`. Enforcement was flipped to
`disabled` (ruleset kept, not deleted) the same day to restore the direct-push landing model; the
`evaluate` dry-run tier is unavailable on this plan. Re-activation is conditional on Fusion
supporting PR-based landing (fix plan FIX-6). Probe artifacts (`ci-gate-probe/20261104`, PR #1)
remain as pilot evidence.

**Addendum (2026-11-04, SUBC-018): the failure alert now names the branch the failure lives
on.** Pre-fix, a `pull_request` run's alert cited the merge ref — the live ci-failure issue #2
comment from run 41796944020 read `CI failed on 1/merge (event: pull_request)` because
`github.ref_name` on a PR run is the checkout's merge ref (`refs/pull/N/merge`). The `notify`
job's `REF` env now maps `${{ github.event.pull_request.head.ref || github.ref_name }}`: the
PR head branch for pull_request runs, `ref_name` unchanged for push/workflow_dispatch (issue
title and body both consume the same `REF` env var). The expression stays in the env mapping
only — fork head refs are attacker-influenced input, and direct `${{ }}` interpolation into the
`run:` script is the documented injection vector this workflow avoids; the mapping's semantics
are mirrored 1:1 by the pure helper `scripts/ci-alert-branch.mjs` (unit matrix + `?raw` wiring
assertions in `test/ci-alert-branch.test.ts`, including a single-occurrence guard on the
expression). Live probe evidence (2026-11-04): on probe branch `ci-gate-probe/20261104-headref`,
the failing push run 41846494302 created ci-failure issue #4 with body `CI failed on
ci-gate-probe/20261104-headref (event: push)` (push behavior byte-for-byte unchanged), and
draft PR #5's failing pull_request run 41846832872 commented on the same issue: `CI failed on
ci-gate-probe/20261104-headref (event: pull_request)` — the head branch, no `/merge`. The
comment's Commit sha (`b0c3413`) is the merge-ref test commit, proving the run executed on the
merge ref while the alert named the head branch. Probe artifacts cleaned up per procedure (PR
#5 closed unmerged, probe branch deleted, issue #4 closed with an explanatory comment and kept
as alert history).

## Merge-gate re-enable evaluation — 2026-11-04 (SUBC-014)

**Decision: NO-GO — ruleset 26516182 stays enforcement `disabled` (parked); re-activation
remains conditional on FIX-6, exactly as the SUBC-013 addendum above records.** This entry
evaluates that re-activation condition from live evidence and corrects the stale SUBC-013
wording in `agents.md` that described the disabled ruleset as if it were active.

Evaluation evidence (2026-11-04, live):

- Ruleset GET, twice (Step 0 snapshot and the Step 1 verified hold):
  `enforcement: "disabled"`, name `ci-merge-gate-pilot`, target `branch`, conditions
  `refs/heads/main` only, rules `required_status_checks` (context `test`, integration 15368,
  strict policy false) + `non_fast_forward` + `deletion`, no bypass actors — byte-identical
  between both GETs. No mutation was made at any point in SUBC-014 (verified hold, not a flip).
- Landing mode: the two most recent landings — `b874fd0` (SUBC-010, 2026-11-04T08:59:16Z) and
  `5637fba` (SUBC-013, 2026-11-04T09:20:58Z) — arrived as DIRECT pushes after the disable
  flip; `git log --merges` on `origin/main` is empty.
- The only PR-merged landing, PR #3 (SUBC-011, squash-merged 2026-11-04T08:09:56Z → `0645df5`),
  was authored AND merged manually by siimliimand from `fusion/subc-011` (branch still on
  origin as the rescue leftover), body: "Created via the ci-merge-gate-pilot ruleset path
  because direct main pushes now require the test check." That is a manual rescue of a
  declined engine direct-push — not engine-side PR-based landing. FIX-6 is therefore NOT
  live: landings still depend on direct pushes, and activating the ruleset now would
  re-decline SUBC-014's own landing (the exact 2026-11-04 failure mode).
- Probe re-verification (GO-path only) skipped with this rationale; no probe branch/PR/issue
  was created; legacy pilot artifacts (`ci-gate-probe/20261104`, PR #1) untouched.

Docs corrections (the reported defect, fixed under NO-GO): `agents.md` § "CI merge gate and
failure alerts" gate bullet now leads with the disabled/parked state (nothing is gated while
disabled), labels PR gating as intended design, records the direct-push finding, and carries
the FIX-6 re-activation procedure (snapshot-preserved PUT changing only `enforcement`, probe
re-run plus green-merge control, auto-revert on breakage); the SUBC-008 interplay bullet now
qualifies "pushes are direct, hence unaffected by the ruleset" as true only while enforcement
is disabled. `README.md` § CI verified unchanged — it already carried "currently **disabled**
— parked pending PR-based landing support in Fusion".

Watchdog disposition (NO-GO): unchanged — the 10-min cron's direct-push path stays safe
precisely because enforcement stays disabled; no cron-line change is needed. Currency at
evaluation: `verify-ci-currency` exit 0 (local main == origin/main `5637fba` == green run
#20, id 41806748303).

## MTR import format-drift hazard and fix — 2026-11-04 (SUBC-015)

**Decision: the MTR/Tarvik import now understands both export layouts (legacy
`teatised/teatis` and current `load/luba`), and a zero-upsert guard makes it
structurally impossible for a format-drifted export to issue the expire-all
UPDATE — already-imported rows stay untouched until a verified re-import is
deliberately executed after SUBC-012's TTJA confirmation.** Owner: founder
(re-import execution); engineering: extraction + guard shipped here.

**The hazard (why re-import was blocked):** running the pre-fix
`scripts/import-mtr.mjs` against the current (2026-11-04) daily export parsed
all 56,666 undertakers but extracted **zero** trade-notification upserts —
`noticesOf` only recognised `teatis*` keys, and the export had moved to
`ettevotja > load > luba` — yet the script still emitted its unconditional
expire-all `UPDATE company_verifications SET status = 'invalid' …`. One
applied pass would have flipped **every existing `mtr:%` trade_notification
row to `invalid`**, wiping badge validity across staging and production until
a fixed re-import restored it.

**The fix (all in `scripts/import-mtr-lib.mjs` + thin CLI
`scripts/import-mtr.mjs`, no `src/` or runtime changes):**

- Notice extraction handles both layouts — legacy `/teatis/i` keys unchanged
  (regression fixture byte-identical) and current `/load|luba/i` keys with
  array/single/wrapper shapes normalised in code, not by parser config.
- Per-licence EMTAK codes collected from `emtak` AND `emtak2025` (repeated
  `<kood>` children); digit-prefix trade mapping unchanged
  (4321→electrical; 4322→plumbing+hvac; 4331/4332→drywall; 4333→flooring;
  4334→painting); `registrikood` matching stays exact (foreign `(SIRET)`/
  `0146519-2`/10-digit codes are harmless no-op upserts).
- Validity: when `staatus` is present only `kehtiv` counts as valid
  (`esitatud`/`peatatud` → invalid); `kehtiv_kuni` `xsi:nil`/absent is
  open-ended; `end >= today`; legacy notices keep the end-date-only rule;
  per-(company, trade) anyValid preserved.
- **Zero-upsert guard:** zero upserts ⇒ no expire UPDATE, distinct warnings
  for extraction drift vs EMTAK mapping drift, CLI exit code 1 with
  comments-only SQL; `--force-expire` emits the UPDATE anyway (exit 0,
  WARNING comment + stderr). Exit codes: 0 healthy/forced, 1 guard/parse
  failure.

**Re-evaluation trigger:** any future MTR/Tarvik export schema change
(re-check the header line's "with relevant notices" count before applying
any import; ~5,097 is the current healthy figure), or SUBC-012's TTJA
licence confirmation landing, which unblocks the deliberate founder-run
re-import.

**Known limitations (recorded honestly, not fixed here):**

- The expire UPDATE's semantics are **unchanged** by design: it still expires
  ALL trades of companies absent from the import; a company present in the
  import that dropped one trade keeps its stale valid row for that trade
  (pre-existing behaviour; follow-up candidate, deliberately out of scope).
- `tyyp` is not filtered — the ≈5,097 spot-check figure was derived without
  it, so filtering now would change the validated counts.
- A future re-import re-stamps the "display pending TTJA licence
  confirmation" licence string until the founder updates it post-confirmation.

Evidence (2026-11-04, real export — dry-run only, applied nowhere; full
record in task SUBC-015 document `dry-run-evidence`):

| Check | Observation |
|---|---|
| Undertakers read | 56,666 (matches recorded file facts exactly) |
| Matched undertakers | **5,097** (exact match to the recorded fact; 5,000–5,200 accepted) |
| Upsert rows | 8,095 ≥ 5,097 (4322 maps to plumbing+hvac): electrical 3,740, plumbing 910, hvac 910, drywall 845, flooring 845, painting 845 — all six trades present |
| Independent cross-check | From-scratch parser (no shared code) reproduced every count exactly |
| Guard against real file | Exit 0, expire UPDATE present — no over-trigger on the understood format |
| Guard against drifted file | `test/import-mtr.test.ts` (21 cases): drifted plan emits no INSERT/UPDATE; executed against miniflare D1 it leaves a pre-existing valid row valid; D1-level idempotency + expire path + faithful per-trade expiry pinned |
| Regression anchors | `scripts/fixtures/mtr-sample.xml` unmodified; `test/verification.test.ts` and `src/worker/verification.ts` untouched and green |
## `no-explicit-any` enabled — 2026-11-04 (SUBC-017)

**Decision: `@typescript-eslint/no-explicit-any` is now `'error'` in `eslint.config.mjs`.**
This completes — ahead of the pilot-end re-evaluation trigger — the recorded deferral in the
SUBC-013 lint-baseline paragraph above ("`no-explicit-any` stays off … tightening is a follow-up,
not a pilot gate"; that paragraph stays untouched as history). The `any` usages that justified
the deferral were the Cloudflare bindings plumbing; all of them are now typed, so the CI lint
gate refuses new untyped placeholders from this landing forward.

**Fixed inventory (grep-verified 42 sites, zero runtime behavior change):**

- **4 src helper parameters** typed with real Hono context generics —
  `getRequestOr404` and `getProposalContext` (`src/worker/routes/bookingRequests.ts`) and
  `getReviewContext` (`src/worker/routes/reviews.ts`) now take `Context<AppEnv>`;
  `requireProviderUser` (`src/worker/providerPortal.ts`) takes
  `Context<{ Bindings: PortalEnv }>`. `Bindings`/`AppEnv` in `src/worker/app.ts` were referenced
  read-only, never redefined.
- **37 test sites** converted from `(globalThis as any).__testAccessKey` to a declared, typed
  `globalThis.__testAccessKey` global (`declare global` in `test/env.d.ts`, typed as
  `Awaited<ReturnType<typeof makeAccessKey>>`): the writer `test/apply-migrations.ts` (vitest
  `setupFiles`) plus 36 reader files that destructure `privateKey` to mint Cf-Access JWTs.
- **1 typed module introspection** in `test/effort.test.ts` (`as any` import of
  `../src/worker/app` replaced by a `Record<string, unknown>` property access with a
  `typeof === "function"` guard) — semantics-preserving: `app.ts` exports no `appPaths`, so the
  route list stays `[]` exactly as before and every assertion is byte-identical. That introspection
  is vacuous today (known, accepted); replacing or deleting it is deliberately left as follow-up
  work, not this task.

**Standing rules unchanged:** per-file `eslint-disable` comments remain forbidden; rule changes
happen only in `eslint.config.mjs` with a justification comment and a decision-log record (the
config comment was rewritten to record this completion). The react-hooks rule settings and the
ignores list are untouched (SUBC-016 owns those).

Evidence (2026-11-04, SUBC-017, worktree `subc-017`):

| Factor | Observation | Implication |
|---|---|---|
| Rule enforcement | `npm run lint` with `'@typescript-eslint/no-explicit-any': 'error'` = 0 errors, 4 warnings | The four remaining warnings are the pre-existing `react-hooks/exhaustive-deps` set recorded at SUBC-013 — no growth, warnings never fail the script |
| Full regression net | `npm run build && npm run lint && npm run typecheck && npm test` exit 0 | Typing-only claim holds: 40 files / 299 tests before and after (identical counts to the pre-change baseline) |
| Acceptance greps | `grep -rn "as any" src test` → empty; `grep -rn "as any" test` → empty; word-level `any` in src confined to comments and UI copy strings | No `any` cast remains anywhere in lint scope; future violations surface as CI lint errors |
| Scope discipline | No runtime logic, workflow files, or generated files touched; `src/worker/app.ts` unchanged | The structural bindings types stay deliberate; the change is trivially revertible |

## Landing-push stall diagnosed and flushed — 2026-11-04 (SUBC-020)

**Decision: the 2026-11-04 landing-push stall was a dead watchdog cron (the */10 spool entry missing or not firing) plus a skipped agent-side landing gate — NOT a credential problem; the three stalled landings were flushed through the documented gate (`push-main-when-ahead` exit 0, green run #21 on `f07eb93`, chained `verify-ci-currency` exit 0), the crontab repair is handed to the operator as the action card below, and `agents.md`'s stale "no `workflow` scope" caveat is corrected to the live verified state in this same landing.**

Incident narrative (2026-11-04, live-verified in the SUBC-020 worktree):

- **Stall window:** origin/main froze at `5637fba` after 09:21:02Z (run #20, id 41806748303) while local main accumulated three landed commits GitHub never saw — `1fb4051` (SUBC-014, 10:05:34Z), `dec83346` (SUBC-017, 10:38:18Z), and `f07eb93` (SUBC-015, 11:09:43Z, landed after the report — same root cause). CI fires on every push with no path filters, so the absence of runs proves the pushes never happened. `verify-ci-currency` failed → per the agents.md drift response, NO further work could merge onto `main`.
- **Watchdog diagnosis (cron trigger dead):** `~/.local/state/ci-currency/cron.log` is ABSENT — the crontab line's `>> cron.log 2>&1` redirect creates that file on any firing, so the */10 entry never fired since install (missing or not firing from the spool); `auto-push.log`'s last pre-incident entry is the 09:56:19.926Z noop, with ~12 missed */10 slots by flush time; `systemctl is-active cron` → `active`; `crontab -l` → `crontabs/fusion/: fopen: Permission denied` (spool operator-only by design). The lone 09:56:19Z full-run entry predates all three landings and is a one-off manual/gate run, not a live */10 schedule.
- **Landing-gate process gap (second trigger dead):** no `push-main-when-ahead` run was logged after any of the three landings — the agents.md landing gate ("a landing is NOT complete until the gate exits 0") was skipped each time. The merge flow is engine-side (per the SUBC-008 decision entry), so the root cause lives outside this repo; operator action item 4 below owns the follow-up.
- **Credential state (live, verified read-only):** `gh auth status` shows siimliimand active with scopes `admin:public_key, gist, read:org, repo, workflow` — the `workflow` scope granted 2026-11-04 is live; a `git push --dry-run` was accepted (`5637fba..f07eb93`) before the real push. The `agents.md` "Credential scope caveat (live 2026-11-03)" bullet claiming NO workflow scope was therefore stale and is replaced by the live facts, cross-referencing the SUBC-013 "Workflow-scope push constraint" note (which already recorded the grant). The SUBC-008 evidence row describing the pre-grant state stays untouched as dated history — it is superseded by the SUBC-013 row recording the grant, and this log is append-only.
- **Flush:** `node scripts/push-main-when-ahead.mjs` ran once from the linked SUBC-020 worktree (documented equivalent of the primary checkout — git refs are shared across worktrees) and exited 0: single hardcoded refspec push of `f07eb93` (never `--force`), Actions run #21 (id 41825457594) COMPLETED success on the tip, chained `verify-ci-currency` OK. One green run on `f07eb93` is the post-merge verification evidence for SUBC-014, SUBC-017, and SUBC-015 together (the tip contains all three).
- **Accepted transient (documented, not a failure):** this entry's own documentation commits land via the engine AFTER execution, advancing local main one commit past origin until the repaired watchdog or the next gate run flushes it. Per agents.md a landing is not complete until the gate exits 0 — the operator card below covers that flush. Acceptance is anchored to the execution end-state.

Evidence (2026-11-04, SUBC-020, worktree `subc-020`):

| Factor | Observation | Implication |
|---|---|---|
| Stall state at task start | `git rev-parse refs/heads/main` → `f07eb9304d21…`; `git ls-remote origin refs/heads/main` → `5637fba0e326…`; `rev-list --left-right --count` → `3 0`; probe `--check` → ahead=3 behind=0 → push (exit 1, expected pre-fix) | Ahead-only stall confirmed; all three commits verified ancestors of the tip before pushing |
| Watchdog evidence | `~/.local/state/ci-currency/` holds ONLY `auto-push.log` (cron.log and alert absent); last tick 09:56:19.926Z; ~12 missed */10 slots; crond `active`; `crontab -l` → Permission denied | The */10 spool entry never fired — missing or not installed; repair is operator-only (action card below) |
| Credential verification | `gh auth status`: siimliimand, scopes `admin:public_key, gist, read:org, repo, workflow`; URL-scoped `credential.https://github.com.helper = !/usr/bin/gh auth git-credential`; `gh api repos/…` → own repo; dry-run push accepted `5637fba..f07eb93` | Transport healthy; the stale no-workflow-scope caveat is corrected in `agents.md` by this landing |
| Gate flush | `node scripts/push-main-when-ahead.mjs` → exit 0: pushed `f07eb9304d21b05be5d6a11dcdaccfca5c574612`, run #21 id 41825457594 (event push, branch main, head_sha == tip, conclusion success, 1m1s), chained verify OK | The three stalled landings are on origin with one green run covering all; no fallback or workaround path was needed |
| Currency acceptance | `node scripts/verify-ci-currency.mjs` → exit 0: local main == origin/main (`f07eb9304d21`) == newest completed run #21 success; repo-wide run list confirms #21 is newest (nothing shadows); guard suite `test/ci-currency-guard.test.ts` 32/32, `npm run lint` 0 errors, `npx tsc --noEmit` green | The "merge NO further work onto main" freeze lifts; the unit suite behind the gate logic exercised by this flush passes |

**OPERATOR ACTION ITEMS (recorded for the operator; agents must not execute these):**

1. Re-apply the crontab line exactly as documented in `agents.md` § "Auto-push on landing (SUBC-008)" — the four-command install block: `gh auth setup-git`; `git remote set-url origin https://github.com/siimliimand/subcontractor-marketplace.git`; `mkdir -p ~/.local/state/ci-currency`; then the */10 line running `/usr/local/bin/node scripts/push-main-when-ahead.mjs` with `>> /home/fusion/.local/state/ci-currency/cron.log 2>&1`. The absolute node path is mandatory: cron's PATH lacks `/usr/local/bin` and `/usr/bin/node` does not exist on this host.
2. Within ~10 minutes of install, confirm `~/.local/state/ci-currency/cron.log` appears (the redirect creates it on first fire) and a noop line lands in `auto-push.log`.
3. Until the cron is repaired, flush after any landing by running `node scripts/push-main-when-ahead.mjs` — per `agents.md`, a landing is not complete until it exits 0. (This entry's own doc commits will be one such flush.)
4. Optional root-cause follow-up: determine why the agent-side landing gate was not run after the 2026-11-04 landings (`1fb4051`, `dec83346`, `f07eb93`) — the engine merge flow lives outside this repo per the SUBC-008 decision entry, so the gap is engine-side.


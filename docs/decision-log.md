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

## Origin branch cleanup — 2026-11-04 (SUBC-019)

**Decision: the leftover origin branch `fusion/subc-011` (`d6f932f`) is deleted; origin now
hosts exactly one branch, `main`, restoring the agents.md convention (SUBC-007/SUBC-008 notes)
that `fusion/*` task branches never live on origin.** Owner: founder. Reversibility: the
original commit stays pinned locally by the tag `rescue/fusion-subc-011` (never pushed); if
the branch is ever needed again, recreate it with `git push origin
rescue/fusion-subc-011:refs/heads/fusion/subc-011`.

Provenance: `fusion/subc-011` was the only `fusion/*` ref ever pushed to origin, pushed as
part of the 2026-11-04 PR #3 manual rescue — the then-active `ci-merge-gate-pilot` ruleset
declined the engine's direct push of SUBC-011 to `main`, so siimliimand manually opened PR #3
and squash-merged it (`0645df5`, merged 2026-11-04T08:09:56Z), and the branch push was part
of that rescue. The branch lingered afterwards as rescue evidence; the SUBC-014 evidence pack
surfaced it (cf. the SUBC-014 entry above: "PR #3 (SUBC-011, squash-merged 2026-11-04T08:09:56Z
→ `0645df5`) … (branch still on origin as the rescue leftover)"). This entry records that it
is now deleted, per the repo rule that internal work branches never live on the remote.

Safety evidence (2026-11-04, SUBC-019, worktree `subc-019` — deletion ran only after every
gate passed live; PR #3 and all legacy probe artifacts untouched):

| Factor | Observation | Implication |
|---|---|---|
| Gate A — merge landed | `git merge-base --is-ancestor 0645df52a941e1baa61922d8b784a705acd39bef origin/main` → exit 0 | The rescue content is permanently in origin/main history; the branch carried no unmerged work |
| Gate B — zero content loss | `git diff --shortstat d6f932f929a7707a87f39b0a1ab823e17251c291 0645df52a941e1baa61922d8b784a705acd39bef` → empty output | The branch tip tree is byte-identical to the squash commit; deleting the ref loses zero content |
| Gate C — PR closed out (soft) | `gh pr view 3 --repo siimliimand/subcontractor-marketplace --json state,mergedAt,mergeCommit` → `MERGED`, mergeCommit oid `0645df52…`, `mergedAt 2026-11-04T08:09:56Z` | PR #3 is closed out; its record (and `refs/pull/3/head`) remains readable on GitHub after head deletion |
| Pre-delete heads | `git ls-remote --heads origin` → exactly two: `refs/heads/fusion/subc-011` `d6f932f929a7707a87f39b0a1ab823e17251c291` (exact expected SHA; the ONLY `fusion/*` head repo-wide) + `refs/heads/main` `61f81e8b…` | Expected state per the state matrix; no other `fusion/*` head existed to expand scope |
| Deletion | `git push origin --delete fusion/subc-011` → `- [deleted] fusion/subc-011` | The single sanctioned remote mutation; no force, no other refspec |
| Post-delete heads | `git ls-remote --heads origin` → exactly one head: `refs/heads/main` `61f81e8b227e77a820bd0dc153a9b08b5363167e` | Origin matches the one-branch convention again; nothing can build, deploy, or PR from a stale leftover |
| Full-ref snapshot diff | `git ls-remote origin` after minus before = exactly the removed `refs/heads/fusion/subc-011` line (`HEAD`, `refs/heads/main`, `refs/pull/1/3/5/head` byte-identical) | No tag, PR ref, or other namespace was touched by the deletion |
| Local pin tag | `git tag rescue/fusion-subc-011 d6f932f…` — local only, never pushed; `git rev-parse rescue/fusion-subc-011` → `d6f932f929a7707a87f39b0a1ab823e17251c291` | The commit is gc-safe and the deletion is fully reversible via the recreate command above |
| PR #3 post-delete | `gh pr view 3 --json state` → still `MERGED`; no comment, edit, or close was made | The rescue evidence itself is preserved verbatim |

## Non-watchdog push of 61f81e8 attributed — 2026-11-04 (SUBC-025)

**Decision: the 2026-11-04T14:27:34Z push that advanced origin/main from `e53c3d9` to
`61f81e8` was performed by the SUBC-018 executor agent itself, executing the direct
tip-chain landing instruction written into its own task spec's Step 4 — NOT by the
founder (no manual push; probe PR #5 was closed unmerged at 14:24:29Z, three minutes
before the push) and NOT by the watchdog/gate (its log is silent across the window and
local main did not contain `61f81e8` until 15:10:35Z). The push violated the SUBC-008
single-writer mechanism contract — a contract no agents.md sentence then made explicit
against spec-authored direct tip pushes; that contract is now explicit in agents.md §
"Auto-push on landing" via this same landing (single-writer rule, direct-tip-push
prohibition, pending-landing semantics, probe-shadow caveat), so no future task spec
can sanction the maneuver again.** Starting evidence: task document key=evidence on
SUBC-025 (every row independently re-verified 2026-11-05 from primary surfaces), quoted
per the operator's instruction.

Provenance (timeline UTC; agent-log quotes marked ⚑ are recorded prior evidence — the
planner's 2026-11-05 verbatim capture from the SUBC-018 agent log; the SUBC-025
executor could not replay that log directly because `fn_task_logs_read` is
current-task-scoped, and instead re-verified the same events through the persisted
SUBC-018 step reports, the commit metadata, the reflogs, the gate log, and GitHub's
API — all first-hand):

- **14:27:04 ⚑** — SUBC-018 executor commits `61f81e8` in the subc-018 worktree
  (agent-log bash `git add`/`git commit` entry). First-hand: the commit's
  AuthorDate/CommitDate are `Wed Nov 4 15:27:04 2026 +0100` (= 14:27:04Z), author
  `Fusion Factory <fusion@factory.webuilder.dev>`, message `feat(SUBC-018): complete
  Step 4 — document PR head-branch alert naming`, trailer `Fusion-Task-Id: SUBC-018`.
- **14:27:32 ⚑** — the executor runs `git push origin HEAD:refs/heads/main &&
  git ls-remote origin refs/heads/main` from the task worktree (agent-log tool entry,
  verbatim command). First-hand corroboration: the executor's persisted Step 4 step
  report (recordedAt 2026-11-04T14:31:02.128Z) admits it in the first person —
  "Committed as 61f81e8, then landed the reviewed tip to origin main
  (e53c3d9..61f81e8) — landing run #26 green, probe shadowing healed, currency legs
  (b)+(c) verified live. Leg (a) pends the engine's standard fast-forward of local
  main at task completion (guard exit 1 recorded with the exact heal path)."
- **14:30:12 ⚑** — the executor self-reports the landing in the task log: "SUBC-018
  final landing: pushed reviewed tip 61f81e8 to origin main (git push origin
  HEAD:refs/heads/main; e53c3d9..61f81e8 …). Landing run #26 (id 41847758728 …)
  concluded success in 55s".
- **The causative instruction** — SUBC-018's PROMPT.md Step 4, verbatim: "Land the
  task branch on origin main per the documented landing flow: push the reviewed tip
  (`git push origin HEAD:refs/heads/main` — this is the probe-shadowing-restore
  landing; the engine's watchdog treats an already-current main as a no-op)." The
  parenthetical was wrong in the direction that mattered: the engine's independent
  squash-landing created the divergence, not a no-op. The same file's Do-NOT section
  had restricted the main push to "the final Step 4 landing" — which the instruction
  itself was, so no internal contradiction fired.
- **14:27:34** — origin/main reflog: `61f81e8 refs/remotes/origin/main@{2026-11-04
  15:27:34 +0100}: update by push`; a clean fast-forward (the three-commit series
  `b23ddf4`→`969e92d`→`61f81e8` sits on base `e53c3d9`).
- **14:27:36** — Actions run #26 (id 41847758728) created: event `push`, head_branch
  `main`, head_sha `61f81e8b227e77a820bd0dc153a9b08b5363167e`, conclusion `success`.
  Attribution limit stated explicitly: every push from this host rides the shared
  siimliimand gh OAuth token, so GitHub's actor/triggering_actor fields (both
  `siimliimand`) are token-level only and cannot separate agent from founder — the
  attribution rests on the host-side evidence above.
- **PR #5 disproof** — `gh pr view 5 --json state,mergedAt`: `CLOSED`, `mergedAt`
  null, closed 14:24:29Z, head `ci-gate-probe/20261104-headref`; never merged, so it
  cannot have advanced main. The founder-manual/PR-#5 attribution previously recorded
  in project memory is wrong and is superseded by this entry.

Consequence chain (cross-referenced, not re-litigated): the engine merger — consulting
only local main, still at `e53c3d9` — judged SUBC-018 unmerged at landing time and
fast-forwarded its own squash `7bfab34` (identical tree `4a55ec8…`, different SHA)
onto local main at 14:54:36Z, producing the Regime B divergence (ahead 1 / behind 3)
the gate refused at 15:08:31Z; SUBC-022/SUBC-023 hand-repaired the wedge (external
CAS repair onto `61f81e8` at 15:10:35Z — the empty-message main reflog entry — then
gate flushes), and SUBC-024 root-caused the engine-side race (already-merged detection
never consults origin), which is maintainer-routed via that task's decision-log draft.
The */10 watchdog cron repair remains operator-owned per the SUBC-020 action items —
the gate-log gap below (12:54:29Z→15:08:31Z) also corroborates that the cron was not
firing.

Evidence (re-verified 2026-11-05, SUBC-025, worktree `subc-025`; full verbatim replay
outputs in task document key=evidence on SUBC-025):

| # | Time (UTC) | Event | Evidence surface |
|---|---|---|---|
| 1 | 2026-11-04 12:53:07Z (reflog 13:53:08 +0100) | Last sanctioned publish: gate pushes `e53c3d9` to origin/main | `~/.local/state/ci-currency/auto-push.log` lines "12:53:07.150Z … → push", "12:53:07.159Z pushing main (e53c3d9…) to origin/main (single hardcoded refspec, no --force)", "12:54:29.498Z OK main pushed and green (run #22)"; origin/main reflog `e53c3d9 … 13:53:08 +0100: update by push` |
| 2 | 2026-11-04 14:27:04Z | SUBC-018 executor commits `61f81e8` in the subc-018 worktree | ⚑ agent-log bash entry; first-hand: `git show -s --format=fuller 61f81e8` (AuthorDate/CommitDate 15:27:04 +0100, `Fusion-Task-Id: SUBC-018`) |
| 3 | 2026-11-04 14:27:32Z | The non-watchdog push: `git push origin HEAD:refs/heads/main && git ls-remote origin refs/heads/main` | ⚑ agent-log tool entry; first-hand: persisted Step 4 step report (14:31:02.128Z) admitting "Committed as 61f81e8, then landed the reviewed tip to origin main (e53c3d9..61f81e8)" |
| 4 | 2026-11-04 14:27:34Z | origin/main advances `e53c3d9` → `61f81e8` ("update by push") | `git reflog show origin/main --date=iso` → `61f81e8 … 15:27:34 +0100: update by push` |
| 5 | 2026-11-04 14:27:36Z | Actions run #26 (id 41847758728) created — event push, head_branch main, head_sha `61f81e8b…`, actor/triggering_actor siimliimand (token-level only) | `gh api repos/siimliimand/subcontractor-marketplace/actions/runs/41847758728` (run_number 26, conclusion success) |
| 6 | 2026-11-04 14:30:12Z | Executor self-reports the landing in the task log | ⚑ agent-log fn_task_log entry; corroborated by the persisted Step 5 step report (14:32:38.476Z) |
| 7 | 2026-11-04 14:46:56Z–14:52:56Z | Engine merger builds squash `7bfab34` in the ai-merge clean room | ⚑ merger agent-log entries (SUBC-024 record); first-hand: `git show -s 7bfab34` (parent `e53c3d9`, squash title) + tree identity below |
| 8 | 2026-11-04 14:54:36Z (reflog 15:54:36 +0100) | Engine fast-forwards `7bfab34` onto local main — SHA-distinct from `61f81e8` over identical tree `4a55ec8…` → Regime B divergence | `git reflog show main --date=iso` → `7bfab34 … 15:54:36 +0100: merge …: Fast-forward`; `git rev-parse 61f81e8^{tree} 7bfab34^{tree}` → both `4a55ec844683c96ae5dc61b0adf5913c3c19f424` |
| 9 | 2026-11-04 15:08:31Z → 15:11:02Z | Gate diverged-refuse (ahead=1 behind=3) → silent CAS repair moves local main onto `61f81e8` at 15:10:35Z → gate noop | auto-push.log "15:08:31.238Z … ahead=1 behind=3 → refuse" then "15:11:02.405Z … ahead=0 behind=0 → noop"; main reflog `61f81e8 main@{2026-11-04 16:10:35 +0100}:` (empty message) |
| 10 | (state check) | PR #5 (ci-gate-probe/20261104-headref) CLOSED, `mergedAt` null — never merged; founder-manual/PR-#5 hypothesis disproven | `gh pr view 5 --json number,state,mergedAt,title,headRefName,closedAt` (closed 14:24:29Z) |

Gate-exclusion proof (why this was mechanically NOT the watchdog): auto-push.log jumps
from "12:54:29.498Z OK main pushed and green (tip e53c3d9…)" directly to "15:08:31.238Z
… refuse (… ahead 1, behind 3 …)" — no gate run logged in between; and local main stood
at `e53c3d9` until 14:54:36Z, so a component that only ever pushes local main could not
have pushed `61f81e8` at 14:27:34Z.

## Landing-gate enforcement made checkable — 2026-11-05 (SUBC-028)

**Decision: the landing-gate rule ("a landing is NOT complete until `push-main-when-ahead` exits 0") is now machine-checkable in-repo: `scripts/verify-landing-gate.mjs` (read-only, dependency-free, exits 0 only when BOTH a successful gate run is recorded for the tip in `~/.local/state/ci-currency/auto-push.log` AND the chained `scripts/verify-ci-currency.mjs` passes) is the chosen enforcement, anchored by the mandatory numbered "Landing checklist (SUBC-028)" in `agents.md` § "Auto-push on landing" with task-log evidence recording. The gate script itself stays untouched — it remains the only component that pushes — and the operator's */10 cron stays operator-owned (SUBC-020 action item 1). Rejected alternative — a GitHub-CI-side enforcement job — is structurally blind to the exact failure mode it would guard: CI only runs for pushes that occurred, so it can never observe a push that never happened (the SUBC-020 stall produced ZERO Actions runs while local main accumulated three landings). A scheduled GitHub liveness workflow was also rejected as too coarse for multi-hour stalls (an hourly-or-coarser remote schedule tolerates hours of drift where the */10 host watchdog tolerates ten minutes) and as new infra to maintain versus a dependency-free host script.**

Provenance:

- **Diagnosed gap (cross-referenced, not restated):** the SUBC-020 entry above — bullet "Landing-gate process gap (second trigger dead)" and its evidence table — diagnosed that the gate was skipped after each of the three 2026-11-04 landings and that nothing in the repo could detect the skip; the SUBC-024 execution findings (Fusion task system; no repo-doc record) carried this enforcement as a non-implemented operator option until this task shipped it.
- **Grammar pinning:** `parseGateEvidenceLine` / `findLandingEvidence` (new exports in `scripts/ci-currency-lib.mjs`, additive and zero-import for workerd-pool safety) recognize only the gate's two verbatim success shapes (`push-main-when-ahead: OK main pushed and green (tip <40-hex>, run id <digits>)` and `push-main-when-ahead: OK currency current`), classify FAIL / `--check` / intermediate-narration lines as non-evidence, and admit the noop-ok fallback only when its timestamp is at/after the tip's committer time; 21 unit tests in `test/landing-gate-evidence.test.ts` pin the grammar so a skipped gate can never again pass verification silently.
- **Coordination (SUBC-027):** `scripts/push-main-when-ahead.mjs` (SUBC-027's surface) and `scripts/verify-ci-currency.mjs` are consumed, never modified; all `ci-currency-lib.mjs` changes are new exports only so whichever task lands second rebases trivially. If SUBC-027's auto-adopt success path emits a new OK grammar, the parser extends rather than assumes (per this task's dependency note).

Evidence (2026-11-05, SUBC-028, worktree `subc-028` — filled live at execution end; see Step 5):

| Factor | Observation | Implication |
|---|---|---|
| Historical positive control | `node scripts/verify-landing-gate.mjs --strict f07eb9304d21b05be5d6a11dcdaccfca5c574612` → exit 0: evidence push-ok (strict), run id=41825457594, evidence ts=2026-11-04T12:01:09.825Z; currency OK (run #27 id=41859159358) | The SUBC-020 flush line (append-only in auto-push.log) resolves through the new checker: the historical gate run is re-verifiable years later, exactly as the checklist promises |
| Historical negative control | `node scripts/verify-landing-gate.mjs --strict b23ddf4` → exit 1: "no landing-gate evidence for tip b23ddf418ef6… scanned 56 line(s) (4 push-ok, 3 noop-ok) with none naming this tip (strict mode…)" + exact remediation | The SUBC-020 symptom class (a landing whose gate was skipped) now FAILS loudly with a one-command check naming the recovery — instead of sitting unpublished for hours |
| Read-only guarantee (live) | auto-push.log byte-identical across every checker invocation this session (mtime/size re-verified unchanged after each run; the 56→58 growth is my one documented `--check` probe at 19:11:36Z plus a concurrent external full gate run at 19:23:01Z — never a checker write); no lock directory ever created; no push, no alert touch | The checker adds a verification capability without adding a second writer to the watchdog's state |
| Both evidence kinds (live) | Default-mode run on the current main tip `530360c7…` → exit 0 selecting noop-ok evidence (ts 2026-11-04T19:23:01.521Z ≥ commit time 15:25:52Z); the same tip's push-ok line (run id=41859159358, ts 15:35:48Z) exists and is what `--strict` selects | The noop-ok fallback and the tip-named push evidence both hold on a real tip; newest-first selection and the timestamp ordering rule are exercised by production log state, not just fixtures |
| This landing's gate run | Accepted transient (SUBC-020 precedent): the engine lands SUBC-028's commits engine-side AFTER execution (local main was still `530360c` at session end; the four task commits sit on `fusion/subc-028`), so the gate flush for THIS tip is mandatory at landing time per the new "Landing checklist (SUBC-028)" — the checklist this task ships is its own enforcement | The flush-and-verify obligation is now anchored in agents.md with a machine-checkable exit code; a later audit can demand it with the checker on the SUBC-028 tip sha |
| Test suite before → after | 42 files / 332 tests (Step 0 baseline) → 43 files / 353 tests: +21 assertion-bearing tests in `test/landing-gate-evidence.test.ts` (≥13 required); `test/ci-currency-guard.test.ts` byte-identical to main, 32/32 inside the 53/53 targeted run | The lib additions are purely additive — no existing consumer or test was touched, and the new grammar guards are real assertions on the watchdog's own line shapes |
| Full single-package gate | CI order, all exit 0: `npm run lint` (0 errors) → `npm run build` → `npm run typecheck` → `npm test` (43/43 files, 353/353 tests) | The repo's standard gate is green at the exact moment the enforcement lands |

## Local worktree and branch audit — 2026-11-04 (SUBC-026)

**Decision: the local task-branch and worktree inventory is now classified end-to-end with
recorded evidence; the one closed-work orphan branch `fusion/subc-006` (`048acdc`) is deleted
locally after a rescue pin (`rescue/fusion-subc-006` → `048acdc`, never pushed) and a
three-gate zero-loss proof; `fusion/subc-009` (`5a47d3e`) is DEFERRED — untouched because
its owning task is open-but-paused pending the operator's duplicate decision (its
`resumeLimboTipSha` is exactly the branch tip, so deleting it would break the engine's
documented resume path and pre-empt that decision); the `subc-021` worktree and its
checked-out stale-based branch are handed to the operator as exact commands (this sandbox
cannot touch another worktree's path — boundary probe recorded verbatim below); and scope
was strictly local-only — origin, the push gate, and the watchdog automation were never
touched (owned by SUBC-025/SUBC-027/SUBC-028/SUBC-030).**

Execution-time drift (live reading authoritative per spec; audit executed 2026-11-04 ~20:45
+0100): main advanced `530360c`→`84a1eb7` (SUBC-025 landing)→`4fb75f0` (SUBC-028 landing)
DURING the preflight; `fusion/subc-016` and `fusion/subc-027` branches+worktrees were
reclaimed by engine recovery ("[recovery] tip-already-merged … stale-cached-metadata-ghost-
conflict") while their owning tasks remain open todo; `fusion/subc-012` gained a worktree;
new open tasks SUBC-029/SUBC-030 appeared with branches/worktrees; and the SUBC-009
store/artifact divergence was reconfirmed (fn_task_show not-found vs live open-paused
artifact — the artifact is authoritative).

Provenance:

- All four stale tips (`048acdc` subc-006, `5a47d3e` subc-009, `a5e1ab1` subc-012,
  `a50b4b3` subc-021) are single engine-created `chore(SUBC-XXX): import dependency
  content from main` commits (reflogs: "branch: Created from <base>" plus one commit,
  nothing else) whose trees snapshot past main states — zero task-specific content by
  construction, which is why tree-identity proof plus a rescue pin makes deletion
  zero-loss. Provenance alone never authorizes deletion: the owning-task gate decides
  (006 closed → RETIRE; 009 open-paused → DEFER; 012 open → ACTIVE-KEEP; 021 stale-based
  and sandbox-untouchable → HANDOFF).
- Engine pickup-reset evidence: the planner's subc-016 reflog proof ("reset: moving to
  530360c…") died with that branch's reclaim; the live replacement proof is this task's
  OWN branch reflog — `fusion/subc-026`: "branch: Created from 530360c" → "commit:
  chore(SUBC-026): import dependency content from main" → "rebase (finish):
  refs/heads/fusion/subc-026 onto 84a1eb7" — the engine heals open-task branches onto
  current main at pickup.
- `fusion/subc-021`'s reflog shows creation from OLD main `5637fba` (2026-11-04 12:16:47
  +0100) and no reset ever — the surviving stale base this audit exists to eliminate.
- Premise drift vs the task description, recorded: subc-016/subc-027 fully reclaimed
  (a better end state than the planner expected — no stale object at all); subc-023
  already retired pre-task; SUBC-009's owning task present-and-paused rather than absent.

Evidence (2026-11-04, SUBC-026, worktree `subc-026`; main = `4fb75f0` at reading;
full per-ref commands and outputs in task document key=audit on SUBC-026):

| Ref / worktree | Tip | Ancestor of main | Tree identity | Owning task | Classification | Action / result |
|---|---|---|---|---|---|---|
| main | `4fb75f0` | — | — | — | mainline | never mutated by this task |
| fusion/subc-006 (no worktree) | `048acdc` | no (merge-base `59b5a3c`) | == `41ce310` "Archive phase-3 and phase-4 changes…", diff empty | SUBC-006 archived — store + task.json artifact agree | RETIRE | Gate A closed both channels; Gate B diff empty; Gate C no worktree; pinned `rescue/fusion-subc-006`; `branch -d` refused ("not fully merged", recorded); `branch -D` deleted |
| fusion/subc-009 (no worktree) | `5a47d3e` | no (merge-base `82aa7ef`) | == `274053d` "SUBC-007: restore GitHub push transport…", diff empty | SUBC-009 open-but-paused, duplicate-decision-required; artifact authoritative; resumeLimboTipSha == `5a47d3e` | DEFER | untouched; conditional post-decision recipe in action items |
| fusion/subc-012 + worktree subc-012 | `a5e1ab1` | no (merge-base `82aa7ef`) | == `3d117da` "SUBC-004: sync stale status claims…", diff empty | SUBC-012 todo (parked on founder input, dep SUBC-029) | ACTIVE-KEEP | untouched; engine resets at pickup |
| fusion/subc-021 + worktree subc-021 | `a50b4b3` | no (merge-base `5637fba` = OLD main) | == `f07eb93` "SUBC-015: fix MTR import format drift…", diff empty | SUBC-021 todo (unstarted; queued for dispatch during this audit) | HANDOFF | operator commands in action items, with live-state caveat |
| fusion/subc-025 + worktree subc-025 | `0378235` | no (merge-base `530360c`) | == `84a1eb7` — its own landing, diff empty | SUBC-025 in-review | ACTIVE-KEEP | untouched; engine owns branch lifecycle |
| fusion/subc-026 + worktree subc-026 (self) | `84a1eb7` | yes | — | SUBC-026 in-progress | ACTIVE-KEEP | this task's branch; its reflog is the pickup-reset proof |
| fusion/subc-028 + worktree subc-028 | `154f864` | no (merge-base `530360c`) | == `4fb75f0` — its own landing, diff empty | SUBC-028 in-review | ACTIVE-KEEP | untouched; engine owns branch lifecycle |
| fusion/subc-029 + worktree subc-029 | `530360c` | yes | — | SUBC-029 todo (planning) | ACTIVE-KEEP | untouched; clean current base |
| fusion/subc-030 + worktree subc-030 | `cbafff9` | no (merge-base `530360c`) | == `84a1eb7` (bare import pattern) | SUBC-030 todo (planning) | ACTIVE-KEEP | untouched |
| mission/M-MW0Y99TK-0001-QM7G | `4bc5dc0` | no (merge-base `3d117da`) | not assessed — out of scope | mission active | RECORD-ONLY | mission lifecycle owned by the mission system |
| .ai-merge clean room (detached `4fb75f0`) | `4fb75f0` | — | — | engine merger (SUBC-028 landing) | RECORD-ONLY | engine transient; engine removed it during this audit |
| fusion/subc-016, fusion/subc-027 | (gone) | — | — | tasks open todo, branchless | RECORD-ONLY | engine tip-already-merged reclaims during preflight; recreated at dispatch |
| fusion/subc-023 | (gone) | — | — | SUBC-023 done | RECORD-ONLY | already retired pre-task |

Sandbox boundary (verbatim): `git -C ../subc-021 rev-parse --abbrev-ref HEAD` → "Command
targets a path outside the worktree boundary. Commands must run inside the worktree."
(identical rejection for `../subc-016`, whose worktree is since reclaimed). Cross-worktree
dirtiness is unverifiable from a task sandbox — recorded as such; `git worktree remove`
refuses dirty worktrees by itself, which is the handoff's built-in safety net.

Divergence-hazard rationale (recorded for every RETIRE/DEFER/HANDOFF item whose tip is not
an ancestor of main): landing a non-ancestor branch whose tree is byte-identical to an
in-main commit via an executor tip-chain push racing the engine squash re-creates the
SHA-level identical-tree divergence repaired in SUBC-019 Step 3 / SUBC-023 (the agents.md
single-writer contract SUBC-025 codified now prohibits the executor-side trigger). Deletion
— not rebase — is correct: tree-identity proves zero unique content, so a rebase would
produce an empty-diff rewrite that only re-dates the import.

Durable policy established by this audit: local `fusion/*` branches of closed/archived
tasks are retired only after BOTH the task store and the `task.json` artifact confirm
closure, always with a rescue pin first; branches of open tasks — including paused-open
tasks awaiting operator decisions — are never touched (the engine resets them onto current
main at pickup, proven live by the fusion/subc-026 reflog); `mission/*` refs and remote
refs are out of scope for task-branch hygiene.

**OPERATOR ACTION ITEMS (recorded for the operator; agents must not execute these):**

1. `subc-021` stale-base retirement — run from the primary checkout, and ONLY after
   re-verifying SUBC-021's task state (it was queued for dispatch behind an active
   file-scope lease during this audit; if it has started or completed by then, re-classify
   first — a completed landing makes these commands the standard post-finalization
cleanup, an in-flight execution means wait):
   (a) `git diff --shortstat fusion/subc-021 f07eb93` — expect EMPTY output (zero-content
   proof; the equivalent diff was verified live from the audit worktree);
   (b) `git worktree remove .fusion/worktrees/subc-021` — if git refuses because the
   worktree is dirty, inspect and decide (the task is unstarted, so dirt is not expected);
   (c) `git branch -D fusion/subc-021` — `branch -d` would refuse (tip is not an
   ancestor); `-D` is safe only after (a).
2. Conditional `fusion/subc-009` retirement — run ONLY after the pending duplicate
   decision resolves against SUBC-009 (duplicate confirmed, task closed/archived; never
   while the task is paused-open): `git tag rescue/fusion-subc-009 5a47d3e` then
   `git branch -D fusion/subc-009`.

## MTR dry-run diagnostics and re-import operator handoff — 2026-11-05 (SUBC-029)

**Decision: the MTR import CLI gained a structurally read-only `--dry-run`
mode (three diagnostics SELECTs, zero writes for ANY input), the SUBC-015
format-drift fix was verified intact on HEAD rather than re-implemented, and
the production re-import itself is HANDED TO THE OPERATOR via the
`reimport-runbook` task document — recorded here as a handoff, NOT as
applied.** Owner: operator (browser download + both `wrangler --remote`
steps); engineering: dry-run mode + verification shipped here. Applying the
runbook is what unblocks SUBC-012's ≥10-provider spot-check.

**Verified, not rebuilt (Step 0 evidence, no commit):** HEAD `4fb75f0`
carries the full SUBC-015 fix — dual-layout `noticesOf` (`/load|luba/i`),
the staatus rule with `xsi:nil` open-endedness, `emtak`/`emtak2025`
collection, and the zero-upsert guard with distinct extraction/mapping drift
warnings; `mtr-luba-sample.xml` + `mtr-format-drift.xml` present;
`mtr-sample.xml` untouched since `ed51619` (pre-dates SUBC-015; no commit
after `f07eb93` modified it). Baseline `test/import-mtr.test.ts`: 21/21
green before any SUBC-029 change.

**What shipped (purely additive, no SUBC-015 logic touched):** `opts.dryRun`
on `buildImportPlan` → plan fields `dryRun`/`dryRunSql`; `planToSql` renders
dry-run plans as header + diagnostics + warnings + projection summary and
never an INSERT/UPDATE; `--force-expire` under `--dry-run` is ignored with an
explicit warning (dry-run wins unconditionally). CLI exit codes preserved
(healthy dry-run 0; guarded dry-run 1 with the GUARD stderr while the
diagnostics still print, so a drifted file yields before-counts). The
diagnostics bundle is exactly three SELECTs: (1) current `mtr:%`
trade-notification rows grouped by status; (2) the expiry projection COUNT
mirroring the expire UPDATE's WHERE clause verbatim with the matched IN list
(`IN ('')` when nothing matched); (3) how many matched undertakers exist in
`companies` (the no-op upsert population stays visible). Test suite 21 → 27:
dry-run unit cases across all three fixtures (incl. a no-writes case for
`plan.dryRunSql` AND `planToSql` output) plus a miniflare D1 case executing
the bundle and proving correct projections with zero row changes.

**Why the apply is an operator runbook, not an agent step (live probes,
2026-11-05, worktree `subc-029`):**

| Probe | Observation |
|---|---|
| Fresh-export download | `https://mtr.ttja.ee/opendata/avaandmed_ettevotjad.xml` → HTTP 403 Forbidden, content-type `text/html`, 5,558-byte Cloudflare-style bot-challenge page (node fetch with full browser User-Agent/Accept headers; ONE attempt, no retries) — the operator downloads the file in a browser |
| Remote D1 from the session | `CLOUDFLARE_API_TOKEN` absent from the session environment; the documented token location is outside the worktree sandbox boundary (path access rejected) — every `wrangler d1 execute … --remote` step is operator-owned, consistent with the standing "remote ops cannot run from the worktree" project note |

**Expected count bands for the operator (SUBC-015 2026-11-04 baseline):**
undertakers read ≈56,000–57,000; matched undertakers ≈5,000–5,200; upsert
rows ≈8,000 (baseline 8,095; all six trades present); matched near zero or
far outside the band = STOP and investigate — never `--force-expire`. Full
six-step flow, hard-stop conditions, and guard/exit-code meanings live in
the SUBC-029 task document `reimport-runbook`. Same edit corrected agents.md's
stale pre-measurement band ("≈5,097 rows upserted across ≈5,097 undertakers")
to the measured `≈8,095 rows across ≈5,097 undertakers`.

**Re-evaluation trigger:** the operator's AFTER-counts follow-up (runbook
step 6) recorded against this entry; any new export schema change (the
dry-run bundle now makes drift visible before any write path); or SUBC-012's
TTJA licence confirmation, which remains the gate for badge display
(`MTR_BADGES_ENABLED`) — importing is safe, displaying is still not.

## Operator cron re-issued — 2026-11-05 (SUBC-032)

**Decision: the */10 operator cron stays the sanctioned always-on flush
trigger, and its installation card is re-issued as one canonical,
self-contained document — `docs/operator-ci-currency-cron.md` — now with
the SUBC-028 acceptance tooling (`scripts/verify-landing-gate.mjs`) built
into its post-install sequence. The gate-at-landing alternative is recorded
as ALREADY SHIPPED (the "Landing checklist (SUBC-028)" in `agents.md` §
"Auto-push on landing") but NOT a replacement: engine-side squash landings
occur outside any agent session, and the single-writer landing contract's
pending-landing semantics (item 3) require an always-on trigger to publish
them. Cron repair therefore remains operator-owned (SUBC-020 action item 1
stands — the crontab spool denies agent identities by design), and CI-side
enforcement stays rejected per the SUBC-028 entry (CI can never observe a
push that never happened).**

What shipped (documentation only — no script, workflow, or test file
changed; SUBC-027 owns gate-script internals): the canonical operator card
`docs/operator-ci-currency-cron.md` (prerequisites, the exact four-command
install block reproduced byte-identical, the `/usr/local/bin/node` rationale,
the numbered four-step post-install acceptance sequence citing each expected
OK line form, drift/alert response, rollback, host-rebuild re-apply, and
references); the re-issue status appended to the Scheduled trigger bullet in
`agents.md` § "Auto-push on landing (SUBC-008)" pointing at the card as the
operator's single entry point; and this entry. The SUBC-020 entry above
stays untouched as immutable history.

Evidence (2026-11-05, SUBC-032, worktree `subc-032` — live Step 0 probes):

| Factor | Observation | Implication |
|---|---|---|
| State directory | `~/.local/state/ci-currency` holds ONLY `auto-push.log` (12,005 bytes; 74 newline-terminated lines, 72 non-empty); `cron.log` ABSENT; no `alert`, no `lock/` | The crontab redirect creates `cron.log` on any firing → the */10 entry has fired ZERO times since install; ≈66 */10 slots elapsed between the SUBC-020-era last manual noop (2026-11-04T09:56Z) and this probe (host clock 2026-11-04T21:02Z) — the cron was dead through all of them |
| Last landing evidence | auto-push.log tail: push of tip `9a749b4461886aff0d2723aab97cfc5274a43be5` at 2026-11-04T20:33:56Z → Actions run #29 id=41907815753 (event=push, conclusion=success) → chained verify-ci-currency OK (20:35:50Z) | Landing evidence is MANUAL-only (the SUBC-031 flush); no scheduled-tick line exists anywhere in the log |
| Recurring cost (confirmed) | The SUBC-026 landing (`50433302`) and the SUBC-029 landing (`9a749b44`) both sat unpublished on local main until SUBC-031 manually ran the gate on 2026-11-04 | SUBC-020's prediction held: without the cron, every landing needs a manual flush session |
| Spool denial (re-probed) | `crontab -l` → `crontabs/fusion/: fopen: Permission denied` (exit 1) | Agent identities still cannot read or write the crontab — installation is operator-side by design; the documented card is the deliverable |
| Scheduler + toolchain alive | `pgrep -x cron` → pid 1463666; node v22.14.0, git 2.53.0; gh 2.101.0 responds from the worktree (not on the host probed-command list — recorded with that caveat) | crond will run the line the moment the operator installs it; the card's prerequisites are verifiable live |
| Worktree currency | branch `fusion/subc-032` @ `9a749b4461886aff0d2723aab97cfc5274a43be5` == origin/main (`git ls-remote`), 0/0 ahead-behind, clean tree | The docs record the live tree state; Step 1 (76634c5) and Step 2 (6e7a51d) landed before this entry |

Canonical install block (byte-identical to `docs/operator-ci-currency-cron.md`
and `agents.md` § "Auto-push on landing" — verified by fixed-string grep in
Step 4):

```bash
gh auth setup-git
git remote set-url origin https://github.com/siimliimand/subcontractor-marketplace.git
mkdir -p ~/.local/state/ci-currency
( crontab -l 2>/dev/null; echo '*/10 * * * * cd /var/www/code.webuilder.dev/subcontractor-marketplace && /usr/local/bin/node scripts/push-main-when-ahead.mjs >> /home/fusion/.local/state/ci-currency/cron.log 2>&1' ) | crontab -
```

Re-evaluation triggers:

- **Native Fusion post-merge hook** (per the SUBC-008 decision's long-term
  option): if the engine grows a post-merge hook, migrate the flush into the
  engine merge flow and retire the cron line and the card — the always-on
  gap the cron covers would then be closed engine-side.
- **SUBC-027 (todo):** its auto-adopt work changes gate-script internals
  only; the cron line, the card, and this entry reference the script's
  invocation path and log surfaces, not its internals, so its landing
  changes nothing here. (If SUBC-027 adds a new OK grammar, the SUBC-028
  coordination note applies: the parser extends, never assumes.)

## Landing-gate tree-identity adoption — 2026-11-05 (SUBC-027)

**Decision: the landing gate now self-heals the one provably harmless
mainline divergence. When local `main` and `origin/main` have diverged but
`git diff --quiet` proves the two tips carry IDENTICAL trees, the gate
adopts the origin tip locally — a compare-and-swap `git update-ref` of
`refs/heads/main` with an explicit reflog message naming both tips and both
trees — then re-asserts convergence (0/0) and chains the authoritative
`verify-ci-currency.mjs`, exiting 0 when currency holds. Every other
behind/diverged shape refuses exactly as before. This automates the manual
repair recipe the ops tasks had been repeating by hand, entirely inside
repo tooling; no engine behavior changes.**

Context:

- **The recurring incident shape (SUBC-018, 2026-11-04):** the engine's
  squash-landing and a spec-instructed direct tip push wrote two published
  histories with identical content — local `main` `7bfab34`, `origin/main`
  `61f81e8`, identical tree `4a55ec84…`, ahead=1 behind=3. The gate refused
  at 15:08:31Z (`refuse: DIVERGED (ahead 1, behind 3)`), wrote the alert
  file, and froze all landings until an operator hand-ran the repair recipe
  at 15:10:35Z (empty-diff identity proof, then a compare-and-swap
  `update-ref` of the local ref onto the origin tip). SUBC-022 and SUBC-023
  repeated that dance by hand for the same wedge class.
- **The documented option (SUBC-024):** the SUBC-024 findings recorded this
  exact behavior as the gate-owned variant of the operator repair option —
  the architecture-dependent alternative to the maintainer-routed engine fix.
  This task ships it.
- **Adopted mechanics:** a refuse-branch refinement (`refineRefusalWithTreeIdentity`,
  pure logic in `ci-currency-lib.mjs`) that converts a diverged refusal into
  `adopt-origin` only when the trees are identical; an exit-code-interpreted
  `git diff --quiet` probe (exit 1 = differing trees, expected control flow —
  anything else throws to the existing outer catch); a compare-and-swap
  `update-ref` with NEW value (origin tip) before OLD value (local tip) —
  git's own CAS refuses a stale old-value, and the swapped order would
  silently revert an already-adopted ref, so a source-text wiring test pins
  the order; the explicit reflog message (pinned format:
  `push-main-when-ahead: adopted origin/main <originTip> over tree-identical
  diverged local main <localTip> (tree <originTree> == <localTree>, SUBC-027)`);
  a post-adoption convergence re-check (throw unless 0/0); and the shared
  authoritative verify chain (`runVerifyChain` → `verify-ci-currency.mjs`,
  now used by both the push and adoption paths). The `--check` probe reports
  the same refinement read-only (a would-be adoption is named; a probe
  failure reports `trees-unknown` and never crashes).
- **Scope boundary:** diverged-only. Behind-only, ahead-only, and equal
  shapes never reach the refinement — behind-only still refuses, ahead-only
  still pushes. Adoption never pushes anything: it moves only the local
  `refs/heads/main` ref (no worktree/index mutation, no merge, no rebase,
  no force — rehearsal showed `git status --porcelain` stays empty through
  an adoption).
- **Failure modes:** a lost CAS race (a concurrent writer moved the ref
  between probe and update) or a verify failure on a red/missing-tip run
  lands in the existing outer catch — alert written, exit 1 — and the next
  gate run re-evaluates from scratch. There is deliberately no retry loop
  and no rollback: the adoption is content-neutral and aligns local main
  with engine reality.
- **SUBC-028 grammar interaction (deliberate non-extension):** the
  adoption success line (`OK adopted origin/main tip …`) is intentionally
  NOT evidence in the SUBC-028 landing-gate grammar (`parseGateEvidenceLine`
  classifies it as `other`). An adoption publishes nothing — it proves the
  tip was already on origin — so landing verification must keep demanding
  push-ok/noop-ok evidence; treating adopt-ok as landing evidence would
  weaken the checker. The SUBC-032 coordination trigger resolves as
  "no parser change needed", not "parser extended".
- **Rejected alternative:** the engine-side fix (teaching the engine never
  to produce diverged-identical landings) remains maintainer-routed per the
  SUBC-024 findings — this task changes no engine behavior and adds no cron,
  workflow edit, or new trigger; the gate's three existing triggers inherit
  the behavior.

Evidence (2026-11-05, worktree `subc-027`): 18 new unit tests plus 6
source-text wiring assertions in `test/ci-currency-guard.test.ts` (decision
refinement incl. the SUBC-018 shape `(1, 3, true) → adopt-origin` and the
behind-only boundary, the verbatim reflog-message pin, `redactLogLine`
invariance, the CAS new-before-old argv pin, absence pins for
reset/pull/force); a scratch-repository rehearsal reproducing the exact
shape (ahead=2 behind=1, empty-diff proof, real-lib reflog message, adoption
landing with reflog entry + 0/0 convergence + clean porcelain, stale-CAS
refusal exit 128, swapped-argv hazard observed silently reverting); and a
live read-only regression (`--check` on converged main → noop line, exit 0,
no alert file). Full suite green: 43 files / 359 tests; lint 0 errors at the
recorded 4-warning baseline; typecheck clean.

Re-evaluation triggers:

- A real production adoption fires (reflog message on `main` carries the
  pinned text) — re-read the incident that produced it and confirm the
  single-writer contract was not the true culprit (per SUBC-025, the wedge
  class originates in direct pushes, which remain prohibited).
- The engine ships its own divergence-proof landing flow (the SUBC-024
  maintainer-routed fix): the adoption path then becomes dead code and
  should be retired with this entry as the record.

## Append-only audit test now asserts over the real route table — 2026-11-05 (SUBC-021)

**Decision: the "append-only guarantee" test in `test/effort.test.ts` now introspects the real
staff-API route table instead of the always-empty `appPaths` placeholder SUBC-017 deliberately
preserved; `src/worker/app.ts` exports a pure, typed `listAppRoutes()` helper to supply it.**
The vacuous block is gone — not merely retyped: `listAppRoutes()` constructs a fresh
`createApp()` instance and maps Hono's public `RouterRoute[]` table (`app.routes`, where mounted
sub-router paths are stored fully qualified) to `{ method, path }` records, so the test's
mutating filter (`POST/PUT/PATCH/DELETE`) and audit/events-path intersection assert over the
real surface. Three non-vacuity guards (populated table, `POST /api/requests/:id/time` present,
`GET /api/audit/export` present) make the empty intersection impossible to pass trivially. The
DELETE/PATCH probes and the history-equality check are byte-identical to before, and the
middleware row (`app.use("/api/*")`) registers as method `"ALL"`, so it can never be
mistaken for a mutating route.

**Why export-a-helper instead of delete-the-block:** the reporter's contract allowed either, not
both and not neither. Deleting the dead block would leave only the direct DELETE/PATCH probes,
which cover exactly two verbs on exactly one path shape — the pre-fix proof showed a violating
`PUT /api/audit-events/:id` route left the whole test green. The helper is ~12 lines of pure,
typed, additive code (no env, no I/O, no `any`, no casts), so the surface-level guarantee
("verify the API surface exposes no mutation of events") survives; a temporary violating route
is now caught by the intersection assertion for every verb class, including the probe-invisible
`PUT` class.

**No runtime behavior change:** `createApp()`'s registered routes and handlers are untouched
(the negative-control edits were temporary and reverted, grep-verified); no endpoint,
permission, or UI behavior changed. The change is net-additive (one type export plus one
function export; no removals), so a changeset is not required. Separate apps (`webhookApp`,
`publicApp`, `providerPortal` in `src/worker/index.ts`) are outside the introspected table by
design; the email webhook's `POST /hooks/email-events` lives in `webhookApp`, so "events"
paths can never appear in the staff table.

Evidence (2026-11-05, SUBC-021, worktree `subc-021`):

| Factor | Observation | Implication |
|---|---|---|
| Negative control (red) | Temporary `app.patch("/api/audit-events/:id")` inside `createApp()` fails the rewritten test at `expect(mutatingEventRoutes).toEqual([])` with `[ { method: "PATCH", path: "/api/audit-events/:id" } ]` in the diff; a `PUT` variant — which left the OLD vacuous test green — now fails the same way | The vacuous pass is gone: the introspection assertion catches every mutating audit-route class, including verbs the direct probes never exercise |
| Full verification (green) | `npm run build && npm run lint && npm run typecheck && npm test` exit 0 — lint 0 errors; 41 files / 320 tests before and after (identical to the Step 0 baseline) | Net-additive claim holds: no it-cases added or removed, no runtime logic touched; clean production code passes with the non-vacuity guards proving real route data flowed |

## SUBC-009 duplicate-decision retirement — 2026-11-05 (SUBC-038)

**Decision: the 2026-11-03 reviewer duplicate decision on SUBC-009 is confirmed, quoted verbatim, and finally acted on — the conditional retirement recipe above (SUBC-026 action item 2) was executed verbatim on 2026-11-05 behind a five-condition decision gate, retiring the paused-open limbo's last actionable artifact: local branch `fusion/subc-009` deleted only after the rescue pin `rescue/fusion-subc-009` → `5a47d3e56480a56e85cd0f2689e8eb0592f2957a` was verified in place (zero-loss proven by tree identity; all refs local-only; main and origin byte-identical before and after).**

The decision being acted on, verbatim from SUBC-009's agent log (83 entries; newest slice 2026-11-03T16:19:07–12Z, reviewer):

```json
{"verdict":"CLOSE_NO_OP","notes":"DUPLICATE: SUBC-008 — SUBC-009 re-files the identical deliverable (auto-push every local main landing to origin so on:push fires and scripts/verify-ci-currency.mjs asserts currency, as follow-up to SUBC-007) that SUBC-008 already owns: task metadata confirms nearDuplicateOf=SUBC-008 with nearDuplicateScore 1, identical dependency SUBC-007, identical base commit 82aa7efa, creation 83 seconds apart on 2026-11-03, and a PROMPT.md consisting solely of the duplicate marker. SUBC-008's acceptance criteria are a strict superset of SUBC-009's and SUBC-008 is live on the board in planning, while the SUBC-009 worktree preserves 0 commits so closing loses no work. Implementation must proceed only under canonical task SUBC-008.","findings":[]}
```

Limbo reconciliation and evidence channels:

- The SUBC-009 store row is gone (`fn_task_show(SUBC-009)` → "Task SUBC-009 not found"; a board-wide sweep across all columns and states finds no SUBC-009 row anywhere). The absence is the closure evidence — nothing was resurrected, re-created, or archived to reach it.
- The project-root `.fusion/tasks/SUBC-009/task.json` artifact still records the paused-open state (pausedReason `duplicate-decision-required`, marker `SUBC-008`, `resumeLimboTipSha` `5a47d3e` — per the SUBC-026 DEFER row above). It is unreachable from task-worktree sandboxes (bash probe returned: "Command targets a path outside the worktree boundary. Commands must run inside the worktree.") and was deliberately left untouched as forensic evidence; the decision-log record plus the agent log were the reachable channels.
- Executor-channel note: `fn_task_logs_read` had no task-targeting parameter in executor sessions at execution time (SUBC-036 pending), so the verdict above was captured verbatim from the planning session's engine-recorded tool result (result metadata `details.taskId="SUBC-009"`, `total=83`) persisted in SUBC-038's own agent log — quoted unmodified.
- Superseding-decision sweep (pre-execution, 2026-11-05): no SUBC-009 keep-decision exists anywhere reachable dated after 2026-11-03 — decision-log mentions end at the SUBC-026 deferral above (lines 455/469/493/502/549–552), agents.md has zero SUBC-009 mentions, and agent memory holds none. Gate conditions (decision exists, closure state, zero-loss provable, no superseding keep, pre-state exact) all PASS; recorded in SUBC-038's task documents (keys `evidence`, `gate`).

Execution and proof (2026-11-05, worktree `subc-038`, main at `bdba76176b7ead93de83eaea2843dbadbafca90c` throughout):

- Recipe executed verbatim, pin first: `git tag rescue/fusion-subc-009 5a47d3e56480a56e85cd0f2689e8eb0592f2957a` (lightweight — objecttype `commit`, no `-a`/`-m`; `git rev-parse 'rescue/fusion-subc-009^{commit}'` → the exact tip verified BEFORE any deletion), then `git branch -D fusion/subc-009` → "Deleted branch fusion/subc-009 (was 5a47d3e)". The plain `-d` refusal was demonstrated pre-execution ("error: the branch 'fusion/subc-009' is not fully merged"), matching the subc-006 precedent.
- Zero-loss proof: tip `5a47d3e` is a bare engine import commit (reflog: "branch: Created from 82aa7efa925249814e0b2544973c6a8dc3b7e493" plus exactly one commit, nothing else); its tree is byte-identical to `274053d` "SUBC-007: restore GitHub push transport and add CI currency guard" (`git diff --quiet 5a47d3e 274053d` exit 0, re-asserted after deletion), which is an ancestor of main; merge-base `82aa7efa925249814e0b2544973c6a8dc3b7e493`.
- Post-state: `rescue/fusion-subc-009` pinned at `5a47d3e56480a56e85cd0f2689e8eb0592f2957a`, local-only, never pushed (zero push commands run; `git ls-remote origin` byte-identical before and after — no `fusion/subc-009`, no tags); `fusion/subc-009` deleted (`git branch --list` empty); main tip unchanged. The pin joins the existing reversible-deletion precedent (`rescue/fusion-subc-006`, `rescue/fusion-subc-011`, `rescue/subc-023-old-main`).
- Successors: SUBC-008 (done) remains the sole surviving owner of the deliverable SUBC-009 re-filed; engine-side auto-retire of closed-task branches is SUBC-037, and promotion of a durable branch-hygiene policy into agents.md is SUBC-039 — this entry records the one-time manual disposition those successors automate and codify.

## Engine patch handoff: optional task targeting for fn_task_logs_read — 2026-11-05 (SUBC-036)

**Decision: the Fusion engine's task-bound `fn_task_logs_read` tool is patched UPSTREAM to accept an
optional read-only `task_id` parameter (sibling-task log reads, falling back to the session's bound
task when blank or omitted) — the patch is authored against the public engine, proven with the
engine's own test suite, packaged as a clean-applying two-commit patch, and handed to the operator
with a runbook. It is NOT applied to the running engine: the running install lives outside this
repository and its task sandboxes, and restarting the orchestrator is operator authority.** Until
the operator applies it, sibling agent-log evidence in this repo's audit and attribution work must
continue to come from sibling task.json persisted step reports (the SUBC-025 substitute channel).
This task deliberately did not touch the engine install, the gating classifications
(`fn_task_logs_read` stays in `COORDINATION_EXEMPT_TOOLS` and
`AGENT_PERMISSION_POLICY_EXEMPT_TOOL_EXAMPLES`), the chat/CLI registrations, or the store schema.

Provenance:

- **Origin (verbatim, SUBC-025 entry above):** "the SUBC-025 executor could not replay that log
  directly because `fn_task_logs_read` is current-task-scoped, and instead re-verified the same
  events through the persisted SUBC-018 step reports" — the substitute-labeled reconstruction this
  patch eliminates.
- **Pinned base:** public engine clone at `eb7eef49d5a0fe3e84e99be30e8ed9622a694e35`
  (@fusion/engine 0.78.0-beta.9, public main on 2026-11-05; equals the planning-time base), branch
  `subc-036-task-logs-read-targeting`, commits `32ebd3c` (feat) + `887496b` (test).
- **Changed surfaces — task-bound registration only:** `taskLogsReadParams` gains
  `task_id: Type.Optional(Type.String(...))`; `createTaskLogsReadTool.execute` resolves a non-blank
  trimmed `task_id` over the bound task (the CLI `fn_workflow_select` trim-and-fallback precedent);
  the tool description mentions sibling targeting; a dated `FNXC:TaskLogsRead 2026-11-05-08:41`
  comment documents the contract. Untouched by design: `chatTaskLogsReadParams` and
  `createChatTaskLogsReadTool` (chat keeps REQUIRED `task_id`), the CLI extension registration
  (keeps REQUIRED `id`), the shared `readTaskAgentLogs`/`buildTaskAgentLogReadText` builder
  (identical 12,000-character budgeting and `details.taskId` reporting), all four task-bound
  instantiation sites (`step-session-executor.ts:1546`, `agent-heartbeat.ts:4626`,
  `run-implementation.ts:2106`, `shared-worker-tools.ts:56-57`), both exempt-tool lists, and the
  store read path (`getAgentLogs`/`getAgentLogCount` — no schema or migration changes).
- **Test evidence (engine's own vitest, in-clone):** targeted suite
  `pnpm exec vitest run src/__tests__/agent-task-logs-read-tools.test.ts` → 13 passed (13): the 7
  pre-existing cases (paging normalization, filter-before-pagination, stream preservation, caps,
  preview/full modes, chat-requires-task_id) unmodified, plus 6 new scenarios — omitted-`task_id`
  bound fallback, sibling read with resolved `details.taskId`, whitespace-only fallback,
  sibling+type+limit filter composition, schema declares `task_id` while the required list excludes
  it, and unknown-id renders "(no matching log entries)" without throwing. Named regressions green:
  `gating-classifications.test.ts` and `heartbeat-executor.test.ts`; CLI `extension.test.ts` +
  `extension-integration.test.ts` green after building the unbuilt workspace plugin
  `@fusion-plugin-examples/antigravity-runtime` (fresh-clone bootstrap gap, proven pre-existing by
  reproducing it at the pristine base). `pnpm --filter @fusion/engine typecheck` exit 0;
  `check-changeset-format.mjs` exit 0; `check-fnxc-future-dates.mjs` reports no future-dated stamps.
- **Clean-apply check:** `git format-patch eb7eef4 --stdout` (214 lines, 2 commits);
  `git apply --check` exit 0 against a pristine detached `eb7eef4` checkout. The patch text is
  attached to the task (`subc-036-fn-task-logs-read-task-id.patch.txt` — the attachment surface
  rejects the `.patch` extension; content byte-identical) and stored as task document `engine-patch`.
- **Operator runbook:** task document `docs` — apply instructions (`git am` or
  `git apply --3way`), the targeted verification command, engine rebuild/restart per the operator's
  own procedure, the post-apply live acceptance recipe (from any task-bound session,
  `fn_task_logs_read` with `task_id` set to a sibling id renders that sibling's entries with
  `details.taskId` equal to the sibling id), and rollback (`git revert` of the patch commits).

Consequences: (1) until the operator applies the patch and restarts the engine, cross-task log
attribution in this repo keeps using the task.json step-report substitute channel — this entry
deliberately does NOT claim the capability is live; (2) the session's bound task remains the
implicit default, so existing callers see zero behavior change; (3) a post-apply capability note in
agents.md belongs to the follow-up that verifies the live recipe, not to this handoff; (4) the
patch targets the task-bound surface only, so chat and CLI tool contracts and both exempt-tool
classifications are unaffected whether or not it is applied.

## MTR tyyp filtering evaluation gated — 2026-11-05 (SUBC-042)

**Decision: GATE-BLOCKED — the evaluation was NOT performed and no ADOPT / KEEP-UNFILTERED / DEFER verdict is recorded.** The task's precondition gate requires durable AFTER-counts evidence of the APPLIED production re-import, recorded against the SUBC-029 entry per its re-evaluation trigger (:607); no such record exists anywhere durable. The import stays exactly as validated (unfiltered; the SUBC-015 baseline of 5,097 matched undertakers / 8,095 upsert rows stands); no code, fixture, band, or count changed. The SUBC-015 known-limitation bullet ("`tyyp` is not filtered …", :210) remains the premise, unchanged, for the future session that runs the evaluation.

**Gate evidence (searches performed 2026-11-05, live at HEAD `42783f9`):**

| Search | Result |
| --- | --- |
| `grep -n "AFTER" docs/decision-log.md` | Hits only at :280 (SUBC-020 engine-lands-after-execution transient), :446 (SUBC-028 accepted transient), and :607 (the SUBC-029 re-evaluation trigger naming evidence that does not yet exist). No hit records an observed count. |
| Heading scan past the SUBC-029 entry (:554) | Later entries are SUBC-032 (:613), SUBC-027 (:674), SUBC-021 (:767), SUBC-038 (:806) — none concerns the MTR re-import or records counts. |
| Full board enumeration (all columns) | No task in any column records an applied re-import or observed AFTER counts; done-column tasks after SUBC-029 are landing-flush/CI work only. |
| SUBC-029 task record | Completion summary records the runbook handoff ("recorded here as a handoff, NOT as applied", :559-560); its spawned follow-ups (SUBC-041, SUBC-042) carry no operator results. |
| SUBC-012 (the consumer the applied re-import would unblock) | Paused in todo since 2026-11-03; its spot-check and flag-flip steps are untouched — no operator application activity. |

**Evidence inventory.** EXISTS: the SUBC-029 operator handoff (`reimport-runbook` task document; expected count bands at :598-601) and the SUBC-015 DRY-RUN baseline on the real 2026-11-04 export (:220-222 — undertakers read 56,666; matched 5,097; upsert rows 8,095: electrical 3,740, plumbing 910, hvac 910, drywall 845, flooring 845, painting 845, which sums exactly to 8,095). MISSING: any durable record of an APPLIED production re-import with observed AFTER counts. The dry-run-vs-applied distinction is load-bearing — the 5,097/8,095 figures were measured DRY-RUN and are not applied evidence, so a filtering evaluation on them would evaluate an unmeasured applied baseline.

**What was NOT done:** no importer change (the parser retains zero tyyp handling); no re-import applied by this task; no fixture, band documentation, or count modified; no per-tyyp distribution captured; no ADOPT / KEEP-UNFILTERED / DEFER procedure run and no follow-up task spawned; no counts fabricated or estimated anywhere; existing entries untouched (the file stays append-only).

**Re-evaluation trigger:** the operator applies the `reimport-runbook` (SUBC-029 task document) in production and records the observed AFTER counts durably against the SUBC-029 entry (the :607 trigger) — then a fresh SUBC-042 execution session re-enters the precondition gate: durable applied evidence inside the :598-601 bands proceeds to the full evidence-corpus and decision procedure; counts outside the bands stop with a recorded band table. SUBC-012's TTJA catalogue confirmation and any future export schema change (:198) remain downstream triggers.

**Closure mechanics (SUBC-020/028 precedent):** the engine requires at least one commit to close a task and freezes cards only for host-resource, network, model-provider, or credential causes, so this operator-input wait could not park terminally without a commit; the sanctioned closure records THIS gate-evidence entry — the only file this task's own constraints permit on any branch — explicitly as a gate record, not a verdict. This documentation commit lands via the engine AFTER execution, leaving local main one commit ahead until the landing-gate flush; per agents.md the landing is complete only when the gate publishes the tip.

Owner: founder (operator applies the runbook and records the AFTER counts; agent sessions own the re-entry evaluation).

## Closed-task branch retirement shipped engine-side with automatic rescue pin — 2026-11-05 (SUBC-037)

**Decision: the closed-work orphan-branch class is retired at the engine level.** A deterministic retire-after-archive hook — implemented against Runfusion/Fusion main `eb7eef4` (clone `scratch.local/fusion`, branch `subc-037/retire-after-archive`, three commits) — routes every terminal archive/delete path's Fusion-owned local branches through one rescue-pin contract: landed tips (ancestry OR bounded tree-equality, the squash-merge shape) are deleted outright, unlanded tips gain a lightweight `rescue/<branch-with-/--as-->` pin verified at the exact tip sha BEFORE the branch ref disappears, operator-owned and worktree-held branches are kept, and every outcome is audited on the task log. Upstream delivery is path B — patch-bundle handoff: the Step 0 probe recorded `gh repo view Runfusion/Fusion --json viewerPermission` → `READ`, so no fork, push, or PR was created autonomously and the operator owns opening the upstream PR. This repo receives only this entry; agents.md is deliberately untouched (the branch-hygiene policy promotion is SUBC-039's deliverable).

### The gap this closes

- The SUBC-019 audit's manual disposition (this file :453-454, disposition table :501) — rescue-pin `rescue/fusion-subc-006` → `048acdc`, then `branch -d` refused ("not fully merged") and `branch -D` deleted `fusion/subc-006` — is exactly the operation the engine now performs automatically, with the same pin grammar (lightweight tags, `objecttype commit`, name = `rescue/` + branch with every `/` → `-`; operator pins `rescue/fusion-subc-006` and `rescue/fusion-subc-011` re-verified live at planning).
- Live recurrence at planning: `fusion/subc-030` existed locally at `8200629` while SUBC-030 was done — an UNLANDED orphan (tip not an ancestor of main; tip tree `d22792a` ≠ main tree) with no worktree hold: precisely the shape the automatic rescue pin preserves. Done tasks subc-019/021/027/031/032/034/035 left no branches — the mixed behavior the diagnosis below explains.

### Diagnosed lingering mechanisms (code-verified at `eb7eef4`, clone file:line)

| # | Mechanism | Anchor |
|---|---|---|
| 1 | Silent skips in `cleanupBranchForTaskImpl`: unsafe name → continue; `isFusionDeletableBranch` false → continue; `rev-parse --verify` exit≠0 → continue; `branch -D` exit≠0 (e.g. branch checked out in a live worktree) → silently not deleted | packages/core/src/task-store/task-mutation-ops.ts:1453-1488 |
| 2 | Archive live-refusal suppression: a disposer refusal skips branch cleanup AND dir removal entirely (by design, data-preserving) and nothing later retires the branch | packages/core/src/task-store/archive-lifecycle-2.ts:598-600 |
| 3 | DISCOVERED GAP — the async delete path (`deleteTaskBackendWithClaimResultImpl`) contained NO `cleanupBranchForTask` call at all; the `FNXC:TaskDeletion` comment (archive-lifecycle.ts:157-158) documented intent the code never delivered — deleted tasks left branches and any unlanded tip behind with no pin | packages/core/src/task-store/archive-lifecycle-2.ts:163-421 |
| 4 | Hard-removal sweep (`cleanupArchivedTasksImpl`) gave archived tasks no second-chance branch retirement — anything that survived archive-time cleanup lingered forever | packages/core/src/task-store/task-mutation-ops.ts:1754 |
| 5 | Workspace archive disposer (`registerArchiveWorkspaceWorktreeDisposer`) bypassed the store choke point with bare `git branch -D` per-repo deletion — no pin, no provenance guard | packages/engine/src/executor/wire-executor-lifecycle.ts:195 |
| 6 | Deployed-version drift: whether the engine deployed on this host runs the cleanup-defaults-true rule is NOT provable from this sandbox (`/home/fusion` engine state is boundary-restricted); recorded as unverifiable — the fix makes every outcome auditable, so future drift is diagnosable from task logs | — |

### What shipped (design locked in the SUBC-037 `design` task document)

- New core helper `packages/core/src/branch/branch-retire.ts` (exported from the package index; no core→engine imports): fixed pipeline resolve tip → `assertSafeGitBranchName` → provenance guard (`classifyTaskBranchOrigin`/`isFusionDeletableBranch`, untouched and load-bearing) → landed proof (`git merge-base --is-ancestor` OR bounded tree-equality scan, `--max-count=500`, for the squash-merge shape where ancestry alone is insufficient — the decision-log Gate B evidence class) → lightweight rescue pin when unlanded (collision policy: same sha reuses the tag, different sha takes a deterministic `-2`/`-3` suffix, never overwrites; pin verified via `rev-parse <tag>^{commit}` before deletion) → `branch -D` → `clearStaleExecutionStartBranchReferences` → best-effort task-log audit for EVERY outcome (`deleted-landed` / `deleted-pinned` / `already-absent` / `kept-operator` / `kept-held`). Worktree-held branches are checked BEFORE pinning, so a held branch is kept with NO pin; deletion failure after pinning keeps the branch (pin harmless). Integration ref ladder: `task.mergeDetails?.mergeTargetBranch` → `task.baseBranch` → `task.executionStartBranch` → core's well-known integration branches; local `refs/heads` only — remote refs are never touched (asserted in tests).
- Adoption sites: `cleanupBranchForTaskImpl` (the single store-level choke point, now pinning and logging with no silent skips), `cleanupArchivedTasksImpl` (second-chance retirement before directory removal), the async delete path (the documented-but-missing `cleanupBranchForTask` call — mechanism 3 closed, making the `FNXC:TaskDeletion` comment true), and the workspace archive disposer (bare `branch -D` replaced by the helper; per-entry failure collection and the workspace-root refusal guard preserved).
- Untouched by design: the reactive tip-already-merged recovery (`worktree-branch-conflict-handle.ts`) and the reclaim-stale-active-branches sweep (`self-healing.ts`) — their regression test files stayed green unchanged.

### Verification (all zero-failure, real-git fixtures)

- Core: `packages/core/src/__tests__/branch-retire-rescue-pin.test.ts` — 10 scenarios mapping to the enumerated data states: unlanded → pin at exact tip sha then deleted; ancestry-landed → deleted, no pin; squash tree-equality → deleted, no pin; idempotent re-run; pin reuse at same sha; pin collision → `-2` suffix, original untouched; operator override kept untouched; worktree-held kept with NO pin; canonical-only retirement when `task.branch` is undefined; stale reference clearing.
- Engine: `packages/engine/src/__tests__/archive-disposal-retire-branch.test.ts` — real two-repo workspace fixtures through the actual wiring: unlanded per-repo branch pinned before deletion, landed branch deleted with no pin.
- Symptom acceptance: both pre-fix repro shapes are asserted absent post-fix — the lingering shape (every candidate outcome now audited/retired; the delete-path gap closed) and the unpinned-deletion shape (unlanded-tip tests assert the rescue tag resolves to the exact tip sha BEFORE the branch ref disappears); the 1:1 test-name mapping is in the SUBC-037 task log (Step 5).
- Gates: `pnpm check:changesets`, `pnpm lint`, and scoped typechecks for `@fusion/core` + `@fusion/engine` all zero-failure; package-graph rule holds (engine→core only).

### Upstream delivery status (path B — patch-bundle handoff)

- `viewerPermission` probe (Step 0, verbatim): `gh repo view Runfusion/Fusion --json viewerPermission` → `READ`. No fork, push, or PR was created.
- Handoff artifacts attached to SUBC-037: `0001-feat-core-retire-closed-task-branches-with-automatic.patch.txt`, `0002-feat-engine-workspace-archive-disposal-retires-branc.patch.txt`, `0003-chore-changeset-document-retire-after-archive-rescue.patch.txt`, and `bundle-summary.txt` (under `.fusion/tasks/SUBC-037/attachments/`; apply with `git am` on a tree at or after `eb7eef4`). The changeset in commit 3 carries the `@runfusion/fusion` patch bump with the operator-facing summary, validated by `pnpm check:changesets`.
- The operator owns opening the upstream PR and the upstream merge decision.

### Reversibility

- Work-loss safety: rescue pins preserve unlanded tips as lightweight tags before any branch ref deletion, mirroring the operator pins this entry's precedent established; deletion failure after pinning keeps the branch.
- Code-loss safety: the patch bundle preserves the implementation independent of the disposable clone.
- This repo's exposure: exactly one commit (this entry); no live refs in the subcontractor-marketplace repo were touched, and the engine clone's commits are scratch.

Owner: operator (upstream PR on Runfusion/Fusion); SUBC-039 owns the agents.md branch-hygiene promotion.


## Strict landing evidence for ancestor tips — 2026-11-05 (SUBC-044)

**Decision: `--strict` landing audits now accept push-ok evidence whose pushed tip PROVABLY DESCENDS from the audited tip (ancestry via `git merge-base --is-ancestor`, injected as a predicate so the pure lib stays zero-import), closing the SUBC-031 dead-end where a published landing later passed by another legitimate gate push could never receive a strict receipt.**

Case that motivated it: SUBC-031's audit target `50433302f9926829ce4ebbc48871ed2391da0fd1` (the SUBC-026 landing) was published to origin only as an ancestor of gate-pushed tip `9a749b4461886aff0d2723aab97cfc5274a43be5` (SUBC-031's flush, Actions run #29 id 41907815753): no log line names 50433302, the pre-change strict checker exited 1 with "…none naming this tip (strict mode: only tip-named push-ok evidence counts)" (verbatim Step-0 capture: scanned 111 line(s), 10 push-ok, 6 noop-ok, rest non-evidence), and the audit had to be closed with a manual `git merge-base --is-ancestor` argument plus a documented rationale. A strict receipt is now issued in exactly that situation.

New semantics (SUBC-028's evidence grammar is untouched — `parseGateEvidenceLine` and both verbatim success shapes are unchanged, and no new log shape becomes evidence):

- `findLandingEvidence` gains an optional injected `isTipDescendant(auditedTip, pushedTip)` predicate; all git I/O stays in the checker (`scripts/verify-landing-gate.mjs` builds it from a `git cat-file -e <pushedTip>^{commit}` object guard plus `git merge-base --is-ancestor <audited> <pushed>` interpreted by exact exit code — 0 → proven, 1 → evaluable not-an-ancestor, anything else → non-evaluable), cached per pushed tip so failure diagnostics never re-run git. The lib remains zero-import and the checker strictly read-only.
- Inside the newest-first scan, the push-ok arm returns exact-tip matches first (reason text byte-identical), then descendant-tip matches (`isTipDescendant(tipNorm, parsed.tip) === true` required — fail-safe). The newest acceptable line wins, so a NEWER descendant push-ok shadows an OLDER exact push-ok line (pinned by unit test) — exactly as a noop-ok could already shadow an older push-ok.
- Both checker modes accept descendant evidence; strict mode still suppresses the noop-ok fallback; default-mode shadowing order is unchanged (pinned by unit test).
- Results gain additive `matchKind`: "exact-tip" | "descendant-tip" | "noop-fallback" | null; the evidence object shape and the 0/1/2 exit-code contract are unchanged.
- The checker's OK receipt names the match kind and, for descendant matches, the FULL pushed tip; failed audits append bounded tip-mismatch diagnostics (distinct pushed tips newest-first, cap 8) each with its verdict — "not an ancestor of the audited tip" or "ancestry not evaluable (object missing locally; fetch and retry)" — plus the kept remediation sentence.

Safety argument: a gate push of a descendant tip necessarily carried the audited commit to origin history (the gate pushes fast-forward-only with a single hardcoded refspec and no --force), so proven descendant-push evidence is proof of publication, not a relaxation of it. Directionality is one-way (audited ancestor of pushed) — a pushed tip OLDER than the audited tip is never accepted (pinned); missing pushed-tip objects are non-evaluable and never pass silently; the predicate must return exactly true; a wrong-typed predicate throws (mirroring `refineRefusalWithTreeIdentity`'s fail-safe style). The chained live currency leg is consumed unchanged.

Control flip (premise shift discovered during planning, confirmed live): the standing durable negative control `b23ddf418ef6d359561663301877ad3bb25c7623` (SUBC-018 tip-chain sha) IS an ancestor of gate-pushed tips, so under the new semantics it correctly GAINS a descendant receipt — it is retired as the durable negative by this entry (documentation-only retirement; the append-only log was not edited). The new durable negative is `7bfab347738c1d7dd59b4b97067bbdaf9633ae26` (the `rescue/subc-023-old-main` pin): not in main history, therefore an ancestor of no gate-pushed tip; its tree-identical twin `61f81e8` is what actually shipped, so no receipt is the correct answer for it. Backup negatives with the same verified property: `rescue/fusion-subc-006` (048acdcf2520d22f46cc67ff3504a8abe8199b54) and `rescue/fusion-subc-011` (d6f932f929a7707a87f39b0a1ab823e17251c291).

Recorded control matrix (strict commands against the live host log; pre-change captured at Step 0 on the 111-line log, post-change after the convergence heal below; verbatim stdout in SUBC-044's task log and scratch captures):

| # | Command | Pre-change | Post-change |
|---|---|---|---|
| 1 | `--strict f07eb930…` | exit 0, exact-tip (own push line, run id=41825457594) | exit 0, match descendant-tip via pushed tip 9df649f8e297 (run id=42013976106) |
| 2 | `--strict bdba761…` | exit 0, exact-tip (newest pushed tip at planning) | exit 0, match descendant-tip via 9df649f8e297 |
| 3 | `--strict 50433302…` | exit 1 — THE SYMPTOM ("none naming this tip (strict mode…)") | exit 0 — match descendant-tip via 9df649f8e297 (run id=42013976106): symptom gone |
| 4 | `--strict b23ddf4…` | exit 1 (then believed durable negative) | exit 0, descendant-tip (documented flip → retired as negative) |
| 5 | `--strict 7bfab34…` | exit 1 | exit 1 — now with tip-mismatch diagnostics naming 8 distinct pushed tips "not an ancestor of the audited tip" |
| 6 | no-arg | exit 0 (healthy path) | exit 0, exact-tip on 9df649f8e297 |

Receipt-shape drift vs the spec's predictions (premise-moved protocol): the matrix was anchored to planning-time log state (newest pushed tip bdba761; 42783f9 joined post-planning; the execution-time heal added 9df649f). Under the designed newest-acceptable-wins semantics, controls 1–4 report the newest descendant push (9df649f, run #34 id 42013976106) rather than each tip's own older exact line, and control 3 names 9df649f rather than 9a749b44 + run 41907815753; that fixture is pinned verbatim by the Step-1 unit test, and every exit code matches the spec contract.

Convergence heal during execution: main was ahead-only by 3 unpublished landings (SUBC-042 `88a8639`, SUBC-036 `1b16be5`, SUBC-037 `9df649f`) when the control matrix came due; healed through the gate itself (single writer): `push-main-when-ahead.mjs` exit 0, pushed tip `9df649f8e297b969b3cd42a8db04e7ae95f5bb57`, Actions run #34 id 42013976106 success, chained currency OK, convergence 0/0 — the heal's own landing received the first live exact-tip receipt under the new receipt format.

Own-landing transient (SUBC-028 precedent): an executor session cannot flush its own landing — the engine lands this task's branch after execution, so the gate run plus checker on the landed tip run at landing time (or the next ahead-only heal), and a post-landing re-run of `--strict 50433302…` must still exit 0: descendant evidence is additive and the task's own landing only adds newer push-ok lines to the log.

## Deployed retire-after-archive verification: probe infeasible from execution sessions, drift watch armed — 2026-11-05 (SUBC-051)

**Decision: the deployed engine's cleanup-defaults-true status remains UNPROVEN and is recorded as PROBE-INFEASIBLE from a task-execution session — every task-creation channel is engine-refused while a board task executes, so the designed disposable-probe recipe cannot run from here; confirmation is explicitly left open.** All passive channels are consistent with a pre-patch deployed build and none individually proves one; upstream delivery is outstanding, so the delivery-state fact at probe time is PENDING-DELIVERY (patch absent upstream, operator handoff outstanding). This entry arms the zero-mutation drift watch, fixes the outcome-token grammar, and records a mechanical re-check recipe so the first capable session closes the question — it records no confirmation either way.

### Live evidence at execution (2026-11-05, worktree fusion/subc-051 at 9924a74, an ancestor of main)

- Repo currency: main == origin/main == `5d867ae6054c4e5afcaa98c15492d5862e0e527c`, `git rev-list --left-right --count main...origin/main` = 0/0 (planning-time baseline dfa517f had legitimately advanced: the SUBC-047 landing 9924a74, then a docs README renewal).
- Upstream delivery: `git ls-remote https://github.com/Runfusion/Fusion.git refs/heads/main` → `eb7eef49d5a0fe3e84e99be30e8ed9622a694e35` — exactly the tree the SUBC-037 bundle was authored against, not one commit past it. Targeted ls-remote for `refs/heads/subc-037`, `refs/tags/subc-037`, `refs/heads/retire-after-archive` → zero refs. The patch is NOT delivered upstream; the operator PR remains open.
- Deployed-version identity: the permitted best-effort attempt (`npm ls -g --depth=0`, allowlisted binary, no path literals) shows the global npm tree holds only @fission-ai/openspec, corepack, npm, playwright, pnpm — no fusion engine package; node v22.14.0. Outcome: NOT-DETERMINABLE as expected (host engine install boundary-restricted; mechanism 6 of the SUBC-037 entry is unchanged by this attempt).
- Passive drift indicators: `git branch --list fusion/subc-030` → present; `git tag --list rescue/fusion-subc-030` → absent (unchanged from planning). SUBC-030's log tail read via fn_task_show (fn_task_logs_read still carries no task_id parameter in executor sessions — the undeployed SUBC-036 engine patch): zero outcome tokens. Bounded historical scan of the three most recently archived tasks (SUBC-033, SUBC-034, SUBC-035, all archived in the same instant): each one's newest log line is the plain engine event "Task archived" — zero outcome tokens on any passive channel.

### Why the designed probe could not run (verbatim refusal ladder)

The probe recipe (below) needs exactly one disposable planning task. From this session every creation surface refused at call time, with identical engine policy text:

1. `fn_task_create(<probe brief>)` → refused: "fn_task_create is unavailable while executing a board task. Record out-of-scope findings as completion recommendations, and implement in-scope work directly in this task."
2. `fn_task_duplicate(id=SUBC-051)` → refused: "fn_task_duplicate is unavailable while executing a board task. Record out-of-scope findings as completion recommendations, and implement in-scope work directly in this task."
3. `fn_task_plan(<probe brief>)` → refused: "fn_task_plan is unavailable while executing a board task. Record out-of-scope findings as completion recommendations, and implement in-scope work directly in this task."

Issue/MR imports and `fn_task_refine` were evaluated and deliberately rejected: they would fabricate the probe out of real issue content or a false refinement lineage, violating the probe's own hygiene rule (never archive a real task as a probe). No honest channel to create a disposable planning task exists from a board-task session; no probe task and no probe branch were created, so there is no probe residue. Per the plan's own fallback matrix this classifies PROBE-INFEASIBLE — passive-channel evidence recorded, confirmation left open — never a fabricated confirmation.

### Outcome-token grammar (the SUBC-037 contract future archives are watched against)

| Token | Meaning |
|---|---|
| deleted-landed | tip proven landed (ancestry or bounded tree-equality) — branch deleted with no pin |
| deleted-pinned | unlanded tip gained a lightweight rescue/ pin verified at the exact sha BEFORE the branch ref disappeared |
| already-absent | branch did not exist — idempotent no-op |
| kept-operator | operator-provenance branch untouched |
| kept-held | worktree-held branch kept with NO pin |

### Drift-diagnosis protocol going forward

- Archive-time silence is the alarm: an archive of a task with a candidate fusion/ branch (existed, no worktree hold, fusion-deletable name) that produces NO outcome token while an outcome was possible is direct evidence of a pre-patch deployed build — readable from task logs alone, no host access. The flip side is equally diagnostic: a captured silence-plus-deletion where an outcome was possible proves the OLDER cleanup-defaults-true rule was already live before the patch (the audit lines are the new part).
- The fusion/subc-030 rescue-pin watch is the zero-mutation alarm: if a future run finds `rescue/fusion-subc-030` existing and `fusion/subc-030` gone with a deleted-pinned line on SUBC-030's log, that ALONE proves a patched engine is live (tip 8200629 is unlanded, so only the pin path fits).
- Passive absence is weak evidence: silent skip is also pre-patch behavior for held/operator/absent shapes, so token absence classifies drift only when an outcome was possible — anchor drift claims to a designed probe or to the pin watch, not to bare absence.

### Re-check recipe (mechanical; run from any session that can create tasks — an operator, a durable triage/planning agent, or a future engine change)

1. Record currency: full SHAs of main and origin/main plus the rev-list left/right count.
2. Probe upstream: `git ls-remote https://github.com/Runfusion/Fusion.git refs/heads/main`; record whether main moved past eb7eef4; targeted ls-remote for subc-037 / retire-after-archive refs; if main advanced, shallow-clone into scratch.local/fusion-upstream and grep the tree for branch-retire.ts and the five tokens.
3. Create ONE disposable planning task (no workflow, no work), create its canonical `fusion/<id>` branch at the current main tip, verify ancestry (`git merge-base --is-ancestor <tip> main`), archive the task, then read its task log AND the calling session's log for the five tokens, and check `git branch --list fusion/<id>`.
4. Classify: any captured outcome line → patched engine live, token names the exact outcome; branch gone with captured silence → pre-patch build already running the older silent cleanup; branch present with captured silence → pre-patch silent skip, re-check the passive indicators; creation channel refused again → remain PROBE-INFEASIBLE.
5. Append the new disposition to this log as one more docs-only commit, superseding this entry's disposition.

Owner: deploy verification — operator, until a captured probe outcome line lands; re-check — any future task or heartbeat session that can create tasks can rerun the recipe mechanically.

## Origin-ref retirement policy for closed-task remote branches — 2026-11-05 (SUBC-050)

**Decision: origin task branches (`refs/heads/fusion/*`) of CLOSED tasks are RETIRED by a standing operator-executed policy — the SUBC-019 one-off recipe generalized into the durable rule for this ref class: closure proof (task store and task artifact agree on a terminal state), Gate A/B provenance (squash-commit ancestry of `origin/main` OR bounded tree-equality against it), a rescue pin verified at the exact tip sha BEFORE the ref disappears, pre/post `ls-remote` snapshots, the single sanctioned `git push origin --delete <branch>` command, and an append-only decision-log record per retirement. Retention is rejected: it would contradict the repo convention that `fusion/*` task branches never live on origin (SUBC-007/SUBC-008 notes; restored by the SUBC-019 entry) and leave anomalous refs lingering indefinitely. The SUBC-037 engine non-goal ("local `refs/heads` only — remote refs are never touched (asserted in tests)", decision-log :940) is REAFFIRMED as final absent a separately approved contract amendment: no automation gains delete-capable remote credentials and the single-writer landing contract (only `refs/heads/main` is ever pushed, hardcoded single refspec + `assertMainRef`, agents.md :238-239) is unchanged. Local-only rescue pins are explicitly reconciled (SUBC-019/SUBC-038 precedent upheld): accepted WITHOUT a pushed tag, because the gates prove the branch content is already in `origin/main` history before any deletion, so the recorded recreate command (`git push origin rescue/<tag>:refs/heads/<branch>`) is sufficient for origin-side recovery; an origin branch carrying UNLANDED content is never deleted under this policy. The policy is decided and standing NOW; its recurring execution activates on first recurrence (live inventory: zero origin task branches today), and the engine-extends-to-origin question stays dormant behind the three-part re-evaluation trigger below. Owner: operator (founder).**

Premise verification (all live at execution 2026-11-05 ~11:45-11:55Z, worktree `subc-050` @ `dfa517f`, decision-log at 999 lines with SUBC-044 last; planner premises re-derived, not trusted):

| Check | Method (verbatim) | Result |
|---|---|---|
| Currency | `git rev-list --left-right --count origin/main...main` | `0\t0` — converged at `dfa517f` |
| Origin heads, BEFORE | `git ls-remote --heads origin` | exactly `refs/heads/main dfa517f02ea9f5547e36df0de6116aaa4ebb177a` — zero task branches; the class has exactly one historical member ever (`fusion/subc-011`, retired per the SUBC-019 entry :299) |
| Origin heads, AFTER | same command at delivery | byte-identical — this entry mutates no ref; origin stays exactly one branch |
| Origin tags | `git ls-remote --tags origin` | EMPTY — zero tags (the zero-tags state the pins reconciliation below preserves) |
| Local task branches | `git for-each-ref refs/heads/fusion/` | 8 branches (subc-012/016/030/041/047/049/050/051; several owned by open tasks) — local hygiene is SUBC-037/SUBC-039 territory, untouched here |
| Local rescue pins | `git for-each-ref refs/tags/rescue/` | 4 pins: `fusion-subc-006` `048acdc`, `fusion-subc-009` `5a47d3e`, `fusion-subc-011` `d6f932f`, `subc-023-old-main` `7bfab34` |
| Upstream main | `git ls-remote https://github.com/Runfusion/Fusion refs/heads/main` | `eb7eef49d5a0fe3e84e99be30e8ed9622a694e35` — EXACTLY the base the SUBC-037 patch bundle targets |
| Upstream heads | `git ls-remote --heads https://github.com/Runfusion/Fusion` | no `subc*`/`retire*` head exists (only assets/, dependabot/, feature/, fix/, identity/, main, release, staging) |
| Upstream file probe | raw.githubusercontent.com fetch @ `eb7eef4` into gitignored `scratch.local/fusion/`: `packages/core/src/task-store/task-mutation-ops.ts` + `packages/engine/src/executor/wire-executor-lifecycle.ts`, grepped for `branch-retire\|branchRetire\|retire\|rescue` | task-mutation-ops.ts: 2014 lines, `cleanupBranchForTaskImpl` at :1453, ZERO retire/rescue hits; wire-executor-lifecycle.ts: 962 lines, bare `execFileAsync("git", ["branch", "-D", …])` still at :205, ZERO retire/rescue hits — upstream is the pre-SUBC-037 baseline |
| Adoption verdict | — | **PENDING** — the description's "once adopted upstream" clause is an activation condition, not a blocker (SUBC-042 gated pattern); the patch bundle sits in SUBC-037 attachments and the operator owns the upstream PR |
| Sibling SUBC-037 | board | done — landed as squash `9df649f` |
| Sibling SUBC-039 | board | todo — agents.md branch-hygiene promotion UNLANDED; cited below in live state |
| Sibling SUBC-051 | board | todo (in planning, plan review running) — deployed-engine hook verification NOT started; deliberately not duplicated by this entry |
| Negative control | `grep -c "SUBC-050" docs/decision-log.md` | 0 before the edit — this entry is genuinely new |
| Dependency readiness | `NODE_ENV=development npm ci` via verification tool | exit 0 (16.1s); eslint/vite/tsc/vitest binaries confirmed in `node_modules/.bin` (npm repo per package-lock.json; the yarn-style `.modules.yaml` bootstrap marker does not apply to this repo) |
| Citation anchors | grep (live line numbers) | SUBC-019 :299 (decision paragraph :300-304; Gate A/B/C rows :322-324; recreate command :305-306; local-only pin :304/:329); SUBC-026 :450 (durable-policy paragraph :452-459; disposition classes RETIRE/DEFER/ACTIVE-KEEP/HANDOFF); SUBC-038 :806 (pin-never-pushed proof :827); SUBC-037 :918 (non-goal bullet :940; path-B delivery :953-961; owner line :964); SUBC-044 :966 (last entry) |

### Policy specification (binding on any origin-ref retirement)

1. **Scope.** Origin refs `refs/heads/fusion/<task>` — the repo's task-branch namespace (historically `fusion/subc-011`) — whose owning task is CLOSED: the task store and the task artifact AGREE on a terminal state (done/archived, or the SUBC-038 shape: store-absent with the artifact terminal and no superseding keep-decision). Never in scope: `refs/heads/main`, any `refs/tags/*`, `mission/*` refs, `refs/pull/*`, branches of open or paused-open tasks, and `ci-gate-probe/*` heads (those are governed by their own documented probe-cleanup procedure, agents.md :338-350, not this policy). Upstream contribution branches on Runfusion/Fusion are the upstream maintainers' cleanup concern and are explicitly out of scope for this repo's policy.
2. **Preconditions — every gate passes BEFORE any deletion.** G1 Closure proof: store+artifact closure agreement, evidenced in the record. G2 Provenance proof: Gate A — `git merge-base --is-ancestor <origin-tip> origin/main` → exit 0 — OR Gate B for the squash-merge shape — the squash commit is an ancestor of `origin/main` AND `git diff --quiet <origin-tip> <squash>` → exit 0 (bounded tree-equality, the decision-log Gate B evidence class). G3 Rescue pin verified at the exact tip sha BEFORE the ref disappears: lightweight tag `rescue/<branch-with-/--as-->` at the tip (SUBC-037 pin grammar, collision suffixes `-2`/`-3`, never overwrite), `git rev-parse '<tag>^{commit}'` → exact sha. G4 Snapshots: `git ls-remote --heads origin` + `git ls-remote --tags origin` before and after; the full-ref diff must show exactly the one removed head line and nothing else (SUBC-019 evidence shape).
3. **Mechanics.** Operator-executed only. The single sanctioned mutation is `git push origin --delete <branch>` — no force, no other refspec, no batch deletions, one branch per retirement. Every retirement is recorded as an append-only decision-log entry carrying the gate-evidence table and the recreate command `git push origin rescue/<tag>:refs/heads/<branch>` (SUBC-019 entry shape), and the owning task's disposition is recorded on its task log.
4. **Pins-never-pushed reconciliation.** Local-only rescue pins are ACCEPTED; a pushed rescue tag is NOT required. Rationale: G2 guarantees the branch content is already in `origin/main` history before any deletion, so origin-side recoverability of the CONTENT is carried by main itself; what the deletion removes from origin is only the branch's own pre-merge commit topology, which has zero operational value once the landing is proven; the recorded recreate command rebuilds the branch on origin from the local pin at any time; and pushing rescue tags would end the zero-tags origin state (live: zero tags) without adding recoverability the gates do not already cover — the SUBC-019 (:304/:329) and SUBC-038 (:827) precedent stands. Carve-out: an origin task branch carrying UNLANDED content is NEVER deleted under this policy — land it first, or push a rescue tag as an explicit operator exception recorded in the decision log. The gates make that case unreachable by default.
5. **Authority boundary.** No automation gains delete-capable remote credentials. The single-writer landing contract (only `refs/heads/main` ever pushed; hardcoded single refspec + `assertMainRef`, agents.md :238-239; the probe procedure's `git push origin --delete ci-gate-probe/<yyyymmdd>` at agents.md :350 remains the only other documented remote-delete command) is unchanged by this decision. The SUBC-037 engine non-goal is final for engine automation; the only path that changes it is a separately approved automation-credential contract amendment, which this decision explicitly does NOT route as work.
6. **Audit.** Every retirement — and any clause-4 exception — lands in docs/decision-log.md append-only with the gate evidence table and snapshots; the owning task's record (task log / task documents) carries the disposition. A retirement without its record violates this policy.

### Relationship to prior records

- **SUBC-037 entry ("Closed-task branch retirement shipped engine-side with automatic rescue pin — 2026-11-05", :918): REAFFIRMED, not superseded.** The engine's remote-ref exclusion stays final; this entry generalizes the OPERATOR recipe instead of extending the hook. If the three-part activation trigger ever fires, the supersession would happen in a future entry with its own contract amendment — never silently.
- **SUBC-019 entry ("Origin branch cleanup — 2026-11-04", :299): GENERALIZED into standing policy.** The executed one-off deletion (Gates A/B/C, local-only pin, recreate command, owner=founder) becomes the durable rule for the whole origin-task-branch class, with the same gates and the owner shifted to the standing operator role.
- **SUBC-039 (live status: todo, UNLANDED): sits BELOW this entry without conflict.** Its branch-hygiene policy scopes remote refs out of LOCAL hygiene sweeps; origin-ref retirement is a distinct operator recipe owned by this entry. When the SUBC-039 section lands in agents.md it should reference — not duplicate — this entry's recipe (see routing below).
- **SUBC-038 (:806): upheld and reconciled.** The pins-never-pushed convention is retained with the explicit rationale and the unlanded-content carve-out (clause 4), closing the question the SUBC-037/SUBC-038 records left open for remote refs.

### Activation condition and re-evaluation trigger

- The operator recipe is standing policy NOW and applies to any future origin task branch of a closed task; today's inventory is zero, so there is nothing to execute against — the policy is dormant only in the sense that its subject class is currently empty, not that it awaits a decision.
- The engine-extends-to-origin question (candidate B, rejected) is DORMANT behind a three-part trigger, ALL required: (a) upstream adoption of the retire-after-archive hook VERIFIED — upstream `main` containing the branch-retire implementation (this entry's probe method re-run) plus deployed-engine confirmation (SUBC-051-class evidence); (b) a recurrence pattern — at least 2 origin task-branch events in a rolling quarter (the class has recurred exactly once in repo history); (c) a separately approved automation-credential contract amendment. Any missing → the policy above stands as-is.
- A RETAIN-vs-retire reopen is triggered if origin task branches start arising routinely (e.g. a standing PR-rescue workflow is adopted), which would make retention-with-annotation worth re-evaluating against deletion.

### Follow-up routing

No follow-up task was created by this entry (Workflow-Executor sessions cannot create tasks; the creation tool is structurally withheld) and none is warranted as blocking work — the routing is stated explicitly:

- Engine-extends-to-origin hook extension (rejected candidate B): **NO ROUTE.** Owner: founder. Re-entry: the three-part activation trigger above; the contract amendment it needs is a separate operator decision, never a task-side change.
- Repo-local origin-retire script (rejected candidate C): **NO ROUTE.** The recorded 6-command operator recipe already proven by SUBC-019 suffices for a once-ever class; reopen under the same trigger if recurrences become routine.
- agents.md codification pointer: routed at this task's close as a completion recommendation (the only task-creation channel available to an executor session): when SUBC-039's branch-hygiene section lands, it should reference this entry's standing operator recipe for the origin-task-branch case (one clause plus a decision-log pointer) instead of duplicating it. Owner: operator; depends on SUBC-039 landing first.

### What was NOT done

No ref of any kind was mutated — no deletion, no rename, no push, no push-delete; no tag was created; no engine source, script, or agents.md line was touched (SUBC-039 owns the agents.md branch-hygiene section); no upstream fork, push, or PR was made against Runfusion/Fusion (SUBC-037 path-B boundary); no existing decision-log entry was modified, rewritten, or reordered — this entry is a pure append (negative control: `SUBC-050` count was 0 before the edit); the deployed-engine verification is SUBC-051's and was not started here. Scratch used for the upstream probe lives in gitignored `scratch.local/fusion/` and ships nothing.

Owner: operator (founder) — executes every operator-side part of this policy: the gates, the pin, the single sanctioned deletion, the recreate command, and the per-retirement decision-log record.

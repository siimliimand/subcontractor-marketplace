## 1. Shared lifecycle applier

- [x] 1.1 Refactor `src/worker/email/events.ts`: export `EmailLifecycleKind` and
  `applyEmailLifecycleEvent` with the transition matrix (`delivered` from `sent`;
  `opened` from `sent`/`delivered`; `bounced` from `sent`/`delivered`/`opened`),
  guarded in both the match query and the UPDATE where-clause, `RETURNING` gating all
  side effects; `handleEmailEventBatch` becomes the thin `source: "queue"` wrapper
  (behavior-preserving for existing tests)
- [x] 1.2 Idempotency and no-throw batch semantics: unmatched recipient or terminal
  state → silent no-op, no duplicate audit event, no duplicate suppression row;
  `source` added to audit payloads (additive — existing assertions use toMatchObject)
- [x] 1.3 Extend `test/email-queue.test.ts`: late-delivered-after-opened no-downgrade,
  bounce-after-delivered flips + suppresses, bounce-after-opened flips, unmatched
  recipient no-op, skipped/bounced terminal

## 2. Open pixel upgrade

- [x] 2.1 `GET /t/:file` batch adds a guarded `outreachEntries` UPDATE to `opened`
  (current status `sent`/`delivered`); bounced/skipped keep their status while the
  `email_opened` audit fact is still recorded
- [x] 2.2 Extend `test/email-journey.test.ts`: sent→opened, delivered→opened,
  bounced-stays-bounced-with-audit

## 3. Webhook receiver

- [x] 3.1 `src/worker/email/webhook.ts`: `POST /hooks/email-events`, constant-time
  bearer-secret auth (SHA-256 digest compare), fail-closed 401 when unset, single or
  array bodies, per-event isolation, 64KB cap, 400 on malformed JSON, `{accepted,
  skipped}` 202/200
- [x] 3.2 Route `/hooks/*` before the Access guard in `src/worker/index.ts`; add
  `EMAIL_EVENTS_WEBHOOK_SECRET` / `EMAIL_RESOLVE_AFTER_MINUTES` to `Bindings`; test
  secret in `vitest.config.ts`
- [x] 3.3 `test/email-webhook.test.ts`: 401 missing/wrong bearer, disabled-when-unset
  (direct handler invocation with stub env), delivered-via-SELF.fetch with
  `source: "webhook"`, array batch, duplicate replay no-op, unknown type skipped,
  malformed JSON 400, non-POST 404, no Access headers required

## 4. Inbound bounce Email Worker

- [x] 4.1 `src/worker/email/inbound.ts`: `parseDeliveryFailure` (RFC 3464, explicit
  failure indicators only, `Final-Recipient`/`X-Failed-Recipients`, 4.x temporary vs
  5.x permanent, auto-reply/human-mail → null) and `handleInboundEmail` (shared
  applier, `source: "inbound"`, never throws)
- [x] 4.2 `email()` handler on the default export: read `message.raw` capped at 256KB,
  parse, apply, one JSON log line on success; minimal structural message type keeps
  typecheck green
- [x] 4.3 `test/email-inbound.test.ts`: parser matrix (hard 5.1.1, soft 4.x,
  X-Failed-Recipients, auto-reply → null, human reply → null, no recipient → null) +
  integration (bounced + `hard_bounce` suppression + `source: "inbound"`)

## 5. Resolution sweep + cron cadence

- [x] 5.1 `src/worker/email/resolve.ts`: `resolveStaleSentEmails` selects
  `channel='email' AND emailStatus='sent' AND sentAt < now - window`, resolves to
  `delivered` with the inferred payload marker in one guarded `db.batch`; returns
  resolved ids; never touches skipped/bounced/opened/delivered/manual/null entries
- [x] 5.2 `runScheduledJobs(env, {now?})`: sweep every tick; hourly set (widening,
  retention, calendar) gates on minute 0; `scheduled()` passes
  `controller.scheduledTime`; one JSON log line when anything resolved;
  `wrangler.jsonc` crons → `*/5 * * * *`, `EMAIL_RESOLVE_AFTER_MINUTES: "10"` in both
  env vars blocks
- [x] 5.3 `test/email-resolution.test.ts`: stale→inferred-delivered, fresh untouched,
  bounced/skipped/manual/null untouched, idempotent re-run, late bounce after
  resolution, minute-0 vs minute-7 `runScheduledJobs` gating

## 6. Per-provider delivery metrics

- [x] 6.1 `GET /api/dashboard/email-delivery`: grouped query, dispatched-only
  denominator, `EXISTS` suppression flag, bounceRate (null when sent=0), `bounced DESC,
  sent DESC` ordering, totals + overall rate, `from`/`to` sentAt filters
- [x] 6.2 Dashboard "Email pipeline" section: compact per-provider table (Provider,
  Sent, Delivered, Opened, Bounced, Bounce rate, Skipped, Suppressed) with totals row
  and empty state
- [x] 6.3 `test/dashboard.test.ts`: empty database, row math (1.0 vs 0.0 bounceRate),
  skipped excluded from denominator, suppressed flag, ordering, totals, from/to
  filtering

## 7. Acceptance & documentation

- [x] 7.1 `test/email-delivery-symptom.test.ts`: reproduces the stuck-at-`sent`
  failure, then proves webhook / inbound DSN / pixel / sweep resolution paths and
  per-provider bounce rate — all without any Queue producer
- [x] 7.2 Full `npm test` green, `npm run typecheck` green, `npm run build` before
  tests (dist/ui prerequisite), no lint script exists (confirmed via `npm run`)
- [x] 7.3 README "Email pipeline" rewritten around the three-path design + setup
  (webhook secret + curl recipe, Email Routing bounce setup, resolution window, cron
  cadence); `docs/phase0/event-tracking-plan.md` lifecycle rows updated; openspec
  change folder + email-outreach spec delta; `.dev.vars.example` new settings

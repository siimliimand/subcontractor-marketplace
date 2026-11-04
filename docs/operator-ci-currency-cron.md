# Operator card: install the ci-currency publishing cron (*/10)

**Owner:** the operator, as the `fusion` user. The fusion user's crontab spool
denies agent identities by design (verified 2026-11-03 and re-verified
2026-11-05: `crontab -l` → `crontabs/fusion/: fopen: Permission denied`), so
this card is documentation the operator applies — an agent cannot perform it.
This card is the single canonical, self-contained entry point for the install;
follow it top-to-bottom.

## Purpose and current status (STILL DEAD as of 2026-11-05)

`scripts/push-main-when-ahead.mjs` is this repo's single sanctioned writer of
the mainline ref, driven by exactly three triggers: this */10 cron tick, the
agent landing-gate checklist (`agents.md` § "Auto-push on landing"), and
manual operator runs. The cron is the only **always-on** trigger — engine-side
squash landings happen outside any agent session, so without it every landing
sits unpublished on local main until a human or agent notices and flushes.

- **The cron has never fired since install.** Live probe 2026-11-05: the
  shared state directory `~/.local/state/ci-currency` holds only
  `auto-push.log` — `cron.log`, which the cron line's
  `>> … /cron.log 2>&1` redirect creates on any firing, is ABSENT. crond
  itself is active; the spool entry is simply not installed (diagnosed in
  SUBC-020, 2026-11-04).
- **Demonstrated recurring cost:** the SUBC-026 landing (`50433302`) and the
  SUBC-029 landing (`9a749b44`) both sat unpublished on local main until
  SUBC-031 manually ran `node scripts/push-main-when-ahead.mjs` on 2026-11-04
  (gate exit 0, Actions run #29 id 41907815753 green). Until this card is
  applied, every landing needs another manual flush session.

## Prerequisites

Run as the `fusion` user, in the primary checkout at
`/var/www/code.webuilder.dev/subcontractor-marketplace` (the cron line
hard-codes this path). Before starting, confirm:

- `gh` is authenticated as the `siimliimand` identity with token scopes
  `repo` and `workflow` (live 2026-11-04; check with `gh auth status`).
  Reference the auth state — never paste tokens anywhere.
- `crond` is active (`pgrep -x cron` or `systemctl is-active cron`).

The install block below performs the remaining setup itself: it wires the gh
credential helper as the git HTTPS transport, sets the HTTPS remote, creates
the runtime state directory, and installs the cron line.

## Install block (exact four commands)

Run these verbatim, in order:

```bash
gh auth setup-git
git remote set-url origin https://github.com/siimliimand/subcontractor-marketplace.git
mkdir -p ~/.local/state/ci-currency
( crontab -l 2>/dev/null; echo '*/10 * * * * cd /var/www/code.webuilder.dev/subcontractor-marketplace && /usr/local/bin/node scripts/push-main-when-ahead.mjs >> /home/fusion/.local/state/ci-currency/cron.log 2>&1' ) | crontab -
```

`/usr/local/bin/node` is deliberate: cron's default PATH lacks
`/usr/local/bin`, and `/usr/bin/node` does not exist on this host.

Note: the fourth command **appends** to the existing crontab (it reads
`crontab -l` and re-installs it plus the new line). If you ever re-run it,
remove the duplicate line first (`crontab -e`), or use the rollback command
below before re-applying.

## Post-install acceptance sequence (all four must pass)

1. **Spool check:** `crontab -l` shows exactly the new */10 line (once).
2. **Proof-of-fire:** within ~10 minutes, `~/.local/state/ci-currency/cron.log`
   exists and contains the first tick's output. The redirect creates it on the
   first firing, so its continued absence means the cron is still not firing —
   stop and investigate (`crontab -l` output, crond status) before merging
   anything.
3. **Noop evidence:** when local main is current, the tick appends a noop-ok
   line to `~/.local/state/ci-currency/auto-push.log` of the exact form
   `push-main-when-ahead: OK currency current (main == origin/main); nothing
   to push` (each log line carries an ISO timestamp prefix). After a landing
   the tick pushes instead and logs
   `push-main-when-ahead: OK main pushed and green (tip <40-hex sha>, run
   id=<digits>)`.
4. **Landing check:** on the next landing, run
   `node scripts/verify-landing-gate.mjs` (read-only; from the primary
   checkout or any linked fusion worktree) and require exit 0 within ~10
   minutes of the landing, printing a line of the form
   `verify-landing-gate: OK — landing gate verified for tip <12-hex> (<full
   sha>): evidence push-ok, run id=<id>, evidence ts=<iso>, committed <iso>;
   currency: verify-ci-currency: OK — …`.

## Drift / alert response

If `~/.local/state/ci-currency/alert` exists, or
`node scripts/verify-ci-currency.mjs` exits non-zero: create an urgent task
and merge NO further work onto `main` until currency is restored (local main
== origin/main == newest green Actions run). The alert file carries the
timestamp, reason, and the exact next manual action. Runtime state
(`auto-push.log`, `cron.log`, `alert`, `lock/`) lives under the fusion user's
`~/.local/state/ci-currency` — never inside the tracked tree. (Per
`agents.md` § "Auto-push on landing", "Drift response".)

## Rollback

```bash
crontab -l | grep -v push-main-when-ahead | crontab -
```

Then confirm `crontab -l` no longer shows the line. Rollback only stops the
scheduled publishing; landings then require the manual gate run per the
`agents.md` landing checklist ("Landing checklist (SUBC-028)").

## Re-apply after any host rebuild

The crontab does not survive a host rebuild. After any rebuild, re-run the
entire install block above (it includes the two transport commands and the
state-directory creation), then re-run the post-install acceptance sequence.

## References

- `agents.md` § "Auto-push on landing (SUBC-008, 2026-11-03)" — mechanism,
  landing gate, the numbered "Landing checklist (SUBC-028)", drift response,
  guarantees, and the single-writer landing contract; its scheduled-trigger
  bullet carries this card's in-repo agent-facing copy of the install block.
- `docs/decision-log.md` — "Operator cron re-issued — 2026-11-05 (SUBC-032)"
  (re-issue decision, live still-dead evidence, re-evaluation triggers);
  "Landing-push stall diagnosed and flushed — 2026-11-04 (SUBC-020)" (the
  original diagnosis and repair card — immutable history);
  "Landing-gate enforcement made checkable — 2026-11-05 (SUBC-028)" (the
  checker this card's acceptance step 4 uses).
- `scripts/verify-landing-gate.mjs` — the read-only landing-gate checker
  (usage: `node scripts/verify-landing-gate.mjs [--strict] [<tip sha>]`).

No credential material appears in this card, and none appears in any watchdog
output: every log/alert line is scrubbed of token material (`redactLogLine`)
before it is written. This card references `gh auth` state; it never contains
tokens.

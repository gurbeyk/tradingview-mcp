# Phase 2F.1 — Scheduled / CI-style Recurring Validation Decision

Date: 2026-09-04
Branch: `main`
Type: Design/decision only — no scheduler, no production behavior change.

## Verdict

**Do not run live TradingView/CDP validation in CI. Keep the Phase 2F.0
runner manual. Do not add a scheduler yet.** No real operator need for
recurring/unattended live runs has surfaced, and this repo has no
existing scheduler infrastructure to extend safely. Fixture-based
regression already exists in unit tests and should be the default lever
for "automated" going forward; live CDP evidence stays a manual,
point-in-time activity, same as the Phase 2D/2E/2F.0 precedent.

## What was inspected

- `docs/phase-2f0-live-validation-automation.md` — Phase 2F.0 explicitly
  deferred this decision and warned not to wire an always-on scheduler
  until it was made.
- `docs/phase-2e2-release-packaging-handoff.md` — states plainly that
  "No automated/scheduled regression exists for the live MCP-tool
  validations; all evidence to date is manually triggered and
  point-in-time," and lists that as an accepted, non-blocking gap, not
  an oversight.
- `docs/crr-hybrid-diagnostic-contract.md` — the frozen public contract;
  nothing in it depends on or anticipates a scheduler.
- `src/core/options/liveValidationAutomation.js` and
  `scripts/phase2f0-live-validation-automation.mjs` — pure helpers plus a
  one-shot script. No timers, no retry loop, no persistence beyond
  writing one evidence JSON file per invocation. The script's own header
  comment says: "This is intentionally a manual runner for now: it does
  not schedule itself."
- `package.json` — `phase2f0:live-validation` is a plain `node script.mjs`
  invocation, no `nodemon`/`cron`/`pm2`/scheduler dependency anywhere in
  `dependencies` or `devDependencies`.
- `.github/workflows/ci.yml` — the only workflow in the repo. Runs on
  `push`/`pull_request` to `main`, does `npm ci` → `npm run lint` →
  `npm run test:unit` → `npm audit` (non-blocking). The unit-test step's
  own inline comment already states the operating assumption: *"test:unit
  excludes e2e.test.js, which needs a live TradingView Desktop + CDP."*
  There is no `schedule:` trigger, no self-hosted runner, and no step
  that could reach a CDP endpoint (GitHub-hosted `ubuntu-latest` runners
  have no TradingView Desktop and no route to `localhost:9222` on a
  developer machine).
- Repo-wide search for `.github/workflows`, `setInterval`, `setTimeout`
  used as a scheduler, and `cron` turned up **nothing** beyond the single
  CI workflow above. This repository does not carry the in-process
  scheduler pattern seen in other projects — there is no existing
  pattern to extend, so building one now would be new infrastructure,
  not a small addition.
- `tests/live_validation_automation.test.js` — unit-tests the pure
  helpers (`buildSpotAwareValidationRequest`, `summarizeAnalysisPacket`,
  `evaluateLiveValidationSummary`, `aggregateLiveValidationResults`)
  against synthetic packets. This is already the fixture-based
  regression layer for Phase 2F.0's logic; it runs in CI today via
  `test:unit`.

## Should live TradingView/CDP validation run in CI?

**No.** GitHub-hosted CI runners cannot reach a real TradingView Desktop
instance over CDP — there is no display, no licensed desktop app, and no
port 9222 to connect to. Attempting this would require either a
self-hosted runner with a persistently logged-in TradingView Desktop
session (a new, non-trivial infrastructure and credential-management
commitment) or a mocked CDP layer (which would stop being "live
validation" and become another fixture test — already covered below).
Nothing in the current codebase or docs asks for this, and it would
contradict the "live validation should fail loudly, not be faked"
principle stated in Phase 2F.0's Operational Notes.

## Should the live validation runner remain manual?

**Yes.** This matches the precedent set across Phase 2D.1/2D.4–2D.6 and
Phase 2F.0 itself: every live CDP validation to date has been operator-
triggered and point-in-time, and every handoff doc treats that as an
accepted design choice, not a gap to close reflexively. `npm run
phase2f0:live-validation` stays as-is.

## Should we add a default-off local scheduler?

**Not now.** A default-off local scheduler (e.g., an opt-in
`setInterval`-based loop or a documented `cron`/`launchd` recipe wrapping
the existing manual command) would be a reasonable *future* addition,
but two things argue against building it in this phase:

1. There is no existing scheduler pattern in this repo to extend — this
   would be new infrastructure, and the task instructions are explicit
   that new infra should only be built when a repo pattern makes a tiny,
   default-off design obviously appropriate. It doesn't here.
2. There is no stated operator need yet (no on-call rotation, no
   dashboard consuming recurring evidence, no SLA on data freshness).
   Building a scheduler ahead of that need risks unattended CDP sessions
   against a real trading desktop with no consumer for the output.

If a real need emerges (e.g., "detect when TradingView's option chain
shape silently changes overnight"), the right shape is documented above
as the fallback: a small, default-off, opt-in wrapper script around the
existing manual runner — not a new service.

## Should we add fixture-based regression to CI/unit tests?

**Already present; keep it as the primary automated lever.**
`tests/live_validation_automation.test.js` unit-tests the Phase 2F.0
helpers against synthetic packets and already runs on every push/PR via
`test:unit` → CI. The captured live evidence file
(`docs/fixtures/phase2f0-live-validation-automation-20260904/...json`)
is a good candidate for a *future* fixture-replay test (feed the frozen
JSON through `summarizeAnalysisPacket`/`evaluateLiveValidationSummary`
and assert the recorded acceptance outcome), which would harden
regression coverage without touching CDP at all. That is a small,
additive test-only change and the most likely shape of "Phase 2F.2" —
see recommendation below.

## What should be automated now vs. later?

| Now (already true) | Later (only if a need appears) |
|---|---|
| Unit tests for the pure helpers run in CI | Fixture-replay test asserting exact acceptance/aggregate output against the frozen 2026-09-04 evidence JSON |
| Lint runs in CI | A default-off local scheduler wrapping `phase2f0:live-validation` |
| Manual `npm run phase2f0:live-validation` for live evidence | A self-hosted CI runner with real TradingView Desktop access (only if live-in-CI becomes a hard requirement) |

## Failure modes

- **CDP unreachable / TradingView not running:** already handled —
  `runOneSafe` in the script catches per-run errors, records
  `diagnostics_status: 'ERROR'`, and the process exits non-zero. This is
  correct manual-runner behavior and needs no change.
- **Silent staleness:** because the runner is manual, evidence can go
  stale (last run 2026-09-04) without anyone noticing, since nothing
  currently alerts on "it's been N days since the last live run." This
  is the main argument *for* a future scheduler/reminder, but it is a
  low-severity gap today (no downstream consumer depends on freshness).
- **Unattended live runs against a real trading desktop:** the risk a
  scheduler would introduce — a runaway or mis-scheduled job could hit
  the live TradingView Desktop session repeatedly and unexpectedly
  (rate/UI contention, unwanted screenshots/state changes). This is the
  core reason to keep the runner manual until there's a concrete need
  that justifies managing that risk.
- **CI drift from live reality:** fixture-based regression, by design,
  freezes a point-in-time packet shape. If `analyzeDirectional`'s output
  contract changes in a way current fixtures don't exercise, fixture
  tests won't catch it until a fixture is refreshed. Mitigated by the
  existing contract tests in `tests/directional_analysis.test.js`
  (shape/type-precise, not fixture-dependent) and by periodically
  refreshing the manual live run.

## Environment variables / operator steps (status quo, unchanged)

To run live validation manually, an operator needs:

```bash
PHASE2F_SYMBOLS=NASDAQ:NVDA,NASDAQ:AAPL,NASDAQ:PANW   # optional, has default
PHASE2F_PROFILES=BULLISH_BASELINE_30D,BEARISH_ELIGIBLE_60_90D  # optional, has default
PHASE2F_OUTPUT_DIR=docs/fixtures/custom-output-dir     # optional, has default
```

Plus, out-of-band: TradingView Desktop running and reachable over CDP on
`localhost:9222` (`tv_launch`/`tv_health_check` via the MCP tools, or
manually). No new environment variables or operator steps are introduced
by this decision — it deliberately changes nothing about how the runner
is invoked.

## Recommended next implementation phase

**Phase 2F.2 — Fixture regression hardening.** Add a fixture-replay unit
test that loads the frozen 2026-09-04 evidence JSON and asserts
`summarizeAnalysisPacket`/`evaluateLiveValidationSummary`/
`aggregateLiveValidationResults` reproduce the recorded
passed/failed/decision-state/diagnostics-status numbers exactly. This is
test-only, requires no live CDP access, runs in existing CI, and
directly strengthens confidence in the Phase 2F.0 helpers without
building any new scheduler infrastructure. Revisit a default-off local
scheduler only if a concrete operator need for recurring live evidence
appears later.

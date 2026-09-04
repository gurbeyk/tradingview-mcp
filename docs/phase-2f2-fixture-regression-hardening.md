# Phase 2F.2 — Fixture Regression Hardening

Date: 2026-09-04
Branch: `phase-2f2-fixture-regression-hardening`

## Verdict

**Fixture regression coverage added.** The Phase 2F.0 live smoke evidence
(2026-09-04) is now locked as a frozen, CI-safe test fixture and replayed
through the same pure helpers (`summarizeAnalysisPacket`,
`evaluateLiveValidationSummary`, `aggregateLiveValidationResults`) that
the live runner uses. This follows directly from Phase 2F.1's decision to
strengthen fixture-based regression instead of running live CDP
validation in CI or adding a scheduler. No production behavior, pricing,
ranking, confidence, or eligibility logic was touched.

## What fixture is locked

`tests/fixtures/phase2f0-live-validation-2026-09-04.json` — a trimmed
copy of `docs/fixtures/phase2f0-live-validation-automation-20260904/phase2f0-live-validation-automation.json`.

The trimmed copy keeps `phase`, `status`, timestamps, `symbols`,
`profiles`, `aggregate`, and per-run `symbol`/`profile_id`/`summary`/
`acceptance`. It drops the per-run `request` and full `packet` objects
(the original analysis packets), which are not needed for regression
assertions and would otherwise blow up the fixture from ~27 KB to
~387 KB. The original, untrimmed evidence file is left in place under
`docs/fixtures/` as the canonical record of the live run; the test
fixture is a derived, purpose-built subset of it, not a replacement.

## What the regression test covers

Added to `tests/live_validation_automation.test.js`, under
`describe('Phase 2F.2 — frozen live-validation fixture regression', ...)`:

- Aggregate counts: `total_runs === 6`, `passed_runs === 6`,
  `failed_runs === 0`.
- Every run has `diagnostics_status === 'AVAILABLE'` and
  `diagnostics_mode === 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE'`.
- No run's `market_input_modes` includes `FULL_EXTERNAL_INPUTS`; every
  run has borrow explicitly unavailable (`BORROW_DATA_UNAVAILABLE`
  warning or `NOT_CONNECTED` borrow source).
- Both profiles (`BULLISH_BASELINE_30D`, `BEARISH_ELIGIBLE_60_90D`) and
  all three symbols (`NASDAQ:NVDA`, `NASDAQ:AAPL`, `NASDAQ:PANW`) are
  present in the fixture.
- At least one bearish run reached `TRADE_CANDIDATES_AVAILABLE`.
- Bearish AAPL's surfaced/top-5 strategy types include `LONG_PUT`
  (guarded so the assertion only fires if strategy types are present at
  all, per the task's "if represented in the evidence" condition — the
  fixture does include it, so this assertion is live, not skipped).
- Every stored `summary` is re-evaluated through
  `evaluateLiveValidationSummary()` and must (a) pass, and (b) produce
  the exact same `passed`/`failed` result as the value recorded at
  capture time.
- All stored runs are re-aggregated through
  `aggregateLiveValidationResults()` and the result must deep-equal the
  recorded `aggregate` object exactly.

8 new tests total. Full suite: 357/357 passing (up from 349).

## What it intentionally does not cover

- **No live TradingView/CDP/MCP/network calls.** The test only reads a
  local JSON file and calls pure, already-unit-tested helper functions.
- **No re-derivation of the original analysis packets.** The trimmed
  fixture doesn't carry `top_candidates`/`near_miss_candidates`/full
  `diagnostics.crr_hybrid_policy` detail, so this test cannot catch a
  regression in `analyzeDirectional()`'s packet shape itself — that is
  already covered separately by the shape/type-precise tests in
  `tests/directional_analysis.test.js`, which don't depend on this
  fixture.
- **No freshness/staleness check.** This test will keep passing
  indefinitely even if the live evidence is never refreshed again — it
  locks a point-in-time result, it doesn't assert recency. Freshness
  monitoring, if ever needed, is a separate (currently unplanned)
  concern per Phase 2F.1.
- **No scheduler, no CI workflow change.** `tests/live_validation_automation.test.js`
  was already part of `npm run test:unit`, which already runs in
  `.github/workflows/ci.yml` on every push/PR to `main` — no `package.json`
  or workflow changes were needed or made.

## Why this is CI-safe

- The fixture is a static file checked into the repo; no network, no
  CDP, no external service, no environment variable is required to read
  it.
- The helpers under test (`summarizeAnalysisPacket`,
  `evaluateLiveValidationSummary`, `aggregateLiveValidationResults`) are
  pure functions with no I/O — same helpers already exercised by the
  synthetic-packet tests earlier in the same file.
- Runtime cost is negligible (parsing a 27 KB JSON file plus a handful of
  array/object comparisons); it adds no meaningful time to `test:unit`.
- Nothing about this test can fail due to live market conditions,
  TradingView Desktop availability, or CDP connectivity — it will
  produce the identical result on every run, on every machine, forever
  (until the fixture file itself is deliberately changed).

## Validation results

- `npm run test:unit`: **357/357 pass** (up from 349; +8 new fixture
  regression tests, 0 regressions elsewhere).
- `npm run lint`: **0 errors**, 9 pre-existing warnings, unchanged from
  before this phase (lint targets `src/` only; no `src/` files were
  touched in this phase).

## Next recommended phase

No further recurring-validation automation work is currently justified.
Revisit only if:

- A concrete operator need for recurring live evidence emerges (per
  Phase 2F.1's stated bar), at which point a default-off local scheduler
  wrapping `npm run phase2f0:live-validation` is the documented fallback
  design; or
- `analyzeDirectional()`'s packet contract changes in a way this fixture
  doesn't exercise, at which point refresh the live evidence
  (`npm run phase2f0:live-validation`), regenerate the trimmed test
  fixture, and update this doc's "what it intentionally does not cover"
  section if the untrimmed fixture's shape changes.

Otherwise, the Phase 2F line (live validation automation → recurring
validation decision → fixture regression hardening) is complete as
scoped.

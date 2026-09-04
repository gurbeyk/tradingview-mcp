# Phase 2F.0 — Live Validation Automation

Date: 2026-09-04
Branch: `phase-2f-live-validation-automation`

## Verdict

**Initial live-validation automation is implemented.**

This phase converts the manual Phase 2D live-validation pattern into a
reusable runner and unit-tested summary/acceptance helpers. It does not add a
background scheduler and does not change production analysis behavior.

## What Changed

Added:

- `src/core/options/liveValidationAutomation.js`
- `scripts/phase2f0-live-validation-automation.mjs`
- `tests/live_validation_automation.test.js`

Updated:

- `package.json`

New command:

```bash
npm run phase2f0:live-validation
```

The command runs the default validation matrix:

- symbols: `NASDAQ:NVDA`, `NASDAQ:AAPL`, `NASDAQ:PANW`
- profiles:
  - `BULLISH_BASELINE_30D`
  - `BEARISH_ELIGIBLE_60_90D`

It writes raw evidence under:

```text
docs/fixtures/phase2f0-live-validation-automation-YYYYMMDD/
```

## Profiles

`BULLISH_BASELINE_30D`

- direction: bullish
- horizon: 30 days
- max loss: 1000
- base target: 5% above live spot
- explicit IV shocks: 0/0/0
- `include_crr_hybrid_diagnostics: true`

`BEARISH_ELIGIBLE_60_90D`

- direction: bearish
- horizon: 30 days
- max loss: 2500
- DTE window: 60-90
- base target: 8% below live spot
- explicit IV shocks: 0/0/0
- `include_crr_hybrid_diagnostics: true`

The bearish profile intentionally carries forward the Phase 2D.6 lesson:
30-day horizon with shorter expirations structurally triggers
`LARGE_TIME_STEP`, so 60-90 DTE is the cleaner coverage profile for default
confidence gates.

## Acceptance Checks

Each run is summarized and checked for:

- completed analysis packet
- `diagnostics.crr_hybrid_policy.status === AVAILABLE`
- `diagnostics.crr_hybrid_policy.mode === DIAGNOSTIC_ONLY_NO_RANKING_CHANGE`
- no `FULL_EXTERNAL_INPUTS` market-input mode
- borrow explicitly unavailable (`BORROW_DATA_UNAVAILABLE` or `NOT_CONNECTED`)
- ranking remains `RANKING_MODEL_V1`

These are CRR diagnostic release gates only. They are not trade-quality tests.

## Not Changed

This phase does not:

- schedule live validations
- launch TradingView
- alter MCP server behavior
- alter `options_analyze_directional`
- change scoring, confidence, eligibility, or recommendations
- exercise `FULL_EXTERNAL_INPUTS`
- introduce IBKR as a required dependency

## Configuration

Environment variables:

```bash
PHASE2F_SYMBOLS=NASDAQ:NVDA,NASDAQ:AAPL,NASDAQ:PANW
PHASE2F_PROFILES=BULLISH_BASELINE_30D,BEARISH_ELIGIBLE_60_90D
PHASE2F_OUTPUT_DIR=docs/fixtures/custom-output-dir
```

## Operational Notes

The runner requires the normal TradingView data path to be available. If CDP is
down or TradingView is not running with debug access enabled, the command will
record failed runs and exit non-zero rather than silently fabricating live
evidence. Other symbols/profiles in the same matrix are still attempted so the
evidence file preserves partial progress.

This is deliberate: live validation should fail loudly when market data cannot
be reached.

## Recommended Next Step

Proceed to **Phase 2F.1 — Live Validation Scheduler Design**, only if recurring
validation is still desired.

Phase 2F.1 should decide whether this repo needs:

- manual-only evidence runs
- a local scheduled command
- CI-like fixture validation only
- or a hybrid approach where live MCP/CDP validation remains operator-triggered

Do not wire an always-on scheduler until that decision is made.

## Live Smoke Validation — 2026-09-04

**Command run:**

```bash
npm run phase2f0:live-validation
```

**Evidence path:**

```text
docs/fixtures/phase2f0-live-validation-automation-20260904/phase2f0-live-validation-automation.json
```

This was a live run against a running TradingView Desktop instance over CDP
(port 9222), covering the default matrix (`NASDAQ:NVDA`, `NASDAQ:AAPL`,
`NASDAQ:PANW` × `BULLISH_BASELINE_30D`, `BEARISH_ELIGIBLE_60_90D`).

**Aggregate results:**

- total runs: 6
- passed runs: 6
- failed runs: 0
- decision-state distribution:
  - `NO_TRADE_BASELINE_ONLY`: 4
  - `TRADE_CANDIDATES_AVAILABLE`: 2
- diagnostics status: `AVAILABLE` on all 6 runs
- market-input mode: `PARTIAL_EXTERNAL_INPUTS` on all 6 runs

**Bullish profile (`BULLISH_BASELINE_30D`) results:**

| Symbol | Decision state | Top candidate type |
|---|---|---|
| NASDAQ:NVDA | NO_TRADE_BASELINE_ONLY | BULL_CALL_SPREAD (top5) |
| NASDAQ:AAPL | NO_TRADE_BASELINE_ONLY | BULL_CALL_SPREAD (top5) |
| NASDAQ:PANW | NO_TRADE_BASELINE_ONLY | BUY_STOCK (top5) |

All three bullish runs landed on `NO_TRADE_BASELINE_ONLY` — no eligible trade
candidate cleared the consideration gates under the assumed scenario, so the
baseline was correctly preserved.

**Bearish profile (`BEARISH_ELIGIBLE_60_90D`) results:**

| Symbol | Decision state | Top trade candidate |
|---|---|---|
| NASDAQ:NVDA | TRADE_CANDIDATES_AVAILABLE | BEAR_PUT_SPREAD |
| NASDAQ:AAPL | TRADE_CANDIDATES_AVAILABLE | BEAR_PUT_SPREAD (top1), LONG_PUT in top5 |
| NASDAQ:PANW | NO_TRADE_BASELINE_ONLY | BEAR_PUT_SPREAD (top5, not eligible) |

Bearish NVDA and AAPL reached `TRADE_CANDIDATES_AVAILABLE`, confirming the
60-90 DTE window avoids the Phase 2D.6 `LARGE_TIME_STEP` trap for this
direction. Bearish AAPL's top-5 also surfaced a `LONG_PUT` candidate alongside
the spread, showing candidate-type diversity survives ranking.

**Caveats:**

- This is a point-in-time live TradingView/CDP validation run, not a
  regression suite — results reflect market conditions and option chains at
  the moment of the run and are not expected to reproduce exactly on a later
  run.
- All 6 runs used `PARTIAL_EXTERNAL_INPUTS`; no run exercised
  `FULL_EXTERNAL_INPUTS` or the associated HIGH-confidence path.
- This smoke run does not replace a scheduled or CI-style regression job —
  Phase 2F.1 still needs to decide whether/how recurring validation runs.
- No source code changes were required; the runner and helpers built in
  Phase 2F.0 behaved as designed against live data.

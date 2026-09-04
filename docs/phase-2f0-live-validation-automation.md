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

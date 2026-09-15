# Phase 3C — `user_explanation_summary` Live Smoke Evidence

## Environment

- Branch: `phase-3c-user-summary-live-smoke` (cut from `main` @ `4b018d1`)
- Fork remote: `fork` → `https://github.com/gurbeyk/tradingview-mcp.git` (no changes made to `origin/tradesdontlie`)
- TradingView Desktop launched via `tv_launch` (CDP port 9222); `tv_health_check` confirmed `cdp_connected: true`, `api_available: true` before running analyses
- Tool used: `mcp__tradingview__options_analyze_directional` (live MCP tool boundary, not a unit-test mock)
- Date: 2026-09-15

## Purpose

Verify that `user_explanation_summary` (added in Phase 3B) is present, versioned, and internally
consistent with the rest of the `options_analyze_directional` packet when invoked through the real
MCP/tool path against live TradingView data — not just in the unit-test suite. Docs/evidence only;
no `src/` or `tests/` changes were required or made.

## Scenario A — NO_TRADE_BASELINE_ONLY (NASDAQ:ONDS, bullish)

**Parameters:**
- `symbol`: `NASDAQ:ONDS`
- `direction`: `bullish`
- `horizon_days`: `30`
- `max_loss`: `1000`
- `base_target_price`: `7.60` (spot at call time: `7.2427`, ≈ +5%)
- `include_crr_hybrid_diagnostics`: `true`

**Result:**
- `ranking.decision_state`: `NO_TRADE_BASELINE_ONLY`
- `user_explanation_summary.headline_status`: `NO_ELIGIBLE_OPTIONS`
- `eligible_candidate_count`: `0`
- `top_eligible_candidate_id`: `null`
- `near_miss_count`: `5`
- `low_confidence_candidate_count`: `4`
- `crr_summary`: `{ requested: true, status: "AVAILABLE", interpretation: "EVIDENCE_ONLY_NO_RANKING_EFFECT" }`

Raw JSON: `docs/fixtures/phase3c-user-summary-live-smoke-20260915/scenario_a_ONDS_bullish.json`

## Scenario B — TRADE_CANDIDATES_AVAILABLE (NASDAQ:AAPL, bullish)

**Parameters:**
- `symbol`: `NASDAQ:AAPL`
- `direction`: `bullish`
- `horizon_days`: `45`
- `max_loss`: `1000`
- `base_target_price`: `347` (spot at call time: `329.97`, ≈ +5.16%)
- `include_crr_hybrid_diagnostics`: `true`

No re-parameterization was needed — this run returned eligible candidates on the first attempt.

**Result:**
- `ranking.decision_state`: `TRADE_CANDIDATES_AVAILABLE`
- `user_explanation_summary.headline_status`: `ELIGIBLE_CANDIDATES_AVAILABLE`
- `eligible_candidate_count`: `2`
- `top_eligible_candidate_id`: `BULL_CALL_SPREAD::NASDAQ:AAPL::2026-10-30::OPRA:AAPL261030C335.0::OPRA:AAPL261030C350.0::conservative`
- `near_miss_count`: `0`
- `low_confidence_candidate_count`: `5`
- `crr_summary`: `{ requested: true, status: "AVAILABLE", interpretation: "EVIDENCE_ONLY_NO_RANKING_EFFECT" }`

Raw JSON: `docs/fixtures/phase3c-user-summary-live-smoke-20260915/scenario_b_AAPL_bullish.json`

## Checklist (both scenarios)

| Check | A (ONDS) | B (AAPL) |
|---|---|---|
| `user_explanation_summary` present | PASS | PASS |
| `version == OPTIONS_ANALYSIS_USER_SUMMARY_V1` | PASS | PASS |
| `decision_state` == `ranking.decision_state` | PASS (`NO_TRADE_BASELINE_ONLY` == `NO_TRADE_BASELINE_ONLY`) | PASS (`TRADE_CANDIDATES_AVAILABLE` == `TRADE_CANDIDATES_AVAILABLE`) |
| `headline_status` consistent with `decision_state` | PASS (`NO_ELIGIBLE_OPTIONS`) | PASS (`ELIGIBLE_CANDIDATES_AVAILABLE`) |
| `eligible_candidate_count` / `top_eligible_candidate_id` consistent with packet | PASS (0 eligible in `top_candidates`, id `null`, matches `ranking.top_trade_candidate_id`) | PASS (2 eligible in `top_candidates`, id matches `ranking.top_trade_candidate_id`) |
| `low_confidence_candidate_count` consistent with packet | PASS (4 LOW-confidence across `top_candidates` + `near_miss_candidates`, matches summary) | PASS (5 LOW-confidence in `top_candidates`, matches summary) |
| `crr_summary` does not present CRR diagnostic as a recommendation | PASS (`interpretation: EVIDENCE_ONLY_NO_RANKING_EFFECT` in both) | PASS |
| `assumption_notes` carries IV-unchanged note when `IV_SCENARIO_NOT_SPECIFIED` applies | PASS (present, no IV shocks were supplied) | PASS (present, no IV shocks were supplied) |
| `safety_notes` avoids investment-advice language | PASS (score/delta disclaimers, no "buy"/"recommend" language) | PASS |
| `ranking` / `top_candidates` / `diagnostics.crr_hybrid_policy` contract unchanged | PASS (all fields present, structurally identical to Phase 3A/3B contract) | PASS |

## Caveats

- This is a **point-in-time live smoke test**, not a regression suite — it does not replace `npm run test:unit`.
- Both runs used `EVIDENCE_ONLY_NO_RANKING_EFFECT` CRR status (`AVAILABLE`); the CRR
  `FULL_EXTERNAL_INPUTS` / `HIGH` confidence path was **not** exercised in this smoke test.
- Market/options data reflects live TradingView state at capture time (2026-09-15) and is not
  reproducible bit-for-bit on a later run.

## Validation

- `npm run test:unit`: 377/377 pass
- `npm run lint`: 0 errors, 9 pre-existing warnings (unchanged from baseline)
- Only `docs/fixtures/**` and this report were added — no `src/` or `tests/` changes.

## Verdict

**PASS.** `user_explanation_summary` is present, correctly versioned
(`OPTIONS_ANALYSIS_USER_SUMMARY_V1`), and fully consistent with `ranking`, `top_candidates`,
`near_miss_candidates`, and `diagnostics.crr_hybrid_policy` in both the `NO_TRADE_BASELINE_ONLY`
and `TRADE_CANDIDATES_AVAILABLE` decision states, verified through the real MCP tool boundary
against live TradingView data.

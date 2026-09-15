# Phase 3D — Live Formatter Smoke Evidence

## Environment

- Branch: `phase-3d-live-formatter-smoke-evidence` (cut from `main` @ `89e2592`)
- Fork remote: `fork` → `https://github.com/gurbeyk/tradingview-mcp.git` (no changes made to `origin/tradesdontlie`)
- Tool used: `mcp__tradingview__options_analyze_directional` (live MCP tool boundary against TradingView Desktop over CDP), piped into `formatOptionsAnalysisForUser` (`src/core/options/optionsAnalysisFormatter.js`, Phase 3D)
- Date: 2026-09-15

## Purpose

Verify `formatOptionsAnalysisForUser(packet, { locale: "tr", maxCandidates: 3 })` against real
`options_analyze_directional` output, for both `NO_TRADE_BASELINE_ONLY` and
`TRADE_CANDIDATES_AVAILABLE` decision states, and archive the raw packets + formatter output as
evidence. Docs/fixtures only — no `src/` or `tests/` changes were required or made.

## Scenario A — NO_TRADE_BASELINE_ONLY (NASDAQ:AAPL, bullish)

**Parameters:**
- `symbol`: `NASDAQ:AAPL`, `direction`: `bullish`, `horizon_days`: `45`, `max_loss`: `1500`
- `base_target_price`: `348` (spot at call time: `331.34`, ≈ +5.03%)
- `include_crr_hybrid_diagnostics`: `true`
- `downside_iv_change_points` / `base_iv_change_points` / `upside_iv_change_points`: all explicit `0`

**Result:**
- `ranking.decision_state`: `NO_TRADE_BASELINE_ONLY`
- `user_explanation_summary.headline_status`: `NO_ELIGIBLE_OPTIONS`
- `eligible_candidate_count`: `0`, `near_miss_count`: `5`, `low_confidence_candidate_count`: `13`
- `diagnostics.crr_hybrid_policy.status`: `AVAILABLE`
- `data_source.warnings`: `[]` (IV shocks were explicit, so `IV_SCENARIO_NOT_SPECIFIED` correctly did not fire)

Fixtures:
- `docs/fixtures/phase3d-formatter-live-smoke-20260915/scenario_a_aapl_no_trade_packet.json`
- `docs/fixtures/phase3d-formatter-live-smoke-20260915/scenario_a_aapl_no_trade_formatted.json`

### Scenario A checklist

| Check | Result |
|---|---|
| `formatted.version == OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1` | PASS |
| `formatted.locale == "tr"` | PASS |
| `sections` present and every section has ≥1 line | PASS |
| `safety.numeric_source_of_truth == packet.ai_contract.numeric_source_of_truth` | PASS (`THIS_ANALYSIS_PACKET`) |
| `safety.allowed_candidate_ids_checked === true` | PASS |
| `safety.contains_investment_advice_language === false` | PASS |
| Every rendered `candidate_id` ∈ `ai_contract.allowed_candidate_ids` | PASS (3 near-miss ids checked) |
| Near-miss candidates framed as "why eliminated," not a recommendation | PASS (`consideration_reasons` such as `CONFIDENCE_BELOW_THRESHOLD`, `SCORE_BELOW_THRESHOLD`, no recommendation language) |
| LOW confidence explicitly stated | PASS ("13 aday LOW güven seviyesindedir...") |
| CRR evidence-only / no-ranking-effect language present | PASS ("CRR hibrit tanı verisi yalnızca kanıt amaçlıdır...") |
| Score/delta not framed as probability | PASS (both disclaimers present) |
| IV note correctness | PASS — no `IV_SCENARIO_NOT_SPECIFIED` warning on the packet, and the formatter correctly omitted the IV-unchanged note |
| No forbidden investment-advice wording (TR/EN wordlist) | PASS |

## Scenario B — TRADE_CANDIDATES_AVAILABLE (NASDAQ:AAPL, bullish)

**Parameters:**
- `symbol`: `NASDAQ:AAPL`, `direction`: `bullish`, `horizon_days`: `30`, `max_loss`: `2500`
- `base_target_price`: `351` (spot at call time: `331.34`, ≈ +5.93%)
- `include_crr_hybrid_diagnostics`: `true`
- IV shocks explicit `0`

No threshold relaxation was needed — **this run returned `TRADE_CANDIDATES_AVAILABLE` on the
first attempt** (1 of the allotted 4).

**Result:**
- `ranking.decision_state`: `TRADE_CANDIDATES_AVAILABLE`
- `ranking.top_trade_candidate_id`: `BULL_CALL_SPREAD::NASDAQ:AAPL::2026-11-20::OPRA:AAPL261120C335.0::OPRA:AAPL261120C350.0::conservative`
- `eligible_candidate_count`: `3`, `low_confidence_candidate_count`: `7`
- `diagnostics.crr_hybrid_policy.status`: `AVAILABLE`

The formatter's `eligible_candidates` section rendered exactly the 3 eligible candidates
(`BULL_CALL_SPREAD`, `BUY_STOCK`, `LONG_CALL` — `BUY_STOCK` is `consideration_eligible: true` on
`top_candidates` in this packet, distinct from the separate `baselines` array which held only
`NO_TRADE` here), each capped at `maxCandidates: 3` with strategy/expiration/score/grade/confidence/
max-loss/max-profit/breakeven read straight off the packet.

Fixtures:
- `docs/fixtures/phase3d-formatter-live-smoke-20260915/scenario_b_trade_candidates_packet.json`
- `docs/fixtures/phase3d-formatter-live-smoke-20260915/scenario_b_trade_candidates_formatted.json`

### Scenario B checklist

| Check | Result |
|---|---|
| `formatted.version == OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1` | PASS |
| `formatted.locale == "tr"` | PASS |
| `sections` present and every section has ≥1 line | PASS |
| `safety.numeric_source_of_truth == packet.ai_contract.numeric_source_of_truth` | PASS |
| `safety.allowed_candidate_ids_checked === true` | PASS |
| `safety.contains_investment_advice_language === false` | PASS |
| Every rendered `candidate_id` ∈ `ai_contract.allowed_candidate_ids` | PASS (3 eligible ids checked) |
| `eligible_candidates` section present | PASS |
| LOW confidence explicitly stated | PASS ("7 aday LOW güven seviyesindedir...") |
| CRR evidence-only / no-ranking-effect language present | PASS |
| Score/delta not framed as probability | PASS |
| IV note correctness | PASS — no `IV_SCENARIO_NOT_SPECIFIED`, no IV-unchanged note rendered |
| No forbidden investment-advice wording (TR/EN wordlist) | PASS |

## Formatter safety verdict

Across both decision states, the deterministic formatter:
- Never rendered a `candidate_id` outside `ai_contract.allowed_candidate_ids`.
- Never used recommendation/"buy"/"best trade"/"safe trade" language in either Turkish or English
  wordlists checked.
- Correctly branched section identity by decision state (`near_misses` for
  `NO_TRADE_BASELINE_ONLY`, `eligible_candidates` for `TRADE_CANDIDATES_AVAILABLE`) with no overlap.
- Correctly gated the IV-unchanged assumption note on the actual presence of
  `IV_SCENARIO_NOT_SPECIFIED` in `data_source.warnings` (absent in both runs since IV shocks were
  explicit) — it did not print a stale or unconditional IV note.
- Surfaced LOW confidence counts and CRR evidence-only framing exactly when those conditions held
  on the live packet.

## Caveats

- Point-in-time live smoke test, not a regression suite — does not replace `npm run test:unit`.
- Both runs used CRR `status: AVAILABLE` under the diagnostic-only `DIAGNOSTIC_ONLY_NO_RANKING_CHANGE`
  mode; the `FULL_EXTERNAL_INPUTS` / `HIGH`-confidence CRR path was **not** exercised here.
- Scenario B needed no parameter relaxation, so the Phase 2D.6-style 60–90 DTE / bearish fallback
  approach described in the task brief was not exercised in this run.
- Market/options data reflects live TradingView state at capture time (2026-09-15) and is not
  reproducible bit-for-bit on a later run.

## Validation

- `npm run test:unit`: see final report
- `npm run lint`: see final report
- Only `docs/fixtures/**` and this report were added — no `src/` or `tests/` changes.

## Final verdict

**PASS.** `formatOptionsAnalysisForUser` produced safe, deterministic, `allowed_candidate_ids`-gated
Turkish output for both `NO_TRADE_BASELINE_ONLY` and `TRADE_CANDIDATES_AVAILABLE` packets sourced
from the real `options_analyze_directional` MCP tool boundary, with no investment-advice language
and all required safety notes (LOW confidence, CRR evidence-only, score/delta disclaimers, IV
assumption) correctly present or correctly absent as dictated by the underlying packet.

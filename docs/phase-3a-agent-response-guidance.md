# Phase 3A — Agent Response Guidance

**Status:** implemented.
**Scope:** deterministic, user/agent-facing guidance for
`options_analyze_directional` responses.

## Goal

Phase 3A adds a compact `agent_response_guidance` block to every directional
options analysis packet. The goal is to make downstream explanations safer and
more consistent without changing the options engine's math, ranking, scoring,
confidence, eligibility, or CRR diagnostic contract.

## What changed

`src/core/options/directionalAnalysis.js` now builds
`agent_response_guidance` from already-computed packet state:

- `ranking.decision_state`
- `ranking.top_trade_candidate_id`
- `top_candidates[].consideration_eligible`
- `top_candidates[]` and `near_miss_candidates[]` confidence values
- `baselines[]`
- `diagnostics.crr_hybrid_policy`, when requested

The field is intentionally derived after ranking and after top/near-miss
selection. It does not feed back into any decision path.

## Public shape

```json
{
  "version": "OPTIONS_ANALYSIS_RESPONSE_GUIDANCE_V1",
  "audience": "AGENT_OR_UI_CONSUMER",
  "primary_decision_source": "ranking.decision_state",
  "candidate_status_source": "top_candidates[].consideration_eligible",
  "numeric_source_of_truth": "ai_contract.numeric_source_of_truth",
  "ranking_model": "RANKING_MODEL_V1",
  "decision_state": "TRADE_CANDIDATES_AVAILABLE",
  "top_trade_candidate_id": "candidate-id-or-null",
  "eligible_top_candidate_ids": [],
  "low_confidence_candidate_ids": [],
  "baseline_strategy_types": ["BUY_STOCK", "NO_TRADE"],
  "crr_hybrid_policy": {
    "status": "NOT_REQUESTED",
    "mode": "DIAGNOSTIC_ONLY_NO_RANKING_CHANGE",
    "action_counts": null,
    "interpretation": "NOT_PART_OF_THIS_DECISION"
  },
  "required_mentions": [],
  "forbidden_claims": []
}
```

## Safety rules

Consumers should treat this block as a checklist for explaining the packet,
not as an independent recommendation system.

- The user's target price remains a user-supplied scenario assumption.
- `ranking.decision_state` is the source of the packet's trade/no-trade state.
- `top_candidates[].consideration_eligible` is the source of candidate
  eligibility.
- `ai_contract.allowed_candidate_ids` still controls which candidates may be
  discussed.
- `LOW` confidence must be surfaced when such candidates are mentioned.
- If `decision_state` is `NO_TRADE_BASELINE_ONLY`, near misses are explanatory
  only and must not be promoted.
- If CRR diagnostics are available, they remain evidence-only and
  ranking-isolated. `HYBRID_REPRICE_CANDIDATE` is never a trade recommendation.

## Validation

Added focused unit coverage in `tests/directional_analysis.test.js`:

- `agent_response_guidance` is present and tied to ranking/candidate fields.
- `NO_TRADE_BASELINE_ONLY` guidance preserves the no-trade result and prevents
  near-miss promotion.
- CRR diagnostic guidance mirrors the frozen diagnostic status/mode/action
  counts without changing `diagnostics.crr_hybrid_policy`.
- `field_provenance.ENGINE_CALCULATED` includes `agent_response_guidance`.

## Non-goals

- No production ranking migration.
- No change to `diagnostics.crr_hybrid_policy` shape.
- No AI/LLM generation inside the tool.
- No live CDP validation requirement for this phase.

## Manual Live Smoke — 2026-09-10

One live `options_analyze_directional` call against a running TradingView
Desktop/CDP session, run manually to confirm `agent_response_guidance`
behaves correctly outside the unit-test fixtures. Read-only; no chart or
watchlist mutation.

**Request**

| Field | Value |
|---|---|
| `symbol` | `NASDAQ:ONDS` |
| `direction` | `bullish` |
| `underlying_price` (observed spot) | `7.29` |
| `horizon_days` | `30` |
| `base_target_price` | `7.66` (user-supplied, ~5% above spot) |
| `include_crr_hybrid_diagnostics` | `true` |
| IV shock | not specified — engine held IV at 0 change as an explicit analysis assumption |

**Observed result**

- `ranking.decision_state` = `NO_TRADE_BASELINE_ONLY`
- `top_trade_candidate_id` = `null`
- `eligible_top_candidate_ids` = `[]`
- `NO_TRADE` was preserved as the sole eligible baseline.
- `BUY_STOCK` scored 59.85 (near-miss, below the consideration threshold) and
  was not promoted into a recommendation.
- A `BULL_CALL_SPREAD` (7/9 strike, 2026-11-20 expiry) was marked `LOW`
  confidence.
- CRR diagnostics were `AVAILABLE`, `mode = DIAGNOSTIC_ONLY_NO_RANKING_CHANGE`,
  `interpretation = EVIDENCE_ONLY_NO_RANKING_OR_RECOMMENDATION_EFFECT`. One
  contract carried `HYBRID_REPRICE_CANDIDATE` — not interpreted as a trade
  recommendation or score override.

**`agent_response_guidance` verification**

- Present: `version = OPTIONS_ANALYSIS_RESPONSE_GUIDANCE_V1`.
- `agent_response_guidance.decision_state` matched `ranking.decision_state`
  (`NO_TRADE_BASELINE_ONLY`) — no drift between the two fields.
- `required_mentions` included both the LOW-confidence disclosure requirement
  and the CRR evidence-only/ranking-isolated requirement.
- `forbidden_claims` covered: no near-miss promotion, no score/delta framed as
  a probability, and no CRR-diagnostic-as-recommendation language.

**Conclusion:** on this live packet, `agent_response_guidance` stayed
consistent with `ranking.decision_state`, correctly kept CRR diagnostics
evidence-only, and explicitly surfaced the LOW-confidence candidate rather
than hiding it — matching the Phase 3A contract with no drift observed
outside the unit-test fixtures.

**Validation (docs-only branch, no `src/`/`tests/` changes)**

- `npm run test:unit` — 365/365 passed (80 suites), 0 failed.
- `npm run lint` — 0 errors, 9 pre-existing warnings (unchanged from `main`,
  unrelated to this doc change).

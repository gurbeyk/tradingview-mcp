# Phase 3B — User Explanation Summary

**Status:** implemented.
**Scope:** deterministic, end-user-facing compact summary for
`options_analyze_directional` responses.

## Goal

Phase 3B adds a compact `user_explanation_summary` block to every directional
options analysis packet. It answers "what did the engine say?" in a form
safe to render directly to an end user, without changing the options
engine's math, ranking, scoring, confidence, eligibility, or CRR diagnostic
contract.

This is deliberately a *different* field from Phase 3A's
`agent_response_guidance`:

- `agent_response_guidance` — a checklist for the agent/UI code that is
  producing an explanation (what it must mention, what it must never claim).
- `user_explanation_summary` — the compact, already-safe summary that can be
  shown to the end user directly, or used as the basis for one.

Neither field performs any AI/LLM generation. Both are pure functions of
already-computed packet state.

## What changed

`src/core/options/directionalAnalysis.js` adds `buildUserExplanationSummary`,
called after `buildAgentResponseGuidance` (it reuses that function's already
deterministic `eligible_top_candidate_ids` / `low_confidence_candidate_ids`
counts rather than recomputing them), and adds the result under
`user_explanation_summary` in the returned packet. `field_provenance.ENGINE_CALCULATED`
now includes `user_explanation_summary` alongside `agent_response_guidance`.

## Shape

```
{
  version: "OPTIONS_ANALYSIS_USER_SUMMARY_V1",
  decision_state: ranking.decision_state,
  headline_status: "NO_ELIGIBLE_OPTIONS" | "ELIGIBLE_CANDIDATES_AVAILABLE",
  headline: string,
  thesis_assumption: {
    direction, horizon_days, base_target_price,
    current_underlying_price, expected_move_pct
  },
  eligible_candidate_count: number,
  top_eligible_candidate_id: string | null,
  near_miss_count: number,
  low_confidence_candidate_count: number,
  baseline_summary: {
    has_buy_stock: boolean,
    has_no_trade: boolean,
    eligible_baseline_types: string[]
  },
  crr_summary: {
    requested: boolean,
    status: string,
    interpretation: "NOT_REQUESTED" | "EVIDENCE_ONLY_NO_RANKING_EFFECT" | "UNAVAILABLE"
  },
  assumption_notes: string[],
  safety_notes: string[]
}
```

## Field derivation (no AI, no new state)

- `decision_state` — `ranking.decision_state` verbatim.
- `headline_status` — `NO_ELIGIBLE_OPTIONS` when `decision_state ===
  'NO_TRADE_BASELINE_ONLY'`, otherwise `ELIGIBLE_CANDIDATES_AVAILABLE`.
- `headline` — one deterministic sentence, either citing the eligible count
  and `ranking.top_trade_candidate_id`, or stating that no candidate passed
  the consideration gates.
- `eligible_candidate_count` / `top_eligible_candidate_id` —
  `agent_response_guidance.eligible_top_candidate_ids` / `top_trade_candidate_id`
  (never recomputed independently, so the two fields can never drift apart).
- `near_miss_count` — `near_miss_candidates.length`.
- `low_confidence_candidate_count` —
  `agent_response_guidance.low_confidence_candidate_ids.length`.
- `baseline_summary` — derived from `ranking.baselines`
  (`strategy_type`/`consideration_eligible`) only.
- `crr_summary.requested` — `req.include_crr_hybrid_diagnostics === true`.
- `crr_summary.status` — `diagnostics.crr_hybrid_policy.status` (or
  `NOT_REQUESTED` if the diagnostics were never requested).
- `crr_summary.interpretation` — `NOT_REQUESTED` when not requested;
  `EVIDENCE_ONLY_NO_RANKING_EFFECT` when requested and `AVAILABLE`;
  `UNAVAILABLE` for any other requested-but-not-available status. Exactly
  the three contractually allowed values, never a fourth.
- `assumption_notes` — always states the user's target price is a scenario
  assumption, not a forecast; adds an explicit "IV unchanged analysis
  assumption was used" note whenever `IV_SCENARIO_NOT_SPECIFIED` applies
  (i.e. no `*_iv_change_points` was supplied).
- `safety_notes` — restates score-is-not-probability and
  delta-is-not-probability-of-profit; adds a NO_TRADE-preserved note when
  `decision_state === 'NO_TRADE_BASELINE_ONLY'`; adds a LOW-confidence count
  note when any exist; adds a CRR evidence-only note when CRR diagnostics are
  `AVAILABLE`.

## Safety guarantees preserved

- Never widens or changes the meaning of `ai_contract` or
  `agent_response_guidance` — it is purely additive and reuses their already-
  validated fields rather than recomputing them.
- Never changes `diagnostics.crr_hybrid_policy` shape or values.
- Never changes ranking/scoring/confidence/eligibility — `analyzeDirectional`
  computes ranking fully before this summary is built, and the summary only
  reads already-final values.
- Contains no investment-advice language ("recommendation", "buy signal",
  "safe trade", "best trade") and no probability framing of score/delta —
  covered by a dedicated regression test scanning the summary's own static
  text for banned phrases.
- Near-miss candidates are never promoted: when `decision_state ===
  'NO_TRADE_BASELINE_ONLY'`, `top_eligible_candidate_id` is always `null` and
  `eligible_candidate_count` is always `0`.
- `NO_TRADE_BASELINE_ONLY` is preserved verbatim as `decision_state`, never
  reinterpreted or dropped.
- LOW confidence is always surfaced as an explicit count
  (`low_confidence_candidate_count`) plus a safety note when non-zero.

## Validation

Added focused unit coverage in `tests/directional_analysis.test.js` under
`describe('Phase 3B — user_explanation_summary', ...)`:

- Present on every analysis with the correct `version`.
- `NO_TRADE_BASELINE_ONLY` → `headline_status = NO_ELIGIBLE_OPTIONS`,
  `top_eligible_candidate_id = null`, `eligible_candidate_count = 0`.
- `TRADE_CANDIDATES_AVAILABLE` → `headline_status =
  ELIGIBLE_CANDIDATES_AVAILABLE`, count/top id consistent with
  `top_candidates`/`ranking`.
- `low_confidence_candidate_count` matches
  `agent_response_guidance.low_confidence_candidate_ids.length` exactly.
- `IV_SCENARIO_NOT_SPECIFIED` present → `assumption_notes` explicitly states
  the IV-unchanged assumption; absent when an explicit IV scenario is given.
- CRR requested + `AVAILABLE` → `crr_summary.interpretation =
  EVIDENCE_ONLY_NO_RANKING_EFFECT`; not requested → `NOT_REQUESTED`.
- `field_provenance.ENGINE_CALCULATED` includes `user_explanation_summary`.
- Enabling CRR diagnostics changes nothing about ranking/top_candidates,
  including the summary's own `decision_state`/`top_eligible_candidate_id`.
- The summary's own JSON text never contains banned investment-advice
  phrases.
- `thesis_assumption` mirrors the top-level `direction`/`horizon_days`/
  `thesis.base_target_price`/`underlying_price`/`thesis.expected_move_pct`
  exactly (no independent recomputation, no drift).

## Non-goals

- No production ranking migration.
- No change to `diagnostics.crr_hybrid_policy` shape.
- No AI/LLM generation inside the tool.
- No change to `agent_response_guidance`'s own contract — Phase 3B does not
  add a cross-reference field there, to avoid growing that contract
  unnecessarily.

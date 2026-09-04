// Phase 2F.0 — reusable live-validation automation helpers.
//
// These helpers keep the live MCP/manual validation criteria executable
// without changing options_analyze_directional semantics. They build bounded
// spot-aware requests, summarize analysis packets, and evaluate diagnostic
// acceptance gates.

export const LIVE_VALIDATION_PROFILES = Object.freeze({
  BULLISH_BASELINE_30D: Object.freeze({
    id: 'BULLISH_BASELINE_30D',
    direction: 'bullish',
    horizon_days: 30,
    max_loss: 1000,
    target_move_pct: 0.05,
    max_spread_pct: 25,
    min_dte: null,
    max_dte: null,
    include_crr_hybrid_diagnostics: true,
    downside_iv_change_points: 0,
    base_iv_change_points: 0,
    upside_iv_change_points: 0,
  }),
  BEARISH_ELIGIBLE_60_90D: Object.freeze({
    id: 'BEARISH_ELIGIBLE_60_90D',
    direction: 'bearish',
    horizon_days: 30,
    max_loss: 2500,
    target_move_pct: 0.08,
    max_spread_pct: 25,
    min_dte: 60,
    max_dte: 90,
    include_crr_hybrid_diagnostics: true,
    downside_iv_change_points: 0,
    base_iv_change_points: 0,
    upside_iv_change_points: 0,
  }),
});

export const LIVE_VALIDATION_ACCEPTANCE = Object.freeze({
  DIAGNOSTICS_AVAILABLE: 'DIAGNOSTICS_AVAILABLE',
  DIAGNOSTIC_MODE_ISOLATED: 'DIAGNOSTIC_MODE_ISOLATED',
  NO_FULL_EXTERNAL_INPUTS: 'NO_FULL_EXTERNAL_INPUTS',
  BORROW_EXPLICITLY_UNAVAILABLE: 'BORROW_EXPLICITLY_UNAVAILABLE',
  LOCAL_RANKING_MODEL: 'LOCAL_RANKING_MODEL',
  COMPLETED_WITHOUT_TOOL_ERROR: 'COMPLETED_WITHOUT_TOOL_ERROR',
});

const RANKING_MODEL_V1 = 'RANKING_MODEL_V1';
const DIAGNOSTIC_MODE = 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE';

function round2(v) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
}

export function buildSpotAwareValidationRequest({ symbol, spot, profile }) {
  if (!Number.isFinite(spot) || spot <= 0) throw new Error('spot must be a positive finite number');
  if (!profile || typeof profile !== 'object') throw new Error('profile is required');
  const movePct = profile.target_move_pct;
  if (!Number.isFinite(movePct) || movePct <= 0) throw new Error('profile.target_move_pct must be a positive finite number');

  const targetMultiplier = profile.direction === 'bearish' ? 1 - movePct : 1 + movePct;
  const req = {
    symbol,
    direction: profile.direction,
    horizon_days: profile.horizon_days,
    max_loss: profile.max_loss,
    base_target_price: round2(spot * targetMultiplier),
    max_spread_pct: profile.max_spread_pct,
    include_crr_hybrid_diagnostics: profile.include_crr_hybrid_diagnostics,
    downside_iv_change_points: profile.downside_iv_change_points,
    base_iv_change_points: profile.base_iv_change_points,
    upside_iv_change_points: profile.upside_iv_change_points,
  };

  if (profile.min_dte != null) req.min_dte = profile.min_dte;
  if (profile.max_dte != null) req.max_dte = profile.max_dte;
  return req;
}

export function summarizeAnalysisPacket(packet, { profileId = null } = {}) {
  const diagnostics = packet?.diagnostics?.crr_hybrid_policy ?? null;
  const marketInputs = diagnostics?.market_inputs ?? [];
  const surfacedCandidates = [
    ...(packet?.top_candidates ?? []),
    ...(packet?.near_miss_candidates ?? []),
  ];
  const topFive = (packet?.top_candidates ?? []).slice(0, 5);

  return {
    profile_id: profileId,
    symbol: packet?.symbol ?? null,
    analysis_snapshot_id: packet?.analysis_snapshot_id ?? null,
    analysis_as_of_utc: packet?.analysis_as_of_utc ?? null,
    direction: packet?.direction ?? null,
    underlying_price: packet?.underlying_price ?? null,
    base_target_price: packet?.input_echo?.base_target_price ?? null,
    horizon_days: packet?.horizon_days ?? null,
    max_loss: packet?.max_loss ?? null,
    max_spread_pct: packet?.input_echo?.max_spread_pct ?? null,
    min_dte: packet?.input_echo?.min_dte ?? null,
    max_dte: packet?.input_echo?.max_dte ?? null,
    chain_completeness: packet?.data_source?.chain_completeness ?? null,
    data_warnings: packet?.data_source?.warnings ?? [],
    candidate_count: packet?.candidate_generation?.candidate_count ?? null,
    ranking_model: packet?.ranking?.model ?? null,
    decision_state: packet?.ranking?.decision_state ?? null,
    top_trade_candidate_id: packet?.ranking?.top_trade_candidate_id ?? null,
    top5_candidate_ids: topFive.map(c => c.candidate_id),
    top5_strategy_types: topFive.map(c => c.strategy_type),
    surfaced_strategy_types: [...new Set(surfacedCandidates.map(c => c.strategy_type))],
    diagnostics_status: diagnostics?.status ?? null,
    diagnostics_mode: diagnostics?.mode ?? null,
    hybrid_policy_summary: diagnostics?.summary ?? null,
    market_input_modes: [...new Set(marketInputs.map(input => input.mode))],
    market_input_warnings: [...new Set(marketInputs.flatMap(input => input.warnings ?? []))],
    borrow_sources: [...new Set(marketInputs.map(input => input.borrow_source).filter(Boolean))],
    top_candidate_hybrid_actions: (diagnostics?.candidates ?? [])
      .slice(0, 5)
      .map(c => ({
        candidate_id: c.candidate_id,
        strategy_type: c.strategy_type,
        action: c.action,
        max_model_disagreement_level: c.max_model_disagreement_level,
      })),
  };
}

export function evaluateLiveValidationSummary(summary, criteria = Object.values(LIVE_VALIDATION_ACCEPTANCE)) {
  const checks = {};
  for (const criterion of criteria) {
    if (criterion === LIVE_VALIDATION_ACCEPTANCE.COMPLETED_WITHOUT_TOOL_ERROR) checks[criterion] = summary?.analysis_snapshot_id != null;
    else if (criterion === LIVE_VALIDATION_ACCEPTANCE.DIAGNOSTICS_AVAILABLE) checks[criterion] = summary?.diagnostics_status === 'AVAILABLE';
    else if (criterion === LIVE_VALIDATION_ACCEPTANCE.DIAGNOSTIC_MODE_ISOLATED) checks[criterion] = summary?.diagnostics_mode === DIAGNOSTIC_MODE;
    else if (criterion === LIVE_VALIDATION_ACCEPTANCE.NO_FULL_EXTERNAL_INPUTS) checks[criterion] = !(summary?.market_input_modes ?? []).includes('FULL_EXTERNAL_INPUTS');
    else if (criterion === LIVE_VALIDATION_ACCEPTANCE.BORROW_EXPLICITLY_UNAVAILABLE) checks[criterion] = (summary?.market_input_warnings ?? []).includes('BORROW_DATA_UNAVAILABLE')
      || (summary?.borrow_sources ?? []).includes('NOT_CONNECTED');
    else if (criterion === LIVE_VALIDATION_ACCEPTANCE.LOCAL_RANKING_MODEL) checks[criterion] = summary?.ranking_model === RANKING_MODEL_V1;
    else checks[criterion] = false;
  }
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([criterion]) => criterion);
  return {
    passed: failed.length === 0,
    checks,
    failed,
  };
}

export function aggregateLiveValidationResults(results) {
  const rows = results.map(result => result.summary);
  return {
    total_runs: rows.length,
    passed_runs: results.filter(result => result.acceptance.passed).length,
    failed_runs: results.filter(result => !result.acceptance.passed).length,
    by_decision_state: rows.reduce((acc, row) => {
      const key = row.decision_state ?? 'UNKNOWN';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    by_diagnostics_status: rows.reduce((acc, row) => {
      const key = row.diagnostics_status ?? 'UNKNOWN';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

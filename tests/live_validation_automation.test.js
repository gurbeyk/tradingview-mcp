import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIVE_VALIDATION_PROFILES,
  aggregateLiveValidationResults,
  buildSpotAwareValidationRequest,
  evaluateLiveValidationSummary,
  summarizeAnalysisPacket,
} from '../src/core/options/liveValidationAutomation.js';

function packet(overrides = {}) {
  return {
    symbol: 'NASDAQ:TEST',
    analysis_snapshot_id: 'abc123',
    analysis_as_of_utc: '2026-09-04T12:00:00Z',
    direction: 'bullish',
    underlying_price: 100,
    horizon_days: 30,
    max_loss: 1000,
    input_echo: { base_target_price: 105, max_spread_pct: 25, min_dte: null, max_dte: null },
    data_source: { chain_completeness: 'COMPLETE', warnings: [] },
    candidate_generation: { candidate_count: 12 },
    ranking: { model: 'RANKING_MODEL_V1', decision_state: 'TRADE_CANDIDATES_AVAILABLE', top_trade_candidate_id: 'C1' },
    diagnostics: {
      crr_hybrid_policy: {
        status: 'AVAILABLE',
        mode: 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE',
        summary: {
          total_candidates: 12,
          by_action: { LOCAL_ONLY: 4, HYBRID_REPRICE_CANDIDATE: 6, NO_ACTION: 2 },
          crr_shadow_available_count: 12,
          local_warning_count: 6,
        },
        market_inputs: [{
          expiration: '2026-12-18',
          days_to_expiry: 75,
          mode: 'PARTIAL_EXTERNAL_INPUTS',
          overall_confidence: 'LOW',
          discount_rate_source: 'TREASURY_BILL_COUPON_EQUIVALENT_NORMALIZED',
          dividend_mode: 'TRAILING_DIVIDEND_YIELD_APPROXIMATION',
          borrow_source: 'NOT_CONNECTED',
          warnings: ['BORROW_DATA_UNAVAILABLE'],
        }],
        candidates: [{
          candidate_id: 'C1',
          strategy_type: 'BULL_CALL_SPREAD',
          action: 'LOCAL_ONLY',
          reasons: ['LOCAL_CLEAN_AND_CRR_AGREES'],
          local_warnings: [],
          max_model_disagreement_level: 'MODEL_DISAGREEMENT_LOW',
          crr_shadow_available: true,
        }],
      },
    },
    top_candidates: [
      { candidate_id: 'C1', strategy_type: 'BULL_CALL_SPREAD' },
      { candidate_id: 'C2', strategy_type: 'BUY_STOCK' },
    ],
    near_miss_candidates: [],
    ...overrides,
  };
}

describe('buildSpotAwareValidationRequest()', () => {
  it('builds bullish requests above spot with CRR diagnostics enabled', () => {
    const req = buildSpotAwareValidationRequest({
      symbol: 'NASDAQ:NVDA',
      spot: 200,
      profile: LIVE_VALIDATION_PROFILES.BULLISH_BASELINE_30D,
    });

    assert.equal(req.direction, 'bullish');
    assert.equal(req.base_target_price, 210);
    assert.equal(req.include_crr_hybrid_diagnostics, true);
    assert.equal(req.downside_iv_change_points, 0);
    assert.equal(req.base_iv_change_points, 0);
    assert.equal(req.upside_iv_change_points, 0);
  });

  it('builds bearish eligible-coverage requests below spot with 60-90 DTE window', () => {
    const req = buildSpotAwareValidationRequest({
      symbol: 'NASDAQ:AAPL',
      spot: 300,
      profile: LIVE_VALIDATION_PROFILES.BEARISH_ELIGIBLE_60_90D,
    });

    assert.equal(req.direction, 'bearish');
    assert.equal(req.base_target_price, 276);
    assert.equal(req.min_dte, 60);
    assert.equal(req.max_dte, 90);
    assert.equal(req.max_loss, 2500);
  });

  it('rejects invalid spot and profile inputs', () => {
    assert.throws(() => buildSpotAwareValidationRequest({ symbol: 'X', spot: 0, profile: LIVE_VALIDATION_PROFILES.BULLISH_BASELINE_30D }), /spot/);
    assert.throws(() => buildSpotAwareValidationRequest({ symbol: 'X', spot: 100, profile: null }), /profile/);
  });
});

describe('summarizeAnalysisPacket()', () => {
  it('extracts the stable live-validation summary fields', () => {
    const summary = summarizeAnalysisPacket(packet(), { profileId: 'BULLISH_BASELINE_30D' });

    assert.equal(summary.profile_id, 'BULLISH_BASELINE_30D');
    assert.equal(summary.symbol, 'NASDAQ:TEST');
    assert.equal(summary.diagnostics_status, 'AVAILABLE');
    assert.deepEqual(summary.market_input_modes, ['PARTIAL_EXTERNAL_INPUTS']);
    assert.deepEqual(summary.borrow_sources, ['NOT_CONNECTED']);
    assert.deepEqual(summary.top5_candidate_ids, ['C1', 'C2']);
    assert.deepEqual(summary.top5_strategy_types, ['BULL_CALL_SPREAD', 'BUY_STOCK']);
  });
});

describe('evaluateLiveValidationSummary()', () => {
  it('passes when diagnostic isolation criteria are met', () => {
    const summary = summarizeAnalysisPacket(packet());
    const result = evaluateLiveValidationSummary(summary);

    assert.equal(result.passed, true);
    assert.deepEqual(result.failed, []);
  });

  it('fails when diagnostics are unavailable or full external inputs appear', () => {
    const summary = summarizeAnalysisPacket(packet({
      diagnostics: {
        crr_hybrid_policy: {
          status: 'UNAVAILABLE',
          mode: 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE',
          market_inputs: [{ mode: 'FULL_EXTERNAL_INPUTS', borrow_source: 'IBKR_FEE_RATE', warnings: [] }],
          summary: null,
          candidates: [],
        },
      },
    }));
    const result = evaluateLiveValidationSummary(summary);

    assert.equal(result.passed, false);
    assert.ok(result.failed.includes('DIAGNOSTICS_AVAILABLE'));
    assert.ok(result.failed.includes('NO_FULL_EXTERNAL_INPUTS'));
    assert.ok(result.failed.includes('BORROW_EXPLICITLY_UNAVAILABLE'));
  });
});

describe('aggregateLiveValidationResults()', () => {
  it('summarizes pass/fail and status counts across runs', () => {
    const summary = summarizeAnalysisPacket(packet());
    const failedSummary = { ...summary, analysis_snapshot_id: null, diagnostics_status: 'UNAVAILABLE' };
    const result = aggregateLiveValidationResults([
      { summary, acceptance: evaluateLiveValidationSummary(summary) },
      { summary: failedSummary, acceptance: evaluateLiveValidationSummary(failedSummary) },
    ]);

    assert.equal(result.total_runs, 2);
    assert.equal(result.passed_runs, 1);
    assert.equal(result.failed_runs, 1);
    assert.equal(result.by_decision_state.TRADE_CANDIDATES_AVAILABLE, 2);
    assert.equal(result.by_diagnostics_status.AVAILABLE, 1);
    assert.equal(result.by_diagnostics_status.UNAVAILABLE, 1);
  });
});

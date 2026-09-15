/**
 * Phase 3D — deterministic, network-free tests for the options analysis
 * user formatter (src/core/options/optionsAnalysisFormatter.js). Real
 * packets are produced via analyzeDirectional() with injected mock
 * dependencies (same pattern as tests/directional_analysis.test.js), plus a
 * few hand-crafted packet variants to exercise contract-violation edge
 * cases (disallowed candidate id, HYBRID_REPRICE_CANDIDATE framing) that
 * are hard to force through the real orchestrator.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDirectional } from '../src/core/options/directionalAnalysis.js';
import { formatOptionsAnalysisForUser } from '../src/core/options/optionsAnalysisFormatter.js';

function contract({ expiration, dte, strike, type, bid, ask, iv = 30, delta, gamma = 0.02, theta = -0.1, vega = 0.2, rho = 0.05 }) {
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  return {
    contract: `OPRA:TEST${expiration.replace(/-/g, '').slice(2)}${type === 'call' ? 'C' : 'P'}${strike.toFixed(1)}`,
    root: 'TEST', expiration, days_to_expiry: dte, strike, option_type: type, currency: 'USD',
    bid, ask, theoretical_price: mid, iv, bid_iv: iv - 1, ask_iv: iv + 1,
    delta, gamma, theta, vega, rho, mid, spread,
    spread_pct: mid > 0 ? Math.round((spread / mid) * 1000) / 10 : null,
    iv_spread: 2, quality_flags: [],
  };
}

function buildFixtureContracts({ dte = 45, expiration = '2026-10-16' } = {}) {
  return [
    contract({ expiration, dte, strike: 95, type: 'call', bid: 8.4, ask: 8.6, delta: 0.60 }),
    contract({ expiration, dte, strike: 100, type: 'call', bid: 5.0, ask: 5.2, delta: 0.50 }),
    contract({ expiration, dte, strike: 105, type: 'call', bid: 2.9, ask: 3.1, delta: 0.35 }),
    contract({ expiration, dte, strike: 110, type: 'call', bid: 1.4, ask: 1.6, delta: 0.25 }),
    contract({ expiration, dte, strike: 105, type: 'put', bid: 8.4, ask: 8.6, delta: -0.60 }),
    contract({ expiration, dte, strike: 100, type: 'put', bid: 5.0, ask: 5.2, delta: -0.50 }),
    contract({ expiration, dte, strike: 95, type: 'put', bid: 2.9, ask: 3.1, delta: -0.35 }),
    contract({ expiration, dte, strike: 90, type: 'put', bid: 1.4, ask: 1.6, delta: -0.25 }),
  ];
}

function mockDeps({ price = 100, chainCompleteness = 'COMPLETE', chainWarnings = [], contracts, dividendYieldPct = null } = {}) {
  return {
    getKeyStats: async () => (dividendYieldPct == null ? { price } : { price, dividend_yield_pct: dividendYieldPct }),
    getOptionChain: async () => ({
      symbol: 'TEST:FOO', source: 'TradingView Options Scanner', source_endpoint: '/options/scan2',
      retrieved_at_utc: '2026-01-01T00:00:00Z', chain_completeness: chainCompleteness, warnings: chainWarnings,
      contracts: contracts ?? buildFixtureContracts(),
    }),
  };
}

const BULLISH_BASE = { symbol: 'TEST:FOO', direction: 'bullish', horizon_days: 30, max_loss: 1000, base_target_price: 115 };

// Deliberately unreachable target combined with a tight max_loss to force
// NO_TRADE_BASELINE_ONLY (mirrors the shape used elsewhere in the suite).
const NO_TRADE_REQ = { ...BULLISH_BASE, base_target_price: 101, max_loss: 20, max_spread_pct: 0.01 };

const FORBIDDEN_WORDS_TR = ['tavsiye', 'öneri', 'al ', 'satın al', 'kesinlikle', 'en iyi işlem', 'güvenli işlem', 'alınabilir', 'buy signal'];
const FORBIDDEN_WORDS_EN = ['recommend', 'buy signal', 'best trade', 'safe trade', 'you should buy', 'guaranteed'];

function allText(formatted) {
  return formatted.sections.flatMap(s => [s.title, ...s.lines]).join('\n').toLowerCase();
}

describe('formatOptionsAnalysisForUser — NO_TRADE_BASELINE_ONLY', () => {
  it('1) formats a NO_TRADE_BASELINE_ONLY packet into safe Turkish sections', async () => {
    const packet = await analyzeDirectional(NO_TRADE_REQ, mockDeps());
    assert.equal(packet.ranking.decision_state, 'NO_TRADE_BASELINE_ONLY');

    const formatted = formatOptionsAnalysisForUser(packet);
    assert.equal(formatted.version, 'OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1');
    assert.equal(formatted.locale, 'tr');
    const ids = formatted.sections.map(s => s.id);
    assert.deepEqual(ids, ['thesis_assumption', 'engine_result', 'near_misses', 'baselines', 'assumptions_and_risks']);
    const nearMissSection = formatted.sections.find(s => s.id === 'near_misses');
    assert.ok(nearMissSection.lines.length > 0);
    const engineSection = formatted.sections.find(s => s.id === 'engine_result');
    assert.ok(engineSection.lines.some(l => l.includes('NO_TRADE_BASELINE_ONLY')));
  });
});

describe('formatOptionsAnalysisForUser — TRADE_CANDIDATES_AVAILABLE', () => {
  it('2) formats eligible candidates gated by allowed_candidate_ids', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    assert.equal(packet.ranking.decision_state, 'TRADE_CANDIDATES_AVAILABLE');

    const formatted = formatOptionsAnalysisForUser(packet);
    const eligibleSection = formatted.sections.find(s => s.id === 'eligible_candidates');
    assert.ok(eligibleSection, 'expected an eligible_candidates section');
    assert.ok(eligibleSection.lines.length > 0);
    const allowedIds = new Set(packet.ai_contract.allowed_candidate_ids);
    for (const line of eligibleSection.lines) {
      const id = line.split(' | ')[0];
      assert.ok(allowedIds.has(id), `candidate id "${id}" must be in ai_contract.allowed_candidate_ids`);
    }
  });

  it('3) never prints a candidate_id outside ai_contract.allowed_candidate_ids', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const tampered = structuredClone(packet);
    tampered.top_candidates = [
      ...tampered.top_candidates,
      {
        candidate_id: 'ROGUE::NOT_ALLOWED::CANDIDATE',
        strategy_type: 'BULL_CALL_SPREAD',
        consideration_eligible: true,
        confidence: 'HIGH',
        score: 99,
        grade: 'A',
        expiration: '2099-01-01',
        days_to_expiry: 1,
        max_loss: 1,
        max_profit: 1,
        breakeven: 1,
      },
    ];
    const formatted = formatOptionsAnalysisForUser(tampered);
    const text = allText(formatted);
    assert.ok(!text.includes('rogue'), 'a candidate_id absent from allowed_candidate_ids must never be rendered');
  });

  it('4) explicitly labels LOW-confidence candidates', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const lowConfPacket = structuredClone(packet);
    const firstEligible = lowConfPacket.top_candidates.find(c => c.consideration_eligible);
    assert.ok(firstEligible, 'fixture must produce at least one eligible candidate');
    firstEligible.confidence = 'LOW';
    lowConfPacket.user_explanation_summary.low_confidence_candidate_count = 1;

    const formatted = formatOptionsAnalysisForUser(lowConfPacket);
    const eligibleSection = formatted.sections.find(s => s.id === 'eligible_candidates');
    const line = eligibleSection.lines.find(l => l.startsWith(firstEligible.candidate_id));
    assert.ok(line.includes('LOW'), 'LOW confidence must be explicit on the candidate line');
    const risksSection = formatted.sections.find(s => s.id === 'assumptions_and_risks');
    assert.ok(risksSection.lines.some(l => l.includes('LOW')), 'LOW confidence count must be surfaced in risks section');
  });
});

describe('formatOptionsAnalysisForUser — CRR diagnostics', () => {
  it('5) states evidence-only / no-ranking-effect language when CRR diagnostics are AVAILABLE', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const withCrr = structuredClone(packet);
    withCrr.diagnostics.crr_hybrid_policy = { status: 'AVAILABLE', mode: 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE', summary: {}, candidates: [] };

    const formatted = formatOptionsAnalysisForUser(withCrr);
    const risksSection = formatted.sections.find(s => s.id === 'assumptions_and_risks');
    assert.ok(risksSection.lines.some(l => l.toLowerCase().includes('kanıt amaçlıdır')));
  });

  it('6) never frames a HYBRID_REPRICE_CANDIDATE action as a trade recommendation', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const withCrr = structuredClone(packet);
    const firstEligibleId = packet.top_candidates.find(c => c.consideration_eligible)?.candidate_id;
    withCrr.diagnostics.crr_hybrid_policy = {
      status: 'AVAILABLE',
      mode: 'DIAGNOSTIC_ONLY_NO_RANKING_CHANGE',
      summary: { by_action: { HYBRID_REPRICE_CANDIDATE: 1 } },
      candidates: [{ candidate_id: firstEligibleId, strategy_type: 'BULL_CALL_SPREAD', action: 'HYBRID_REPRICE_CANDIDATE', reasons: ['model disagreement'] }],
    };

    const formatted = formatOptionsAnalysisForUser(withCrr);
    const text = allText(formatted);
    assert.ok(!text.includes('hybrid_reprice_candidate'), 'raw CRR action codes must not leak into the rendered text');
    for (const w of FORBIDDEN_WORDS_TR) assert.ok(!text.includes(w), `forbidden word "${w}" found`);
  });
});

describe('formatOptionsAnalysisForUser — IV assumption', () => {
  it('7) surfaces the IV-unchanged assumption when IV_SCENARIO_NOT_SPECIFIED is present', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    assert.ok(packet.data_source.warnings.includes('IV_SCENARIO_NOT_SPECIFIED'));

    const formatted = formatOptionsAnalysisForUser(packet);
    const risksSection = formatted.sections.find(s => s.id === 'assumptions_and_risks');
    assert.ok(risksSection.lines.some(l => l.toLowerCase().includes('iv sabit varsayım')));
  });
});

describe('formatOptionsAnalysisForUser — safety language', () => {
  it('8) never contains investment-advice language, in either decision state', async () => {
    const tradePacket = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const noTradePacket = await analyzeDirectional(NO_TRADE_REQ, mockDeps());

    for (const packet of [tradePacket, noTradePacket]) {
      const formatted = formatOptionsAnalysisForUser(packet);
      const text = allText(formatted);
      for (const w of FORBIDDEN_WORDS_TR) assert.ok(!text.includes(w), `forbidden word "${w}" found in TR output`);

      const formattedEn = formatOptionsAnalysisForUser(packet, { locale: 'en' });
      const textEn = allText(formattedEn);
      for (const w of FORBIDDEN_WORDS_EN) assert.ok(!textEn.includes(w), `forbidden word "${w}" found in EN output`);
    }
  });
});

describe('formatOptionsAnalysisForUser — locale handling', () => {
  it('9) throws a clear error for an unsupported locale', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    assert.throws(() => formatOptionsAnalysisForUser(packet, { locale: 'de' }), /Unsupported locale/);
  });

  it('defaults to "tr" when no locale is given, and "en" is a supported opt-in', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    assert.equal(formatOptionsAnalysisForUser(packet).locale, 'tr');
    assert.equal(formatOptionsAnalysisForUser(packet, { locale: 'en' }).locale, 'en');
  });
});

describe('formatOptionsAnalysisForUser — purity', () => {
  it('10) does not mutate the input packet', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const before = JSON.stringify(packet);
    formatOptionsAnalysisForUser(packet);
    formatOptionsAnalysisForUser(packet, { locale: 'en', maxCandidates: 1 });
    const after = JSON.stringify(packet);
    assert.equal(after, before, 'formatOptionsAnalysisForUser must not mutate its input packet');
  });

  it('respects maxCandidates', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const formatted = formatOptionsAnalysisForUser(packet, { maxCandidates: 1 });
    const eligibleSection = formatted.sections.find(s => s.id === 'eligible_candidates');
    assert.ok(eligibleSection.lines.length <= 1);
  });

  it('safety block echoes ai_contract.numeric_source_of_truth verbatim', async () => {
    const packet = await analyzeDirectional(BULLISH_BASE, mockDeps());
    const formatted = formatOptionsAnalysisForUser(packet);
    assert.equal(formatted.safety.source, 'deterministic_formatter');
    assert.equal(formatted.safety.numeric_source_of_truth, packet.ai_contract.numeric_source_of_truth);
    assert.equal(formatted.safety.allowed_candidate_ids_checked, true);
    assert.equal(formatted.safety.contains_investment_advice_language, false);
  });
});

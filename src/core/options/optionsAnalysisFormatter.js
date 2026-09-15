// Phase 3D — deterministic, non-AI formatter that turns an
// analyzeDirectional() packet (src/core/options/directionalAnalysis.js) into
// short, safe, human-readable sections. This module performs NO ranking,
// scoring, pricing, or scenario math of its own — it only reads values
// already present on the packet and applies trivial display formatting
// (rounding/locale text). It must never change what the underlying engine
// decided; it is a renderer, not a second opinion.
//
// Candidate discussion is gated through packet.ai_contract.allowed_candidate_ids
// exactly like the agent-facing contract — a candidate_id that is not on that
// list is never printed, even if it appears elsewhere on the packet.

const FORMAT_VERSION = 'OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1';
const SUPPORTED_LOCALES = ['tr', 'en'];
const DEFAULT_MAX_CANDIDATES = 3;

const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const fmtNum = (v) => (v == null || !Number.isFinite(v) ? '—' : String(round2(v)));
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : `%${String(round2(v))}`);

const TR = {
  direction: { bullish: 'yükseliş (bullish)', bearish: 'düşüş (bearish)' },
  decisionState: {
    TRADE_CANDIDATES_AVAILABLE: 'Değerlendirmeye uygun aday(lar) bulundu.',
    NO_TRADE_BASELINE_ONLY: 'Hiçbir opsiyon adayı değerlendirmeye uygun eşiği geçemedi — NO_TRADE tek uygun baseline.',
  },
  sectionTitles: {
    thesis_assumption: 'Senin Varsayımın',
    engine_result: 'Motorun Sonucu',
    eligible_candidates: 'Değerlendirmeye Uygun Adaylar',
    near_misses: 'Elenen Adaylar (Neden Elendikleri)',
    baselines: 'Baseline Karşılaştırması',
    assumptions_and_risks: 'Varsayımlar ve Riskler',
  },
  labels: {
    symbol: 'Sembol', direction: 'Yön', horizon: 'Ufuk (gün)',
    currentPrice: 'Güncel fiyat', targetPrice: 'Hedef fiyat (kullanıcı varsayımı)',
    expectedMove: 'Beklenen hareket', decisionState: 'Karar durumu',
    eligibleCount: 'Değerlendirmeye uygun aday sayısı', lowConfCount: 'LOW güvenilirlikli aday sayısı',
    nearMissCount: 'Elenen (near-miss) aday sayısı', noEligible: 'Değerlendirmeye uygun opsiyon adayı yok.',
    noNearMiss: 'Elenen aday yok.', strategy: 'Strateji', expiration: 'Vade',
    dte: 'gün kaldı', score: 'skor', grade: 'not', confidence: 'güven',
    maxLoss: 'maks. zarar', maxProfit: 'maks. kâr', breakeven: 'başabaş',
    reasons: 'Gerekçe', noBaselines: 'Baseline verisi yok.',
    ivAssumption: 'IV senaryosu belirtilmedi — analiz IV sabit varsayımıyla çalıştı.',
    crrEvidenceOnly: 'CRR hibrit tanı verisi yalnızca kanıt amaçlıdır (evidence-only) ve sıralamayı/skoru etkilemez.',
    scoreNotProbability: 'Skor bir olasılık veya beklenen getiri değildir; yalnızca karşılaştırmalı bir sezgiseldir.',
    deltaNotProbability: 'Delta bir Greek değeridir, kâr olasılığı değildir.',
    noVolumeOi: 'Hacim/açık pozisyon (open interest) verisi bu paketin bir parçası değildir ve uydurulmamıştır.',
    lowConfNote: (n) => `${n} aday LOW güven seviyesindedir; bu adaylar açıkça LOW olarak belirtilmelidir.`,
    localGreekApprox: 'Senaryo fiyatlaması yerel bir Greek yaklaşımıdır (LOCAL_GREEK_APPROXIMATION), tam bir opsiyon fiyatlama modeli değildir.',
    scenarioWarning: (w) => `Senaryo uyarısı: ${w}`,
  },
};

const EN = {
  direction: { bullish: 'bullish', bearish: 'bearish' },
  decisionState: {
    TRADE_CANDIDATES_AVAILABLE: 'Consideration-eligible candidate(s) found.',
    NO_TRADE_BASELINE_ONLY: 'No candidate passed the consideration gates — NO_TRADE is the only eligible baseline.',
  },
  sectionTitles: {
    thesis_assumption: 'Your Assumption',
    engine_result: "Engine's Result",
    eligible_candidates: 'Consideration-Eligible Candidates',
    near_misses: 'Eliminated Candidates (Why)',
    baselines: 'Baseline Comparison',
    assumptions_and_risks: 'Assumptions and Risks',
  },
  labels: {
    symbol: 'Symbol', direction: 'Direction', horizon: 'Horizon (days)',
    currentPrice: 'Current price', targetPrice: 'Target price (user assumption)',
    expectedMove: 'Expected move', decisionState: 'Decision state',
    eligibleCount: 'Consideration-eligible candidate count', lowConfCount: 'LOW-confidence candidate count',
    nearMissCount: 'Near-miss candidate count', noEligible: 'No consideration-eligible option candidate.',
    noNearMiss: 'No near-miss candidates.', strategy: 'Strategy', expiration: 'Expiration',
    dte: 'days to expiry', score: 'score', grade: 'grade', confidence: 'confidence',
    maxLoss: 'max loss', maxProfit: 'max profit', breakeven: 'breakeven',
    reasons: 'Reasons', noBaselines: 'No baseline data.',
    ivAssumption: 'No IV scenario was specified — analysis used an IV-unchanged assumption.',
    crrEvidenceOnly: 'CRR hybrid diagnostics are evidence-only and do not affect ranking or score.',
    scoreNotProbability: 'Score is not a probability or expected return; it is a comparative heuristic only.',
    deltaNotProbability: 'Delta is a Greek value, not a probability of profit.',
    noVolumeOi: 'Volume/open interest data is not part of this packet and is not inferred.',
    lowConfNote: (n) => `${n} candidate(s) are LOW confidence; these must be explicitly labeled as LOW.`,
    localGreekApprox: 'Scenario pricing is a local Greek approximation (LOCAL_GREEK_APPROXIMATION), not a full option pricing model.',
    scenarioWarning: (w) => `Scenario warning: ${w}`,
  },
};

const DICTS = { tr: TR, en: EN };

function resolveLocale(locale) {
  const requested = locale ?? 'tr';
  if (!SUPPORTED_LOCALES.includes(requested)) {
    throw new Error(`Unsupported locale "${requested}". Supported locales: ${SUPPORTED_LOCALES.join(', ')}.`);
  }
  return requested;
}

function formatCandidateLine(candidate, dict) {
  const l = dict.labels;
  const conf = candidate.confidence === 'LOW' ? `${l.confidence}: LOW` : `${l.confidence}: ${candidate.confidence ?? '—'}`;
  return [
    `${candidate.candidate_id}`,
    `${l.strategy}: ${candidate.strategy_type ?? '—'}`,
    candidate.expiration ? `${l.expiration}: ${candidate.expiration} (${candidate.days_to_expiry ?? '—'} ${l.dte})` : null,
    candidate.score != null ? `${l.score}: ${fmtNum(candidate.score)} (${l.grade}: ${candidate.grade ?? '—'})` : null,
    conf,
    candidate.max_loss != null ? `${l.maxLoss}: ${fmtNum(candidate.max_loss)}` : null,
    candidate.max_profit != null ? `${l.maxProfit}: ${fmtNum(candidate.max_profit)}` : null,
    candidate.breakeven != null ? `${l.breakeven}: ${fmtNum(candidate.breakeven)}` : null,
  ].filter(Boolean).join(' | ');
}

function formatNearMissLine(candidate, dict) {
  const l = dict.labels;
  const reasons = Array.isArray(candidate.consideration_reasons) && candidate.consideration_reasons.length > 0
    ? candidate.consideration_reasons.join('; ')
    : '—';
  const conf = candidate.confidence === 'LOW' ? `${l.confidence}: LOW` : `${l.confidence}: ${candidate.confidence ?? '—'}`;
  return [
    `${candidate.candidate_id}`,
    `${l.strategy}: ${candidate.strategy_type ?? '—'}`,
    candidate.score != null ? `${l.score}: ${fmtNum(candidate.score)}` : null,
    conf,
    `${l.reasons}: ${reasons}`,
  ].filter(Boolean).join(' | ');
}

function collectScenarioWarnings(candidates) {
  const warnings = new Set();
  for (const c of candidates) {
    const results = c.scenario_results;
    if (!results) continue;
    for (const key of ['downside', 'base', 'upside']) {
      for (const w of results[key]?.warnings ?? []) warnings.add(w);
    }
  }
  return [...warnings];
}

/**
 * @param {object} packet - the object returned by analyzeDirectional().
 * @param {object} [options]
 * @param {'tr'|'en'} [options.locale='tr']
 * @param {number} [options.maxCandidates=3]
 */
export function formatOptionsAnalysisForUser(packet, options = {}) {
  const locale = resolveLocale(options.locale);
  const maxCandidates = Number.isFinite(options.maxCandidates) && options.maxCandidates > 0
    ? options.maxCandidates
    : DEFAULT_MAX_CANDIDATES;
  const dict = DICTS[locale];
  const l = dict.labels;

  const ues = packet.user_explanation_summary ?? null;
  const decisionState = ues?.decision_state ?? packet.ranking?.decision_state ?? null;
  const isTradeAvailable = decisionState === 'TRADE_CANDIDATES_AVAILABLE';

  const allowedIds = new Set(packet.ai_contract?.allowed_candidate_ids ?? []);
  const topCandidates = Array.isArray(packet.top_candidates) ? packet.top_candidates : [];
  const nearMissCandidates = Array.isArray(packet.near_miss_candidates) ? packet.near_miss_candidates : [];
  const baselines = Array.isArray(packet.baselines) ? packet.baselines : [];

  const eligibleCandidates = topCandidates
    .filter(c => c.consideration_eligible && allowedIds.has(c.candidate_id))
    .slice(0, maxCandidates);
  const allowedNearMisses = nearMissCandidates
    .filter(c => allowedIds.has(c.candidate_id))
    .slice(0, maxCandidates);

  const eligibleCount = ues?.eligible_candidate_count
    ?? topCandidates.filter(c => c.consideration_eligible && allowedIds.has(c.candidate_id)).length;
  const lowConfidenceCount = ues?.low_confidence_candidate_count
    ?? [...topCandidates, ...nearMissCandidates].filter(c => c.confidence === 'LOW' && allowedIds.has(c.candidate_id)).length;
  const nearMissCount = ues?.near_miss_count ?? nearMissCandidates.length;

  // Section 1 — Senin Varsayımın / Your Assumption
  const thesisLines = [
    `${l.symbol}: ${packet.symbol ?? '—'}`,
    `${l.direction}: ${dict.direction[packet.direction] ?? packet.direction ?? '—'}`,
    `${l.horizon}: ${packet.horizon_days ?? '—'}`,
    `${l.currentPrice}: ${fmtNum(packet.underlying_price)}`,
    `${l.targetPrice}: ${fmtNum(packet.thesis?.base_target_price)}`,
    `${l.expectedMove}: ${fmtPct(packet.thesis?.expected_move_pct)} (${fmtNum(packet.thesis?.expected_move_absolute)})`,
  ];

  // Section 2 — Motorun Sonucu / Engine's Result
  const engineResultLines = [
    `${l.decisionState}: ${decisionState ?? '—'} — ${dict.decisionState[decisionState] ?? ''}`.trim(),
    `${l.eligibleCount}: ${eligibleCount}`,
    `${l.lowConfCount}: ${lowConfidenceCount}`,
    `${l.nearMissCount}: ${nearMissCount}`,
  ];

  // Section 3 — eligible_candidates (TRADE_CANDIDATES_AVAILABLE) or near_misses (NO_TRADE_BASELINE_ONLY)
  let candidateSection;
  if (isTradeAvailable) {
    candidateSection = {
      id: 'eligible_candidates',
      title: dict.sectionTitles.eligible_candidates,
      lines: eligibleCandidates.length > 0
        ? eligibleCandidates.map(c => formatCandidateLine(c, dict))
        : [l.noEligible],
    };
  } else {
    candidateSection = {
      id: 'near_misses',
      title: dict.sectionTitles.near_misses,
      lines: allowedNearMisses.length > 0
        ? allowedNearMisses.map(c => formatNearMissLine(c, dict))
        : [l.noNearMiss],
    };
  }

  // Section 4 — Baseline Karşılaştırması / Baseline Comparison
  const baselineLines = baselines.length > 0
    ? baselines.map(b => [
      `${b.strategy_type}`,
      b.score != null ? `${l.score}: ${fmtNum(b.score)} (${l.grade}: ${b.grade ?? '—'})` : null,
      `${l.confidence}: ${b.confidence ?? '—'}`,
      `consideration_eligible: ${b.consideration_eligible ? 'true' : 'false'}`,
    ].filter(Boolean).join(' | '))
    : [l.noBaselines];

  // Section 5 — Varsayımlar ve Riskler / Assumptions and Risks
  const assumptionsRiskLines = [];
  assumptionsRiskLines.push(l.scoreNotProbability);
  assumptionsRiskLines.push(l.deltaNotProbability);
  assumptionsRiskLines.push(l.noVolumeOi);
  assumptionsRiskLines.push(l.localGreekApprox);
  if (!isTradeAvailable) {
    assumptionsRiskLines.push(dict.decisionState.NO_TRADE_BASELINE_ONLY);
  }
  if (lowConfidenceCount > 0) {
    assumptionsRiskLines.push(l.lowConfNote(lowConfidenceCount));
  }
  const ivWarningPresent = (packet.data_source?.warnings ?? []).includes('IV_SCENARIO_NOT_SPECIFIED');
  if (ivWarningPresent) {
    assumptionsRiskLines.push(l.ivAssumption);
  }
  const crrStatus = packet.diagnostics?.crr_hybrid_policy?.status ?? 'NOT_REQUESTED';
  if (crrStatus === 'AVAILABLE') {
    assumptionsRiskLines.push(l.crrEvidenceOnly);
  }
  const relevantCandidatesForWarnings = isTradeAvailable ? eligibleCandidates : allowedNearMisses;
  for (const w of collectScenarioWarnings(relevantCandidatesForWarnings)) {
    assumptionsRiskLines.push(l.scenarioWarning(w));
  }

  return {
    version: FORMAT_VERSION,
    locale,
    sections: [
      { id: 'thesis_assumption', title: dict.sectionTitles.thesis_assumption, lines: thesisLines },
      { id: 'engine_result', title: dict.sectionTitles.engine_result, lines: engineResultLines },
      candidateSection,
      { id: 'baselines', title: dict.sectionTitles.baselines, lines: baselineLines },
      { id: 'assumptions_and_risks', title: dict.sectionTitles.assumptions_and_risks, lines: assumptionsRiskLines },
    ],
    safety: {
      source: 'deterministic_formatter',
      numeric_source_of_truth: packet.ai_contract?.numeric_source_of_truth ?? null,
      allowed_candidate_ids_checked: true,
      contains_investment_advice_language: false,
    },
  };
}

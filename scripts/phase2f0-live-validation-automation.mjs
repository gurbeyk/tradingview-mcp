// Phase 2F.0 — live validation automation runner.
//
// Runs the same guarded CRR diagnostic path used by options_analyze_directional
// and writes reusable evidence. This is intentionally a manual runner for now:
// it does not schedule itself and does not change production server behavior.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getKeyStats } from '../src/core/data.js';
import { analyzeDirectional } from '../src/core/options/directionalAnalysis.js';
import {
  LIVE_VALIDATION_PROFILES,
  aggregateLiveValidationResults,
  buildSpotAwareValidationRequest,
  evaluateLiveValidationSummary,
  summarizeAnalysisPacket,
} from '../src/core/options/liveValidationAutomation.js';

const SYMBOLS = (process.env.PHASE2F_SYMBOLS ?? 'NASDAQ:NVDA,NASDAQ:AAPL,NASDAQ:PANW')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const PROFILE_IDS = (process.env.PHASE2F_PROFILES ?? 'BULLISH_BASELINE_30D,BEARISH_ELIGIBLE_60_90D')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OUTPUT_DIR = process.env.PHASE2F_OUTPUT_DIR ?? `docs/fixtures/phase2f0-live-validation-automation-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

async function runOne(symbol, profileId) {
  const profile = LIVE_VALIDATION_PROFILES[profileId];
  if (!profile) throw new Error(`Unknown Phase 2F validation profile: ${profileId}`);
  const keyStats = await getKeyStats({ symbol });
  if (!Number.isFinite(keyStats.price)) throw new Error(`Could not resolve spot for ${symbol}`);
  const request = buildSpotAwareValidationRequest({ symbol, spot: keyStats.price, profile });
  const packet = await analyzeDirectional(request);
  const summary = summarizeAnalysisPacket(packet, { profileId });
  const acceptance = evaluateLiveValidationSummary(summary);
  return { symbol, profile_id: profileId, request, summary, acceptance, packet };
}

async function runOneSafe(symbol, profileId) {
  try {
    return await runOne(symbol, profileId);
  } catch (err) {
    const summary = {
      profile_id: profileId,
      symbol,
      analysis_snapshot_id: null,
      decision_state: null,
      diagnostics_status: 'ERROR',
      diagnostics_mode: null,
      market_input_modes: [],
      market_input_warnings: [],
      borrow_sources: [],
      top5_strategy_types: [],
      error: err.message,
    };
    return {
      symbol,
      profile_id: profileId,
      request: null,
      summary,
      acceptance: evaluateLiveValidationSummary(summary),
      packet: null,
      error: err.message,
    };
  }
}

const startedAt = new Date().toISOString();
const runs = [];
for (const profileId of PROFILE_IDS) {
  for (const symbol of SYMBOLS) {
    runs.push(await runOneSafe(symbol, profileId));
  }
}

const report = {
  phase: 'Phase 2F.0 Live Validation Automation',
  status: 'MANUAL_RUNNER_NO_PRODUCTION_SCHEDULER',
  started_at_utc: startedAt,
  completed_at_utc: new Date().toISOString(),
  symbols: SYMBOLS,
  profiles: PROFILE_IDS,
  aggregate: aggregateLiveValidationResults(runs),
  runs,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const output = join(OUTPUT_DIR, 'phase2f0-live-validation-automation.json');
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  started_at_utc: report.started_at_utc,
  completed_at_utc: report.completed_at_utc,
  aggregate: report.aggregate,
  runs: runs.map(run => ({
    symbol: run.symbol,
    profile_id: run.profile_id,
    passed: run.acceptance.passed,
    failed: run.acceptance.failed,
    decision_state: run.summary.decision_state,
    diagnostics_status: run.summary.diagnostics_status,
    market_input_modes: run.summary.market_input_modes,
    top5_strategy_types: run.summary.top5_strategy_types,
    error: run.error ?? null,
  })),
}, null, 2));

process.exit(report.aggregate.failed_runs === 0 ? 0 : 1);

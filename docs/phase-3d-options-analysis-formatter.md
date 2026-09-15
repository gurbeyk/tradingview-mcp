# Phase 3D — Options Analysis User Formatter

## What this is

`formatOptionsAnalysisForUser(packet, options)` in
`src/core/options/optionsAnalysisFormatter.js` is a deterministic, non-AI
formatter that turns an `analyzeDirectional()` packet into short,
locale-specific, human-readable sections. It performs **no ranking,
scoring, pricing, or scenario math** — it only reads values already present
on the packet and applies trivial display formatting (rounding, locale
text). It is a renderer, not a second opinion, and it never changes what
the underlying engine decided.

It is a plain export — it does not change the shape of
`options_analyze_directional`'s existing tool response.

## Usage

```js
import { formatOptionsAnalysisForUser } from './src/core/options/optionsAnalysisFormatter.js';

const packet = await analyzeDirectional(req);
const formatted = formatOptionsAnalysisForUser(packet, { locale: 'tr', maxCandidates: 3 });
```

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `locale` | `"tr" \| "en"` | `"tr"` | Unsupported locales throw an explicit `Error` (matches this repo's fail-loud style — see `validateRequiredInputs` in `directionalAnalysis.js`), rather than silently falling back. |
| `maxCandidates` | `number` | `3` | Caps how many eligible/near-miss candidates are rendered. Does not affect the underlying packet or which candidates are eligible. |

## Output shape

```js
{
  version: "OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1",
  locale: "tr",
  sections: [
    { id: "thesis_assumption", title: "Senin Varsayımın", lines: [...] },
    { id: "engine_result", title: "Motorun Sonucu", lines: [...] },
    // id is "eligible_candidates" for TRADE_CANDIDATES_AVAILABLE,
    // "near_misses" for NO_TRADE_BASELINE_ONLY — never both.
    { id: "eligible_candidates" /* or "near_misses" */, title: "...", lines: [...] },
    { id: "baselines", title: "Baseline Karşılaştırması", lines: [...] },
    { id: "assumptions_and_risks", title: "Varsayımlar ve Riskler", lines: [...] },
  ],
  safety: {
    source: "deterministic_formatter",
    numeric_source_of_truth: packet.ai_contract.numeric_source_of_truth,
    allowed_candidate_ids_checked: true,
    contains_investment_advice_language: false,
  },
}
```

## Safety rules enforced

- **Candidate gating**: every rendered `candidate_id` is checked against
  `packet.ai_contract.allowed_candidate_ids` before being printed — a
  candidate present on `top_candidates`/`near_miss_candidates` but missing
  from `allowed_candidate_ids` (should never happen from a real packet, but
  is defended against) is silently dropped, never rendered.
- **No new numbers**: every numeric value shown (score, grade, max loss/profit,
  breakeven, expected move, etc.) is read directly off the packet. The only
  transformation applied is `Math.round(v * 100) / 100` for display and
  locale-appropriate `%` formatting — no recalculation.
- **NO_TRADE_BASELINE_ONLY**: rendered as "no candidate passed the
  consideration gates," never softened into a recommendation. Near-miss
  candidates are rendered only in a "why eliminated" section using their
  existing `consideration_reasons` — never promoted into eligibility.
- **TRADE_CANDIDATES_AVAILABLE**: eligible candidates are described as
  "candidates the engine found consideration-eligible" — no recommendation,
  "buy," "best trade," or "safe trade" language anywhere in the vocabulary.
- **LOW confidence**: any candidate with `confidence === 'LOW'` is labeled
  `LOW` explicitly on its line, and the risks section always states the
  LOW-confidence count when non-zero.
- **CRR diagnostics**: when `diagnostics.crr_hybrid_policy.status ===
  'AVAILABLE'`, the risks section states the diagnostic is evidence-only and
  does not affect ranking/score. Per-candidate CRR `action` codes (e.g.
  `HYBRID_REPRICE_CANDIDATE`) are never rendered as candidate-level text, so
  they cannot be read as a trade recommendation.
- **IV assumption**: when `data_source.warnings` contains
  `IV_SCENARIO_NOT_SPECIFIED`, the risks section states that IV was held
  unchanged as an analysis assumption, not a forecast.
- **Score/delta**: the risks section always states that score is not a
  probability/expected return and delta is not a probability of profit.
- **Volume/OI**: the risks section always states that volume/open interest
  is not part of this packet and is not inferred.
- **Purity**: the formatter never mutates its `packet` argument (verified by
  a dedicated unit test — see below).

## Tests

`tests/options_analysis_formatter.test.js` (registered in both
`npm run test:unit` and `npm run test:all`), covering:

1. `NO_TRADE_BASELINE_ONLY` packet → safe Turkish sections.
2. `TRADE_CANDIDATES_AVAILABLE` packet → eligible candidates gated by
   `allowed_candidate_ids`.
3. A candidate_id outside `allowed_candidate_ids` is never printed.
4. LOW confidence is explicitly labeled, both per-candidate and in the risks
   summary count.
5. CRR diagnostics `AVAILABLE` → evidence-only/no-ranking-effect language
   present.
6. A `HYBRID_REPRICE_CANDIDATE` CRR action is never framed as a
   recommendation (its raw code is not even rendered).
7. `IV_SCENARIO_NOT_SPECIFIED` → IV-unchanged analysis-assumption language
   present.
8. Output never contains investment-advice language (TR and EN wordlists
   checked, in both decision states).
9. An unsupported locale throws a clear `Error`.
10. The formatter does not mutate its input packet.

Plus supporting tests for the `"en"` locale opt-in, `maxCandidates`, and the
`safety` block echoing `ai_contract.numeric_source_of_truth` verbatim.

## Relationship to `agent_response_guidance` / `ai_contract`

This formatter is a convenience renderer, not a replacement for the binding
safety contract. `packet.ai_contract` and `packet.agent_response_guidance`
remain the authoritative rules for any agent or UI explaining this packet
to a user — see the "OPTIONS COPILOT OPERATING STANDARD" section of
`CLAUDE.md`. If `formatOptionsAnalysisForUser`'s output is available, it can
be preferred as a starting point for the user-facing explanation, but it
does not loosen or replace `ai_contract`/`agent_response_guidance`.

# Phase 3E — Optional Formatted Options Response

## What this is

`options_analyze_directional` (`src/tools/optionsAnalysis.js` →
`analyzeDirectional` in `src/core/options/directionalAnalysis.js`) now
accepts three optional inputs that, when opted into, attach a
`result.formatted_response` field — a deterministic, non-AI, locale-rendered
summary of the same packet, produced by Phase 3D's
`formatOptionsAnalysisForUser` (`src/core/options/optionsAnalysisFormatter.js`).

This is strictly **opt-in and backward compatible**: the default behavior of
`options_analyze_directional` is completely unchanged, and existing callers
that don't pass the new fields see no difference in the response shape.

## New inputs

| Field | Type | Default | Notes |
|---|---|---|---|
| `include_formatted_response` | `boolean` | `false` | When `true`, attaches `result.formatted_response`. When `false` or omitted, the field is **absent entirely** — not `null` — so existing JSON-shape assumptions (e.g. `JSON.stringify` snapshots, strict schema checks) are unaffected. |
| `formatted_response_locale` | `"tr" \| "en"` | `"tr"` | Passed straight through to `formatOptionsAnalysisForUser`. An unsupported value throws a clear `Error` before any network/chain call is made (fail-fast, matching this file's existing `validateRequiredInputs` style). |
| `formatted_response_max_candidates` | `number` | `3` | Must be a finite number `>= 1`; `0`, negative, or non-finite values throw a clear `Error`. Passed straight through as `maxCandidates`. |

These three fields are also echoed on `input_echo` (`include_formatted_response`,
`formatted_response_locale`, `formatted_response_max_candidates`) alongside the
other normalized inputs, for consistency with the rest of the packet's
provenance contract.

## Where it's implemented

Attached in **`src/core/options/directionalAnalysis.js`** (the core
orchestrator), not in the thin MCP tool wrapper
(`src/tools/optionsAnalysis.js`), for two reasons:

1. **Testability.** `analyzeDirectional` already has an extensive,
   network-free test suite driven entirely by injected
   `deps` (`getOptionChain`/`getKeyStats`/etc. — see
   `tests/directional_analysis.test.js`). The MCP tool wrapper has no such
   deps-injection seam and no existing test file; testing there would mean
   either hitting live TradingView or building new mock-server
   infrastructure just for this feature. Testing in the core module reuses
   the existing, proven pattern.
2. **No packet bloat by default.** Because the flag defaults to `false` and
   the field is genuinely omitted (not `null`) unless requested, attaching
   it inside the orchestrator does not enlarge the default packet shape for
   any existing caller — the concern that motivated preferring the tool
   wrapper in the first place doesn't actually apply once the field is
   proven opt-in.

Validation (`resolveFormattedResponseOptions`) runs immediately after
`validateRequiredInputs`, before any chain/key-stats fetch — an invalid
locale or `max_candidates` fails fast without wasting a network round-trip.

The formatted response itself is built **after** the full packet (`result`)
is assembled, by calling `formatOptionsAnalysisForUser(result, { locale,
maxCandidates })` — i.e. it is a pure render of the exact same packet a
caller without the flag would receive. It cannot see or influence anything
upstream of it (candidate generation, scenario repricing, ranking, CRR
diagnostics) because those have already fully executed by the time it runs.

## Contract guarantees

- **No AI/LLM.** `formatOptionsAnalysisForUser` performs no model calls —
  see Phase 3D (`docs/phase-3d-options-analysis-formatter.md`).
- **No ranking/scoring/eligibility/CRR change.** `formatted_response` is
  computed strictly after `ranking`, `top_candidates`,
  `diagnostics.crr_hybrid_policy`, etc. are finalized; it only reads those
  values. A dedicated test (`tests/directional_analysis.test.js`, Phase 3E
  test 9) asserts `ranking`, `top_candidates`, and
  `diagnostics.crr_hybrid_policy` are byte-identical with and without
  `include_formatted_response: true`.
- **`allowed_candidate_ids` gated.** Same as Phase 3D — every candidate_id
  rendered inside `formatted_response` is checked against
  `ai_contract.allowed_candidate_ids`.

## Tests

Added to `tests/directional_analysis.test.js`, describe block "Phase 3E —
optional formatted_response":

1. Absent by default (backward compatible).
2. Present when `include_formatted_response: true`.
3. `formatted_response.version === 'OPTIONS_ANALYSIS_FORMATTED_RESPONSE_V1'`.
4. `formatted_response_locale` defaults to `"tr"`.
5. `formatted_response_locale: "en"` is honored.
6. `formatted_response_max_candidates` caps rendered candidates.
7. An invalid `formatted_response_locale` throws a clear error.
8. An invalid `formatted_response_max_candidates` (`0`, `-1`) throws a clear
   error.
9. Attaching `formatted_response` does not change `ranking`,
   `top_candidates`, or `diagnostics.crr_hybrid_policy`.
10. `include_formatted_response: false` leaves the field absent (not `null`).

Plus a supporting test that `formatted_response.safety.numeric_source_of_truth`
matches `ai_contract.numeric_source_of_truth`.

No existing tests were modified beyond appending this new block; nothing in
the pre-existing 390-test suite needed adjustment.

## Relationship to `ai_contract` / `agent_response_guidance`

`formatted_response` is a convenience, not a replacement for the packet's
binding safety contract. If a user wants a directly readable explanation,
`include_formatted_response: true` can be requested — but
`formatted_response` is not investment advice, and `ai_contract` /
`agent_response_guidance` remain the binding safety rules regardless of
whether the formatted response is requested or shown.

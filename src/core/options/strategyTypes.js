// Phase 0A — Deterministic Options Strategy Economics Engine.
//
// This module (and its siblings strategyEconomics.js / strategyCandidates.js)
// is a PURE domain layer: no TradingView, no CDP, no browser, no network,
// no LLM. It operates only on already-normalized option-chain contracts
// (the shape produced by options_get_chain) and explicit numeric requests.
//
// This separation exists so a future data provider (ThetaData, IBKR, etc.)
// can replace TradingView without rewriting any strategy math.

export const STRATEGY_TYPES = Object.freeze({
  LONG_CALL: 'LONG_CALL',
  LONG_PUT: 'LONG_PUT',
  BULL_CALL_SPREAD: 'BULL_CALL_SPREAD',
  BEAR_PUT_SPREAD: 'BEAR_PUT_SPREAD',
  BUY_STOCK: 'BUY_STOCK',
  NO_TRADE: 'NO_TRADE',
});

export const EXECUTION_MODELS = Object.freeze({
  CONSERVATIVE: 'conservative',
  MID: 'mid',
});

export const MAX_PROFIT_TYPES = Object.freeze({
  UNLIMITED: 'UNLIMITED',
  DEFINED: 'DEFINED',
});

export const BASELINE_TYPES = Object.freeze({
  UNDERLYING: 'UNDERLYING',
});

export const CHAIN_COMPLETENESS = Object.freeze({
  COMPLETE: 'COMPLETE',
  POSSIBLY_TRUNCATED: 'POSSIBLY_TRUNCATED',
});

export const PAYOFF_TYPES = Object.freeze({
  EXPIRATION_INTRINSIC: 'EXPIRATION_INTRINSIC',
});

// Rejection reasons — every discarded contract or candidate must carry one
// of these, and every rejection must be counted (never silently dropped).
export const REJECTION_REASONS = Object.freeze({
  CROSSED_MARKET: 'CROSSED_MARKET',
  MISSING_BID: 'MISSING_BID',
  MISSING_ASK: 'MISSING_ASK',
  INVALID_ASK: 'INVALID_ASK',
  MISSING_IV: 'MISSING_IV',
  MISSING_GREEKS: 'MISSING_GREEKS',
  WIDE_SPREAD: 'WIDE_SPREAD',
  SHORT_LEG_ZERO_BID: 'SHORT_LEG_ZERO_BID',
  EXPIRY_BEFORE_HORIZON: 'EXPIRY_BEFORE_HORIZON',
  OUTSIDE_DTE_WINDOW: 'OUTSIDE_DTE_WINDOW',
  DELTA_OUT_OF_RANGE: 'DELTA_OUT_OF_RANGE',
  STRIKE_ORDER_INVALID: 'STRIKE_ORDER_INVALID',
  WIDTH_EXCEEDED: 'WIDTH_EXCEEDED',
  NON_POSITIVE_DEBIT: 'NON_POSITIVE_DEBIT',
  MAX_LOSS_EXCEEDED: 'MAX_LOSS_EXCEEDED',
  INSUFFICIENT_CAPITAL_FOR_SHARE: 'INSUFFICIENT_CAPITAL_FOR_SHARE',
});

export const CONTRACT_MULTIPLIER_SOURCE = Object.freeze({
  ASSUMED_STANDARD_US_EQUITY_OPTION: 'ASSUMED_STANDARD_US_EQUITY_OPTION',
});

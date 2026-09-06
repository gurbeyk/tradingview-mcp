/**
 * Regression coverage for the news-mediator batch-news sorting rule: the
 * upstream news-flow endpoint returns HTTP 400 ("filter values must be
 * sorted") unless the comma-joined symbol filter is byte-sorted. Found via
 * live probing (unsorted BIST:THYAO,BIST:ASELS,BIST:GARAN -> 400; sorted ->
 * 200). normalizeBatchSymbols() is the single choke point that guarantees
 * every getBatchNews() call is sorted, deduped, and cleaned before it ever
 * reaches the request builder.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatchSymbols } from '../src/core/data.js';

describe('normalizeBatchSymbols', () => {
  it('sorts symbols alphabetically regardless of input order', () => {
    const result = normalizeBatchSymbols(['BIST:THYAO', 'BIST:ASELS', 'BIST:GARAN']);
    assert.deepEqual(result, ['BIST:ASELS', 'BIST:GARAN', 'BIST:THYAO']);
  });

  it('sorts mixed-market symbols the same way the upstream filter requires', () => {
    const result = normalizeBatchSymbols(['NASDAQ:NVDA', 'BIST:THYAO']);
    assert.deepEqual(result, ['BIST:THYAO', 'NASDAQ:NVDA']);
  });

  it('removes duplicates, including case-insensitive duplicates', () => {
    const result = normalizeBatchSymbols(['NASDAQ:NVDA', 'nasdaq:nvda', 'NASDAQ:MRVL', 'NASDAQ:NVDA']);
    assert.deepEqual(result, ['NASDAQ:MRVL', 'NASDAQ:NVDA']);
  });

  it('trims whitespace and drops blank/null entries', () => {
    const result = normalizeBatchSymbols([' NASDAQ:MU ', '', null, undefined, 'NASDAQ:MU']);
    assert.deepEqual(result, ['NASDAQ:MU']);
  });

  it('returns an empty array for no input', () => {
    assert.deepEqual(normalizeBatchSymbols([]), []);
    assert.deepEqual(normalizeBatchSymbols(undefined), []);
  });
});

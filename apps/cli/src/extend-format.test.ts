import { describe, expect, it } from 'vitest';
import type { PreparedExtension } from '@keepalive/core';
import { formatOutcomes, formatPrepared, formatXlm } from './extend-format.js';

describe('formatXlm', () => {
  it('turns stroops into XLM', () => {
    expect(formatXlm(10_000_000)).toBe('1.0000000 XLM');
    expect(formatXlm(146_323)).toBe('0.0146323 XLM');
  });
});

describe('formatPrepared', () => {
  it('states the count, the maximum cost and the ceiling', () => {
    const prepared = {
      transactions: [{}, {}],
      maxFeesStroops: [100, 200],
      totalMaxFeeStroops: 300,
      entryCount: 3,
    } as unknown as PreparedExtension;
    const text = formatPrepared(prepared, 500_000, 1000);
    expect(text).toContain('2 transaction(s)');
    expect(text).toContain('3 entries');
    expect(text).toContain('300 stroops');
    expect(text).toContain('ceiling of 1000 stroops');
  });
});

describe('formatOutcomes', () => {
  it('lists each transaction and the total charged', () => {
    const text = formatOutcomes([
      { index: 0, entryCount: 2, hash: 'aaa', feeChargedStroops: 100 },
      { index: 1, entryCount: 1, hash: 'bbb', feeChargedStroops: 50 },
    ]);
    expect(text).toContain('transaction 1: 2 entries, charged 100 stroops, tx aaa');
    expect(text).toContain('Total charged: 150 stroops');
  });
});

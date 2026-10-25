import { describe, expect, it } from 'vitest';
import { classifyBand } from './bands.js';

const thresholds = { expiringSoon: 1000, critical: 100 };
const base = { kind: 'persistent' as const, latestLedger: 5000, thresholds };

describe('classifyBand', () => {
  it('returns healthy when plenty of ledgers remain', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 7000 })).toBe('healthy');
  });

  it('returns healthy exactly at the expiringSoon threshold', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 6000 })).toBe('healthy');
  });

  it('returns expiring_soon just below the expiringSoon threshold', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 5999 })).toBe('expiring_soon');
  });

  it('returns critical just below the critical threshold', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 5099 })).toBe('critical');
  });

  it('treats liveUntilLedger equal to the latest ledger as still live', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 5000 })).toBe('critical');
  });

  it('returns archived for an expired persistent entry', () => {
    expect(classifyBand({ ...base, liveUntilLedger: 4999 })).toBe('archived');
  });

  it('returns archived for an expired instance entry', () => {
    expect(
      classifyBand({ ...base, kind: 'instance', liveUntilLedger: 10 }),
    ).toBe('archived');
  });

  it('returns deleted for an expired temporary entry', () => {
    expect(
      classifyBand({ ...base, kind: 'temporary', liveUntilLedger: 4999 }),
    ).toBe('deleted');
  });

  it('returns not_found when the RPC returned no entry', () => {
    expect(classifyBand({ ...base, liveUntilLedger: null })).toBe('not_found');
  });

  it('rejects thresholds where critical exceeds expiringSoon', () => {
    expect(() =>
      classifyBand({
        ...base,
        liveUntilLedger: 7000,
        thresholds: { expiringSoon: 100, critical: 1000 },
      }),
    ).toThrow(RangeError);
  });
});

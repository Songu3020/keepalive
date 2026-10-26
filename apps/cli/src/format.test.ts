import type { EntryBand, EntryTtl } from '@keepalive/core';
import { describe, expect, it } from 'vitest';
import { countByBand, formatRemaining, formatReport } from './format.js';

function entry(partial: Partial<EntryTtl> & { band: EntryBand }): EntryTtl {
  return {
    contractId: 'CTEST',
    kind: 'persistent',
    ledgerKeyXdr: 'AAAA',
    keyHash: 'abcdef0123456789abcdef',
    source: 'hubble',
    liveUntilLedger: 1_000_000,
    latestLedger: 900_000,
    ...partial,
  };
}

describe('formatRemaining', () => {
  it('shows days for a long time left', () => {
    // 17,280 ledgers per day, so 172,800 ledgers is 10 days
    expect(formatRemaining(entry({ band: 'healthy', liveUntilLedger: 1_072_800 }))).toBe('10.0 days');
  });

  it('shows hours when less than a day is left', () => {
    // 720 ledgers is one hour
    expect(formatRemaining(entry({ band: 'critical', liveUntilLedger: 900_720 }))).toBe('1.0 hours');
  });

  it('shows expired and not found', () => {
    expect(formatRemaining(entry({ band: 'archived', liveUntilLedger: 899_000 }))).toBe('expired');
    expect(formatRemaining(entry({ band: 'not_found', liveUntilLedger: null }))).toBe('not found');
  });
});

describe('countByBand', () => {
  it('counts each band', () => {
    const counts = countByBand([
      entry({ band: 'healthy' }),
      entry({ band: 'healthy' }),
      entry({ band: 'critical' }),
    ]);
    expect(counts.healthy).toBe(2);
    expect(counts.critical).toBe(1);
    expect(counts.archived).toBe(0);
  });
});

describe('formatReport', () => {
  it('lists the soonest entries first and hides empty bands', () => {
    const report = formatReport(
      'CTEST',
      [
        entry({ band: 'healthy', liveUntilLedger: 2_000_000, keyHash: 'aaaaaaaaaaaaaaaa' }),
        entry({ band: 'critical', liveUntilLedger: 900_100, keyHash: 'bbbbbbbbbbbbbbbb' }),
      ],
      10,
    );
    expect(report).toContain('2 entries');
    expect(report).not.toContain('archived');
    expect(report.indexOf('bbbbbbbbbbbb')).toBeLessThan(report.indexOf('aaaaaaaaaaaa'));
  });

  it('says how many entries were left out of the list', () => {
    const many = Array.from({ length: 5 }, () => entry({ band: 'healthy' }));
    expect(formatReport('CTEST', many, 2)).toContain('and 3 more');
  });

  it('handles a contract with no entries', () => {
    expect(formatReport('CTEST', [], 10)).toBe('Contract CTEST: 0 entries');
  });
});
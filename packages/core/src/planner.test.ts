import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BATCH_SIZE,
  planExtensions,
  type NetworkLimits,
  type PlanPolicy,
} from './planner.js';
import type { EntryBand, EntryTtl } from './types.js';

const LATEST = 1_000_000;
const limits: NetworkLimits = { maxEntryTtl: 3_000_000, maxEntriesPerTransaction: 200 };
const policy: PlanPolicy = { extendToLedgers: 500_000 };

let counter = 0;
/** An entry that will expire `remaining` ledgers after LATEST. */
function entry(band: EntryBand, remaining: number | null): EntryTtl {
  counter += 1;
  return {
    contractId: 'CTEST',
    kind: 'persistent',
    ledgerKeyXdr: `key-${counter}`,
    keyHash: `hash-${counter}`,
    source: 'explicit',
    liveUntilLedger: remaining === null ? null : LATEST + remaining,
    latestLedger: LATEST,
    band,
  };
}

describe('planExtensions', () => {
  it('extends expiring_soon and critical entries and skips healthy ones', () => {
    const soon = entry('expiring_soon', 100_000);
    const critical = entry('critical', 1_000);
    const healthy = entry('healthy', 900_000);
    const plan = planExtensions([soon, critical, healthy], limits, policy);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.entries).toEqual([critical, soon]);
    expect(plan.skipped).toEqual([{ entry: healthy, reason: 'healthy' }]);
  });

  it('puts the soonest-expiring entries in the first batch', () => {
    const a = entry('expiring_soon', 300_000);
    const b = entry('critical', 10);
    const c = entry('expiring_soon', 200_000);
    const plan = planExtensions([a, b, c], limits, { ...policy, maxBatchSize: 2 });
    expect(plan.batches.map((batch) => batch.entries)).toEqual([[b, c], [a]]);
  });

  it('skips entries that cannot be extended and says why', () => {
    const archived = entry('archived', -50);
    const deleted = entry('deleted', null);
    const missing = entry('not_found', null);
    const plan = planExtensions([archived, deleted, missing], limits, policy);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['needs_restore', 'deleted', 'not_found']);
  });

  it('skips an entry that already has more time than the target', () => {
    const long = entry('expiring_soon', 600_000);
    const plan = planExtensions([long], limits, policy);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toEqual([{ entry: long, reason: 'already_long_enough' }]);
  });

  it('splits entries into batches of the requested size', () => {
    const entries = Array.from({ length: 5 }, () => entry('critical', 100));
    const plan = planExtensions(entries, limits, { ...policy, maxBatchSize: 2 });
    expect(plan.batches.map((batch) => batch.entries.length)).toEqual([2, 2, 1]);
  });

  it('never makes a batch larger than the network allows', () => {
    const entries = Array.from({ length: 12 }, () => entry('critical', 100));
    const tight: NetworkLimits = { ...limits, maxEntriesPerTransaction: 5 };
    const plan = planExtensions(entries, tight, { ...policy, maxBatchSize: 500 });
    expect(plan.batches.map((batch) => batch.entries.length)).toEqual([5, 5, 2]);
  });

  it('uses a conservative default batch size', () => {
    const entries = Array.from({ length: DEFAULT_MAX_BATCH_SIZE + 1 }, () => entry('critical', 100));
    const plan = planExtensions(entries, limits, policy);
    expect(plan.batches.map((batch) => batch.entries.length)).toEqual([DEFAULT_MAX_BATCH_SIZE, 1]);
  });

  it('lowers extendTo to fit the network maximum and says so', () => {
    const e = entry('critical', 100);
    const plan = planExtensions([e], limits, { extendToLedgers: 9_000_000 });
    expect(plan.extendTo).toBe(limits.maxEntryTtl - 1);
    expect(plan.clamped).toBe(true);
    expect(plan.batches[0]?.extendTo).toBe(limits.maxEntryTtl - 1);
  });

  it('does not report clamping when the target fits', () => {
    const plan = planExtensions([], limits, policy);
    expect(plan.extendTo).toBe(500_000);
    expect(plan.clamped).toBe(false);
    expect(plan.batches).toEqual([]);
  });

  it('rejects nonsense settings', () => {
    expect(() => planExtensions([], limits, { extendToLedgers: 0 })).toThrow(RangeError);
    expect(() => planExtensions([], limits, { extendToLedgers: 1.5 })).toThrow(RangeError);
    expect(() => planExtensions([], { ...limits, maxEntryTtl: 0 }, policy)).toThrow(RangeError);
    expect(() => planExtensions([], limits, { ...policy, maxBatchSize: -1 })).toThrow(RangeError);
  });
});
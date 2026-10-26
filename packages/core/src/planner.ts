import type { EntryTtl } from './types.js';

/** Limits the network enforces. Read them from the network at runtime; never hardcode. */
export interface NetworkLimits {
  /** longest an entry may live, in ledgers from now (from the state-archival settings) */
  maxEntryTtl: number;
  /** most entries one transaction may carry */
  maxEntriesPerTransaction: number;
}

export interface PlanPolicy {
  /** extend each entry so it has at least this many ledgers left */
  extendToLedgers: number;
  /** most entries to put in one transaction (the network limit still applies) */
  maxBatchSize?: number;
}

export interface PlannedBatch {
  /** the extendTo value for this transaction: minimum ledgers left after extending */
  extendTo: number;
  entries: EntryTtl[];
}

export type SkipReason = 'healthy' | 'needs_restore' | 'deleted' | 'not_found' | 'already_long_enough';

export interface SkippedEntry {
  entry: EntryTtl;
  reason: SkipReason;
}

export interface ExtendPlan {
  /** the extendTo actually used, after applying the network maximum */
  extendTo: number;
  /** true when the requested extendTo was lowered to fit the network maximum */
  clamped: boolean;
  batches: PlannedBatch[];
  skipped: SkippedEntry[];
}

/**
 * Experiment E3 only tested batches of 4 entries. The network allows 200 on
 * testnet, but size limits on the whole transaction may bite first. Keep this
 * conservative until a stress test shows how large a batch can safely be.
 */
export const DEFAULT_MAX_BATCH_SIZE = 50;

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive whole number, got ${value}`);
  }
}

/**
 * Decides which entries to extend and how to group them into transactions.
 * It never talks to the network and never signs anything.
 *
 * Only live entries in the 'expiring_soon' and 'critical' bands are extended.
 * Archived entries need a restore first, so they are skipped, not extended.
 */
export function planExtensions(
  entries: readonly EntryTtl[],
  limits: NetworkLimits,
  policy: PlanPolicy,
): ExtendPlan {
  requirePositiveInteger('extendToLedgers', policy.extendToLedgers);
  requirePositiveInteger('maxEntryTtl', limits.maxEntryTtl);
  requirePositiveInteger('maxEntriesPerTransaction', limits.maxEntriesPerTransaction);
  const requestedBatch = policy.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  requirePositiveInteger('maxBatchSize', requestedBatch);

  // The longest an entry can have left right after an extension is maxEntryTtl - 1.
  const ceiling = limits.maxEntryTtl - 1;
  const extendTo = Math.min(policy.extendToLedgers, ceiling);
  const batchSize = Math.min(requestedBatch, limits.maxEntriesPerTransaction);

  const skipped: SkippedEntry[] = [];
  const due: Array<{ entry: EntryTtl; remaining: number }> = [];

  for (const entry of entries) {
    switch (entry.band) {
      case 'healthy':
        skipped.push({ entry, reason: 'healthy' });
        break;
      case 'archived':
        skipped.push({ entry, reason: 'needs_restore' });
        break;
      case 'deleted':
        skipped.push({ entry, reason: 'deleted' });
        break;
      case 'not_found':
        skipped.push({ entry, reason: 'not_found' });
        break;
      case 'expiring_soon':
      case 'critical': {
        if (entry.liveUntilLedger === null) {
          skipped.push({ entry, reason: 'not_found' });
          break;
        }
        const remaining = entry.liveUntilLedger - entry.latestLedger;
        if (remaining >= extendTo) {
          skipped.push({ entry, reason: 'already_long_enough' });
        } else {
          due.push({ entry, remaining });
        }
        break;
      }
    }
  }

  // Put the entries closest to expiring in the first transaction.
  due.sort((a, b) => a.remaining - b.remaining);

  const batches: PlannedBatch[] = [];
  for (let start = 0; start < due.length; start += batchSize) {
    batches.push({
      extendTo,
      entries: due.slice(start, start + batchSize).map((item) => item.entry),
    });
  }

  return { extendTo, clamped: extendTo < policy.extendToLedgers, batches, skipped };
}
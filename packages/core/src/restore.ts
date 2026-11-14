import {
  BASE_FEE,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  prepareTransactions,
  type PreparedExtension,
} from './extend.js';
import type { TransactionPreparer } from './transaction.js';
import type { EntryTtl } from './types.js';

export interface RestoreLimits {
  /** most entries one transaction may carry (read from the network) */
  maxEntriesPerTransaction: number;
}

export interface RestorePolicy {
  /** most entries to put in one restore transaction */
  maxBatchSize?: number;
}

export interface RestoreBatch {
  entries: EntryTtl[];
}

export type RestoreSkipReason = 'not_archived' | 'deleted' | 'not_found';

export interface RestorePlan {
  batches: RestoreBatch[];
  skipped: Array<{ entry: EntryTtl; reason: RestoreSkipReason }>;
}

/**
 * Restoring writes entries back and pays for their new rent, so a restore
 * transaction is heavier than an extend one. Not stress-tested yet: keep it
 * small until an experiment shows how large a batch can safely be.
 */
export const DEFAULT_MAX_RESTORE_BATCH_SIZE = 20;

/**
 * Decides which entries to restore. It never talks to the network and never signs.
 * Only 'archived' entries are restored. A deleted temporary entry cannot come
 * back, and a live entry does not need it.
 */
export function planRestores(
  entries: readonly EntryTtl[],
  limits: RestoreLimits,
  policy: RestorePolicy = {},
): RestorePlan {
  const requested = policy.maxBatchSize ?? DEFAULT_MAX_RESTORE_BATCH_SIZE;
  for (const [name, value] of [
    ['maxBatchSize', requested],
    ['maxEntriesPerTransaction', limits.maxEntriesPerTransaction],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive whole number, got ${value}`);
    }
  }
  const batchSize = Math.min(requested, limits.maxEntriesPerTransaction);

  const skipped: RestorePlan['skipped'] = [];
  const due: EntryTtl[] = [];
  for (const entry of entries) {
    switch (entry.band) {
      case 'archived':
        due.push(entry);
        break;
      case 'deleted':
        skipped.push({ entry, reason: 'deleted' });
        break;
      case 'not_found':
        skipped.push({ entry, reason: 'not_found' });
        break;
      default:
        skipped.push({ entry, reason: 'not_archived' });
    }
  }

  const batches: RestoreBatch[] = [];
  for (let start = 0; start < due.length; start += batchSize) {
    batches.push({ entries: due.slice(start, start + batchSize) });
  }
  return { batches, skipped };
}

/**
 * Builds ONE unsigned transaction that restores every entry in the batch.
 * For RestoreFootprint the entries go in the READ-WRITE part of the footprint
 * (the opposite of extend), and the operation must be the only one.
 *
 * Building changes `source`: the library moves its sequence number forward by one.
 */
export function buildRestoreTransaction(
  source: Account,
  batch: RestoreBatch,
  networkPassphrase: string,
  timeoutSeconds = 60,
): Transaction {
  if (batch.entries.length === 0) {
    throw new RangeError('Cannot build a transaction for an empty batch');
  }
  const keys = batch.entries.map((entry) => xdr.LedgerKey.fromXDR(entry.ledgerKeyXdr, 'base64'));
  const sorobanData = new SorobanDataBuilder().setReadWrite(keys).build();

  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .setSorobanData(sorobanData)
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(timeoutSeconds)
    .build();
}

export interface RestoreOptions {
  plan: RestorePlan;
  source: Account;
  networkPassphrase: string;
  /** the most all transactions together may cost (maximum fee, in stroops) */
  feeCeilingStroops: number;
  preparer: TransactionPreparer;
}

/** Builds and simulates every restore transaction. Signs and sends nothing. */
export async function prepareRestore(options: RestoreOptions): Promise<PreparedExtension> {
  const { plan, source, networkPassphrase, feeCeilingStroops, preparer } = options;
  const unsigned = plan.batches.map((batch) =>
    buildRestoreTransaction(source, batch, networkPassphrase),
  );
  const entryCount = plan.batches.reduce((sum, batch) => sum + batch.entries.length, 0);
  return prepareTransactions(unsigned, entryCount, feeCeilingStroops, preparer);
}

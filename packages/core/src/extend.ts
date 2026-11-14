import type { Account, Transaction } from '@stellar/stellar-sdk';
import type { ExtendPlan } from './planner.js';
import {
  FeeTooHighError,
  buildExtendTransactions,
  prepareWithFeeCeiling,
  type TransactionPreparer,
} from './transaction.js';

export interface ExtendOptions {
  plan: ExtendPlan;
  /** the account that pays the fee; its sequence number moves forward as transactions are built */
  source: Account;
  networkPassphrase: string;
  /** the most all transactions together may cost (maximum fee, in stroops) */
  feeCeilingStroops: number;
  preparer: TransactionPreparer;
}

/** Everything is built and simulated, nothing is signed or sent yet. */
export interface PreparedExtension {
  /** unsigned, in the order they must be sent */
  transactions: Transaction[];
  /** the most each transaction can be charged, in stroops */
  maxFeesStroops: number[];
  totalMaxFeeStroops: number;
  entryCount: number;
}

export interface BatchOutcome {
  /** position in the plan, starting at 0 */
  index: number;
  entryCount: number;
  hash: string;
  feeChargedStroops: number;
}

/** Signs one transaction, sends it and waits until it is final. The key never enters this package. */
export type SignAndSend = (
  transaction: Transaction,
) => Promise<{ hash: string; feeChargedStroops: number }>;

/** A transaction failed part way. `completed` lists what already went through. */
export class ExtendFailedError extends Error {
  constructor(
    readonly failedIndex: number,
    readonly completed: readonly BatchOutcome[],
    readonly reason: unknown,
  ) {
    const why = reason instanceof Error ? reason.message : String(reason);
    super(
      `Transaction ${failedIndex + 1} failed: ${why}. ` +
        `${completed.length} earlier transaction(s) already went through and are not undone.`,
    );
    this.name = 'ExtendFailedError';
  }
}

/**
 * Simulates already-built unsigned transactions through the RPC, one by one.
 * Refuses, before anything can be sent, when one transaction or the total
 * maximum fee is above the ceiling. Shared by extend and restore.
 */
export async function prepareTransactions(
  unsigned: readonly Transaction[],
  entryCount: number,
  feeCeilingStroops: number,
  preparer: TransactionPreparer,
): Promise<PreparedExtension> {
  const transactions: Transaction[] = [];
  const maxFeesStroops: number[] = [];
  for (const tx of unsigned) {
    const { transaction, feeStroops } = await prepareWithFeeCeiling(preparer, tx, feeCeilingStroops);
    transactions.push(transaction);
    maxFeesStroops.push(feeStroops);
  }

  const totalMaxFeeStroops = maxFeesStroops.reduce((sum, fee) => sum + fee, 0);
  if (totalMaxFeeStroops > feeCeilingStroops) {
    throw new FeeTooHighError(totalMaxFeeStroops, feeCeilingStroops);
  }
  return { transactions, maxFeesStroops, totalMaxFeeStroops, entryCount };
}

/**
 * Builds and simulates every transaction in the plan. Refuses, before anything
 * can be sent, when the total maximum fee is above the ceiling.
 */
export async function prepareExtension(options: ExtendOptions): Promise<PreparedExtension> {
  const { plan, source, networkPassphrase, feeCeilingStroops, preparer } = options;
  const unsigned = buildExtendTransactions(source, plan, networkPassphrase);
  const entryCount = plan.batches.reduce((sum, batch) => sum + batch.entries.length, 0);
  return prepareTransactions(unsigned, entryCount, feeCeilingStroops, preparer);
}

/**
 * Sends the prepared transactions one after another, because they use
 * consecutive sequence numbers. Stops at the first failure.
 */
export async function sendExtension(
  prepared: PreparedExtension,
  plan: { batches: ReadonlyArray<{ entries: readonly unknown[] }> },
  signAndSend: SignAndSend,
): Promise<BatchOutcome[]> {
  const completed: BatchOutcome[] = [];
  for (const [index, transaction] of prepared.transactions.entries()) {
    try {
      const result = await signAndSend(transaction);
      completed.push({
        index,
        entryCount: plan.batches[index]?.entries.length ?? 0,
        hash: result.hash,
        feeChargedStroops: result.feeChargedStroops,
      });
    } catch (error) {
      throw new ExtendFailedError(index, completed, error);
    }
  }
  return completed;
}

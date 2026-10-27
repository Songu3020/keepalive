import {
  BASE_FEE,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import type { ExtendPlan, PlannedBatch } from './planner.js';

/**
 * Builds ONE unsigned transaction that extends every entry in the batch.
 *
 * For ExtendFootprintTTL the entries go in the read-only part of the
 * footprint, and the operation must be the only one in the transaction
 * (experiments E1 and E2). The resource fee is not set here: it comes from
 * simulating the transaction (see prepareWithFeeCeiling).
 *
 * Building changes `source`: the library moves its sequence number forward by one.
 */
export function buildExtendTransaction(
  source: Account,
  batch: PlannedBatch,
  networkPassphrase: string,
  timeoutSeconds = 60,
): Transaction {
  if (batch.entries.length === 0) {
    throw new RangeError('Cannot build a transaction for an empty batch');
  }
  const keys = batch.entries.map((entry) => xdr.LedgerKey.fromXDR(entry.ledgerKeyXdr, 'base64'));
  const sorobanData = new SorobanDataBuilder().setReadOnly(keys).build();

  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .setSorobanData(sorobanData)
    .addOperation(Operation.extendFootprintTtl({ extendTo: batch.extendTo }))
    .setTimeout(timeoutSeconds)
    .build();
}

/**
 * One transaction per batch in the plan. They use consecutive sequence
 * numbers, so they must be submitted in order, each one after the last finishes.
 */
export function buildExtendTransactions(
  source: Account,
  plan: ExtendPlan,
  networkPassphrase: string,
): Transaction[] {
  return plan.batches.map((batch) => buildExtendTransaction(source, batch, networkPassphrase));
}

/** The part of the RPC client that fills in a transaction's resources and fee. */
export interface TransactionPreparer {
  prepareTransaction(transaction: Transaction): Promise<Transaction>;
}

export class FeeTooHighError extends Error {
  constructor(
    readonly feeStroops: number,
    readonly ceilingStroops: number,
  ) {
    super(
      `The transaction would cost up to ${feeStroops} stroops, above your ceiling of ${ceilingStroops} stroops. Nothing was sent.`,
    );
    this.name = 'FeeTooHighError';
  }
}

/**
 * Simulates the transaction through the RPC, which fills in the resources and
 * the fee. Refuses (throws FeeTooHighError) when the maximum fee is above the
 * ceiling. The result is still unsigned.
 *
 * `feeStroops` is the most the transaction can be charged. The real charge was
 * about 20% lower in experiment E1.
 */
export async function prepareWithFeeCeiling(
  preparer: TransactionPreparer,
  transaction: Transaction,
  ceilingStroops: number,
): Promise<{ transaction: Transaction; feeStroops: number }> {
  if (!Number.isInteger(ceilingStroops) || ceilingStroops <= 0) {
    throw new RangeError(`ceilingStroops must be a positive whole number, got ${ceilingStroops}`);
  }
  const prepared = await preparer.prepareTransaction(transaction);
  const feeStroops = Number(prepared.fee);
  if (feeStroops > ceilingStroops) {
    throw new FeeTooHighError(feeStroops, ceilingStroops);
  }
  return { transaction: prepared, feeStroops };
}
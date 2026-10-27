import {
  Account,
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { hashLedgerKey } from './ledger-key.js';
import type { ExtendPlan, PlannedBatch } from './planner.js';
import {
  FeeTooHighError,
  buildExtendTransaction,
  buildExtendTransactions,
  prepareWithFeeCeiling,
  type TransactionPreparer,
} from './transaction.js';
import type { EntryTtl } from './types.js';

const CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const PASSPHRASE = Networks.TESTNET;

function entry(n: number): EntryTtl {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(CONTRACT).toScAddress(),
      key: xdr.ScVal.scvU32(n),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  return {
    contractId: CONTRACT,
    kind: 'persistent',
    ledgerKeyXdr: key.toXDR('base64'),
    keyHash: hashLedgerKey(key),
    source: 'explicit',
    liveUntilLedger: 1_000_100,
    latestLedger: 1_000_000,
    band: 'critical',
  };
}

function batchOf(count: number, extendTo = 500_000): PlannedBatch {
  return { extendTo, entries: Array.from({ length: count }, (_, i) => entry(i)) };
}

function freshAccount(sequence = '100'): Account {
  return new Account(Keypair.random().publicKey(), sequence);
}

/** Reads the soroban data back out of a built transaction. */
function footprintOf(tx: Transaction) {
  const envelope = xdr.TransactionEnvelope.fromXDR(tx.toXDR(), 'base64');
  if (envelope.type !== 'envelopeTypeTx') throw new Error('unexpected envelope type');
  const ext = envelope.v1.tx.ext;
  if (ext.type !== 'sorobanData') throw new Error('transaction has no Soroban data');
  return ext.sorobanData.resources.footprint;
}

describe('buildExtendTransaction', () => {
  it('makes a single extend operation with the requested extendTo', () => {
    const tx = buildExtendTransaction(freshAccount(), batchOf(3, 777_000), PASSPHRASE);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({ type: 'extendFootprintTtl', extendTo: 777_000 });
  });

  it('puts every entry in the read-only footprint and none in read-write', () => {
    const batch = batchOf(3);
    const footprint = footprintOf(buildExtendTransaction(freshAccount(), batch, PASSPHRASE));
    expect(footprint.readWrite).toHaveLength(0);
    expect(footprint.readOnly.map((k) => k.toXDR('base64'))).toEqual(
      batch.entries.map((e) => e.ledgerKeyXdr),
    );
  });

  it('is unsigned', () => {
    const tx = buildExtendTransaction(freshAccount(), batchOf(1), PASSPHRASE);
    expect(tx.signatures).toHaveLength(0);
  });

  it('refuses an empty batch', () => {
    expect(() => buildExtendTransaction(freshAccount(), batchOf(0), PASSPHRASE)).toThrow(RangeError);
  });
});

describe('buildExtendTransactions', () => {
  it('uses consecutive sequence numbers, one transaction per batch', () => {
    const plan: ExtendPlan = {
      extendTo: 500_000,
      clamped: false,
      batches: [batchOf(2), batchOf(1)],
      skipped: [],
    };
    const txs = buildExtendTransactions(freshAccount('100'), plan, PASSPHRASE);
    expect(txs.map((tx) => tx.sequence)).toEqual(['101', '102']);
  });

  it('builds nothing for an empty plan', () => {
    const plan: ExtendPlan = { extendTo: 500_000, clamped: false, batches: [], skipped: [] };
    expect(buildExtendTransactions(freshAccount(), plan, PASSPHRASE)).toEqual([]);
  });
});

describe('prepareWithFeeCeiling', () => {
  /** A fake RPC that "simulates" by returning the same operations with a chosen fee. */
  function preparerWithFee(fee: string): TransactionPreparer {
    return {
      async prepareTransaction(tx) {
        return TransactionBuilder.cloneFrom(tx, { fee, networkPassphrase: PASSPHRASE }).build();
      },
    };
  }
  const unsigned = () => buildExtendTransaction(freshAccount(), batchOf(1), PASSPHRASE);

  it('returns the prepared transaction and its maximum fee when under the ceiling', async () => {
    const result = await prepareWithFeeCeiling(preparerWithFee('5000'), unsigned(), 10_000);
    expect(result.feeStroops).toBe(5000);
    expect(result.transaction.fee).toBe('5000');
  });

  it('accepts a fee exactly at the ceiling', async () => {
    const result = await prepareWithFeeCeiling(preparerWithFee('10000'), unsigned(), 10_000);
    expect(result.feeStroops).toBe(10_000);
  });

  it('refuses a fee above the ceiling', async () => {
    const attempt = prepareWithFeeCeiling(preparerWithFee('10001'), unsigned(), 10_000);
    await expect(attempt).rejects.toBeInstanceOf(FeeTooHighError);
    await expect(attempt).rejects.toThrow('Nothing was sent');
  });

  it('rejects a nonsense ceiling', async () => {
    await expect(prepareWithFeeCeiling(preparerWithFee('5000'), unsigned(), 0)).rejects.toThrow(RangeError);
  });
});
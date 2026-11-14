import { Account, Address, Keypair, Networks, TransactionBuilder, xdr, type Transaction } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { FeeTooHighError, type TransactionPreparer } from './transaction.js';
import { hashLedgerKey } from './ledger-key.js';
import {
  DEFAULT_MAX_RESTORE_BATCH_SIZE,
  buildRestoreTransaction,
  planRestores,
  prepareRestore,
} from './restore.js';
import type { EntryBand, EntryTtl } from './types.js';

const CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const PASSPHRASE = Networks.TESTNET;
const LIMITS = { maxEntriesPerTransaction: 100 };

function entry(n: number, band: EntryBand = 'archived'): EntryTtl {
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
    liveUntilLedger: band === 'not_found' ? null : 900,
    latestLedger: 1000,
    band,
  };
}

function footprintOf(tx: Transaction): { readWrite: number; readOnly: number } {
  const envelope = tx.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') throw new Error('unexpected envelope');
  const ext = envelope.v1.tx.ext;
  if (ext.type !== 'sorobanData') throw new Error('no soroban data');
  const footprint = ext.sorobanData.resources.footprint;
  return { readWrite: footprint.readWrite.length, readOnly: footprint.readOnly.length };
}

function preparerWithFee(fee: number): TransactionPreparer {
  return {
    async prepareTransaction(tx) {
      return TransactionBuilder.cloneFrom(tx, { fee: String(fee), networkPassphrase: PASSPHRASE }).build();
    },
  };
}

describe('planRestores', () => {
  it('restores only archived entries and says why it skipped the rest', () => {
    const entries = [
      entry(1, 'archived'),
      entry(2, 'healthy'),
      entry(3, 'critical'),
      entry(4, 'deleted'),
      entry(5, 'not_found'),
    ];
    const plan = planRestores(entries, LIMITS);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.entries.map((e) => e.keyHash)).toEqual([entries[0]?.keyHash]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'not_archived',
      'not_archived',
      'deleted',
      'not_found',
    ]);
  });

  it('splits into batches of the requested size', () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(i));
    const plan = planRestores(entries, LIMITS, { maxBatchSize: 2 });
    expect(plan.batches.map((b) => b.entries.length)).toEqual([2, 2, 1]);
  });

  it('never goes above the network limit', () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(i));
    const plan = planRestores(entries, { maxEntriesPerTransaction: 2 }, { maxBatchSize: 50 });
    expect(plan.batches.map((b) => b.entries.length)).toEqual([2, 2, 1]);
  });

  it('uses a small default batch size', () => {
    const entries = Array.from({ length: DEFAULT_MAX_RESTORE_BATCH_SIZE + 1 }, (_, i) => entry(i));
    const plan = planRestores(entries, { maxEntriesPerTransaction: 200 });
    expect(plan.batches.map((b) => b.entries.length)).toEqual([DEFAULT_MAX_RESTORE_BATCH_SIZE, 1]);
  });

  it('plans nothing when nothing is archived', () => {
    expect(planRestores([entry(1, 'healthy')], LIMITS).batches).toEqual([]);
  });

  it('rejects limits that are not positive whole numbers', () => {
    expect(() => planRestores([], { maxEntriesPerTransaction: 0 })).toThrow(RangeError);
    expect(() => planRestores([], LIMITS, { maxBatchSize: 1.5 })).toThrow(RangeError);
  });
});

describe('buildRestoreTransaction', () => {
  const source = () => new Account(Keypair.random().publicKey(), '100');

  it('makes one restoreFootprint operation with the entries in the read-write footprint', () => {
    const tx = buildRestoreTransaction(source(), { entries: [entry(1), entry(2)] }, PASSPHRASE);
    expect(tx.operations.map((op) => op.type)).toEqual(['restoreFootprint']);
    expect(footprintOf(tx)).toEqual({ readWrite: 2, readOnly: 0 });
    expect(tx.signatures).toHaveLength(0);
  });

  it('refuses an empty batch', () => {
    expect(() => buildRestoreTransaction(source(), { entries: [] }, PASSPHRASE)).toThrow(RangeError);
  });
});

describe('prepareRestore', () => {
  function options(sizes: number[], fee: number, ceiling: number) {
    let next = 0;
    return {
      plan: {
        skipped: [],
        batches: sizes.map((size) => ({ entries: Array.from({ length: size }, () => entry(next++)) })),
      },
      source: new Account(Keypair.random().publicKey(), '100'),
      networkPassphrase: PASSPHRASE,
      feeCeilingStroops: ceiling,
      preparer: preparerWithFee(fee),
    };
  }

  it('prepares one transaction per batch and adds up the fees', async () => {
    const prepared = await prepareRestore(options([2, 1], 5000, 20_000));
    expect(prepared.transactions).toHaveLength(2);
    expect(prepared.totalMaxFeeStroops).toBe(10_000);
    expect(prepared.entryCount).toBe(3);
    expect(prepared.transactions.every((tx) => tx.signatures.length === 0)).toBe(true);
  });

  it('refuses when the total is above the ceiling, before anything can be sent', async () => {
    await expect(prepareRestore(options([1, 1, 1], 5000, 12_000))).rejects.toBeInstanceOf(FeeTooHighError);
  });
});

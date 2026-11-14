import {
  Account,
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  ExtendFailedError,
  prepareExtension,
  sendExtension,
  type PreparedExtension,
  type SignAndSend,
} from './extend.js';
import { hashLedgerKey } from './ledger-key.js';
import type { ExtendPlan } from './planner.js';
import { FeeTooHighError, type TransactionPreparer } from './transaction.js';
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

/** A plan with one batch per number: [2, 1] means two transactions, with 2 and 1 entries. */
function planOf(sizes: number[]): ExtendPlan {
  let next = 0;
  return {
    extendTo: 500_000,
    clamped: false,
    skipped: [],
    batches: sizes.map((size) => ({
      extendTo: 500_000,
      entries: Array.from({ length: size }, () => entry(next++)),
    })),
  };
}

function freshAccount(): Account {
  return new Account(Keypair.random().publicKey(), '100');
}

/** A fake RPC that "simulates" by giving every transaction the same fee. */
function preparerWithFee(fee: number): TransactionPreparer {
  return {
    async prepareTransaction(tx) {
      return TransactionBuilder.cloneFrom(tx, {
        fee: String(fee),
        networkPassphrase: PASSPHRASE,
      }).build();
    },
  };
}

function options(sizes: number[], fee: number, ceiling: number) {
  return {
    plan: planOf(sizes),
    source: freshAccount(),
    networkPassphrase: PASSPHRASE,
    feeCeilingStroops: ceiling,
    preparer: preparerWithFee(fee),
  };
}

describe('prepareExtension', () => {
  it('builds one transaction per batch and adds up the fees and entries', async () => {
    const prepared = await prepareExtension(options([2, 1], 5000, 20_000));
    expect(prepared.transactions).toHaveLength(2);
    expect(prepared.maxFeesStroops).toEqual([5000, 5000]);
    expect(prepared.totalMaxFeeStroops).toBe(10_000);
    expect(prepared.entryCount).toBe(3);
  });

  it('signs nothing', async () => {
    const prepared = await prepareExtension(options([1], 5000, 20_000));
    expect(prepared.transactions.every((tx) => tx.signatures.length === 0)).toBe(true);
  });

  it('refuses when one transaction is above the ceiling', async () => {
    await expect(prepareExtension(options([1], 9000, 5000))).rejects.toBeInstanceOf(FeeTooHighError);
  });

  it('refuses when each transaction is fine but the total is above the ceiling', async () => {
    const attempt = prepareExtension(options([1, 1, 1], 5000, 12_000));
    await expect(attempt).rejects.toBeInstanceOf(FeeTooHighError);
    await expect(attempt).rejects.toThrow('Nothing was sent');
  });

  it('accepts a total exactly at the ceiling', async () => {
    const prepared = await prepareExtension(options([1, 1], 5000, 10_000));
    expect(prepared.totalMaxFeeStroops).toBe(10_000);
  });

  it('prepares nothing for an empty plan', async () => {
    const prepared = await prepareExtension(options([], 5000, 10_000));
    expect(prepared.transactions).toEqual([]);
    expect(prepared.totalMaxFeeStroops).toBe(0);
    expect(prepared.entryCount).toBe(0);
  });
});

describe('sendExtension', () => {
  async function prepared(sizes: number[]): Promise<{ plan: ExtendPlan; prepared: PreparedExtension }> {
    const opts = options(sizes, 5000, 1_000_000);
    return { plan: opts.plan, prepared: await prepareExtension(opts) };
  }

  it('sends the transactions in order and reports each one', async () => {
    const { plan, prepared: ready } = await prepared([2, 1]);
    const sentSequences: string[] = [];
    const signAndSend: SignAndSend = async (tx) => {
      sentSequences.push(tx.sequence);
      return { hash: `hash-${tx.sequence}`, feeChargedStroops: 4000 };
    };
    const outcomes = await sendExtension(ready, plan, signAndSend);
    expect(sentSequences).toEqual(['101', '102']);
    expect(outcomes).toEqual([
      { index: 0, entryCount: 2, hash: 'hash-101', feeChargedStroops: 4000 },
      { index: 1, entryCount: 1, hash: 'hash-102', feeChargedStroops: 4000 },
    ]);
  });

  it('waits for each transaction before sending the next', async () => {
    const { plan, prepared: ready } = await prepared([1, 1]);
    let running = 0;
    let overlapped = false;
    const signAndSend: SignAndSend = async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { hash: 'h', feeChargedStroops: 1 };
    };
    await sendExtension(ready, plan, signAndSend);
    expect(overlapped).toBe(false);
  });

  it('stops at the first failure and says what already went through', async () => {
    const { plan, prepared: ready } = await prepared([1, 1, 1]);
    let calls = 0;
    const signAndSend: SignAndSend = async () => {
      calls += 1;
      if (calls === 2) throw new Error('network said no');
      return { hash: `h${calls}`, feeChargedStroops: 1 };
    };
    const attempt = sendExtension(ready, plan, signAndSend);
    await expect(attempt).rejects.toBeInstanceOf(ExtendFailedError);
    await expect(attempt).rejects.toThrow('Transaction 2 failed: network said no');
    expect(calls).toBe(2);

    const error = await sendExtension(ready, plan, async () => {
      throw new Error('boom');
    }).catch((e: unknown) => e as ExtendFailedError);
    expect(error.failedIndex).toBe(0);
    expect(error.completed).toEqual([]);
  });
});

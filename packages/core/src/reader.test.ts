import { Address, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { hashLedgerKey } from './ledger-key.js';
import { MAX_KEYS_PER_REQUEST, readTtls, type LedgerEntryFetcher } from './reader.js';
import type { EntryRef } from './types.js';

const CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const LATEST = 5000;
const thresholds = { expiringSoon: 1000, critical: 100 };

/** Makes a distinct persistent entry reference; `n` makes the key unique. */
function makeRef(n: number): EntryRef {
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
  };
}

/** A fake RPC. `liveUntil` maps key hash to expiry; absent hashes are "missing". */
function fakeFetcher(liveUntil: Map<string, number>) {
  const callSizes: number[] = [];
  const fetcher: LedgerEntryFetcher = {
    async getLedgerEntries(...keys) {
      callSizes.push(keys.length);
      const entries = keys
        .filter((key) => liveUntil.has(hashLedgerKey(key)))
        .map((key) => ({ key, liveUntilLedgerSeq: liveUntil.get(hashLedgerKey(key)) }))
        .reverse(); // the real RPC promises no order
      return { entries, latestLedger: LATEST };
    },
  };
  return { fetcher, callSizes };
}

describe('readTtls', () => {
  it('classifies entries by how close they are to expiry', async () => {
    const [a, b, c] = [makeRef(1), makeRef(2), makeRef(3)] as [EntryRef, EntryRef, EntryRef];
    const { fetcher } = fakeFetcher(
      new Map([
        [a.keyHash, LATEST + 50_000],
        [b.keyHash, LATEST + 500],
        [c.keyHash, LATEST + 10],
      ]),
    );
    const out = await readTtls(fetcher, [a, b, c], thresholds);
    expect(out.map((e) => e.band)).toEqual(['healthy', 'expiring_soon', 'critical']);
    expect(out.map((e) => e.liveUntilLedger)).toEqual([LATEST + 50_000, LATEST + 500, LATEST + 10]);
  });

  it('keeps the input order even when the RPC answers in another order', async () => {
    const refs = [makeRef(1), makeRef(2), makeRef(3)];
    const { fetcher } = fakeFetcher(new Map(refs.map((r, i) => [r.keyHash, LATEST + 10_000 + i])));
    const out = await readTtls(fetcher, refs, thresholds);
    expect(out.map((e) => e.keyHash)).toEqual(refs.map((r) => r.keyHash));
  });

  it('marks an entry the RPC does not return as not_found', async () => {
    const present = makeRef(1);
    const missing = makeRef(2);
    const { fetcher } = fakeFetcher(new Map([[present.keyHash, LATEST + 50_000]]));
    const out = await readTtls(fetcher, [present, missing], thresholds);
    expect(out[1]?.band).toBe('not_found');
    expect(out[1]?.liveUntilLedger).toBeNull();
  });

  it('splits large lists into requests of at most 200 keys', async () => {
    const refs = Array.from({ length: 450 }, (_, i) => makeRef(i));
    const { fetcher, callSizes } = fakeFetcher(new Map(refs.map((r) => [r.keyHash, LATEST + 50_000])));
    const out = await readTtls(fetcher, refs, thresholds);
    expect(callSizes).toEqual([MAX_KEYS_PER_REQUEST, MAX_KEYS_PER_REQUEST, 50]);
    expect(out).toHaveLength(450);
    expect(out.every((e) => e.band === 'healthy')).toBe(true);
  });

  it('makes no request for an empty list', async () => {
    const { fetcher, callSizes } = fakeFetcher(new Map());
    expect(await readTtls(fetcher, [], thresholds)).toEqual([]);
    expect(callSizes).toEqual([]);
  });
});
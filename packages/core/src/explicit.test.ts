import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { ExplicitSource, contractInstanceKeyXdr, parseKeyList } from './explicit.js';
import { hashLedgerKey } from './ledger-key.js';
import type { EntryRef } from './types.js';

const CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function dataKey(contractId: string, n: number, temporary = false): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvU32(n),
      durability: temporary
        ? xdr.ContractDataDurability.temporary
        : xdr.ContractDataDurability.persistent,
    }),
  );
}

async function collect(source: ExplicitSource, contractId: string): Promise<EntryRef[]> {
  const found: EntryRef[] = [];
  for await (const ref of source.discover(contractId)) found.push(ref);
  return found;
}

describe('parseKeyList', () => {
  it('skips blank lines and comments, and trims spaces', () => {
    const text = '# my keys\nAAA\n\n  BBB  # a balance\r\nCCC\n';
    expect(parseKeyList(text)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('returns an empty list for empty text', () => {
    expect(parseKeyList('')).toEqual([]);
  });
});

describe('ExplicitSource', () => {
  it('returns the entry with the right hash, contract and source', async () => {
    const key = dataKey(CONTRACT, 1);
    const [ref] = await collect(new ExplicitSource([key.toXDR('base64')]), CONTRACT);
    expect(ref).toEqual({
      contractId: CONTRACT,
      kind: 'persistent',
      ledgerKeyXdr: key.toXDR('base64'),
      keyHash: hashLedgerKey(key),
      source: 'explicit',
    });
  });

  it('detects temporary and instance entries', async () => {
    const keys = [
      dataKey(CONTRACT, 1, true).toXDR('base64'),
      contractInstanceKeyXdr(CONTRACT),
    ];
    const found = await collect(new ExplicitSource(keys), CONTRACT);
    expect(found.map((ref) => ref.kind)).toEqual(['temporary', 'instance']);
  });

  it('keeps only the keys of the contract that was asked for', async () => {
    const keys = [dataKey(CONTRACT, 1), dataKey(OTHER, 2), dataKey(CONTRACT, 3)].map((k) =>
      k.toXDR('base64'),
    );
    const found = await collect(new ExplicitSource(keys), CONTRACT);
    expect(found).toHaveLength(2);
    expect(found.every((ref) => ref.contractId === CONTRACT)).toBe(true);
  });

  it('skips a key that is listed twice', async () => {
    const key = dataKey(CONTRACT, 1).toXDR('base64');
    expect(await collect(new ExplicitSource([key, key]), CONTRACT)).toHaveLength(1);
  });

  it('throws a clear error for text that is not a LedgerKey', async () => {
    await expect(collect(new ExplicitSource(['not xdr']), CONTRACT)).rejects.toThrow(
      'key 1 is not a base64 LedgerKey',
    );
  });

  it('refuses key types other than contractData', async () => {
    const account = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({ accountId: Keypair.random().xdrAccountId() }),
    );
    await expect(collect(new ExplicitSource([account.toXDR('base64')]), CONTRACT)).rejects.toThrow(
      'only contractData keys are supported',
    );
  });
});

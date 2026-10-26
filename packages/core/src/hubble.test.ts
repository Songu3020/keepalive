import { describe, expect, it } from 'vitest';
import { DEFAULT_ENTRY_LIMIT, HubbleSource, type QueryRunner } from './hubble.js';
import type { EntryRef } from './types.js';

// The real Hubble row from experiment E6 (see ledger-key.test.ts).
const HUBBLE_ENTRY_XDR =
  'AAAAAAAAAAEltPzYWa7C+mNIQ4xImzw8EMmLbSG+T9PLMMtolT75dwAAABAAAAABAAAAAgAAAA8AAAAHQmFsYW5jZQAAAAASAAAAAcG9Hs2rqSgcGcWt6gu1IPrgEkxdvSl1IMsgSgY2ED/xAAAAAQAAABEAAAABAAAAAwAAAA8AAAAGYW1vdW50AAAAAAAKAAAAAAAAAAAAAAAAAJiWgAAAAA8AAAAKYXV0aG9yaXplZAAAAAAAAAAAAAEAAAAPAAAACGNsYXdiYWNrAAAAAAAAAAA=';
const HUBBLE_KEY_HASH = 'b2661cabbf362f0d844084f035514ebdae0d3e3b7fe836bc8236f42219205ba7';
const XLM_CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

function fakeRunner(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ sql: string; params: Record<string, string | number> }> = [];
  const runner: QueryRunner = {
    async query(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
  };
  return { runner, calls };
}

async function collect(source: HubbleSource, contractId: string): Promise<EntryRef[]> {
  const out: EntryRef[] = [];
  for await (const ref of source.discover(contractId)) out.push(ref);
  return out;
}

describe('HubbleSource', () => {
  it('turns Hubble rows into entry references', async () => {
    const { runner } = fakeRunner([{ contract_data_xdr: HUBBLE_ENTRY_XDR }]);
    const refs = await collect(new HubbleSource(runner), XLM_CONTRACT);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      contractId: XLM_CONTRACT,
      kind: 'persistent',
      keyHash: HUBBLE_KEY_HASH,
      source: 'hubble',
    });
  });

  it('passes the contract id and limit as parameters, not inside the SQL text', async () => {
    const { runner, calls } = fakeRunner([]);
    await collect(new HubbleSource(runner), XLM_CONTRACT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual({ contractId: XLM_CONTRACT, limit: DEFAULT_ENTRY_LIMIT });
    expect(calls[0]?.sql).not.toContain(XLM_CONTRACT);
    expect(calls[0]?.sql).toContain('contract_data_current');
  });

  it('uses a custom limit when given one', async () => {
    const { runner, calls } = fakeRunner([]);
    await collect(new HubbleSource(runner, 25), XLM_CONTRACT);
    expect(calls[0]?.params['limit']).toBe(25);
  });

  it('returns nothing for a contract Hubble has no entries for', async () => {
    const { runner } = fakeRunner([]);
    expect(await collect(new HubbleSource(runner), XLM_CONTRACT)).toEqual([]);
  });

  it('throws when a row has no XDR', async () => {
    const { runner } = fakeRunner([{ contract_data_xdr: null }]);
    await expect(collect(new HubbleSource(runner), XLM_CONTRACT)).rejects.toThrow('no contract_data_xdr');
  });
});
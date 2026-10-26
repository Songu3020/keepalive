import { describe, expect, it } from 'vitest';
import { ledgerKeyFromContractDataXdr } from './ledger-key.js';

// A real row from Hubble (crypto_stellar_dbt.contract_data_current), found in
// experiment E6: one Balance entry of the mainnet XLM contract.
const HUBBLE_ENTRY_XDR =
  'AAAAAAAAAAEltPzYWa7C+mNIQ4xImzw8EMmLbSG+T9PLMMtolT75dwAAABAAAAABAAAAAgAAAA8AAAAHQmFsYW5jZQAAAAASAAAAAcG9Hs2rqSgcGcWt6gu1IPrgEkxdvSl1IMsgSgY2ED/xAAAAAQAAABEAAAABAAAAAwAAAA8AAAAGYW1vdW50AAAAAAAKAAAAAAAAAAAAAAAAAJiWgAAAAA8AAAAKYXV0aG9yaXplZAAAAAAAAAAAAAEAAAAPAAAACGNsYXdiYWNrAAAAAAAAAAA=';
const HUBBLE_KEY_HASH = 'b2661cabbf362f0d844084f035514ebdae0d3e3b7fe836bc8236f42219205ba7';
const XLM_CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

describe('ledgerKeyFromContractDataXdr', () => {
  it('rebuilds the same key hash that Hubble stores', () => {
    const rebuilt = ledgerKeyFromContractDataXdr(HUBBLE_ENTRY_XDR);
    expect(rebuilt.keyHash).toBe(HUBBLE_KEY_HASH);
  });

  it('reads the contract id and entry kind', () => {
    const rebuilt = ledgerKeyFromContractDataXdr(HUBBLE_ENTRY_XDR);
    expect(rebuilt.contractId).toBe(XLM_CONTRACT);
    expect(rebuilt.kind).toBe('persistent');
  });

  it('returns a LedgerKey XDR that is not the entry XDR', () => {
    const rebuilt = ledgerKeyFromContractDataXdr(HUBBLE_ENTRY_XDR);
    expect(rebuilt.ledgerKeyXdr).not.toBe(HUBBLE_ENTRY_XDR);
    expect(rebuilt.ledgerKeyXdr.length).toBeLessThan(HUBBLE_ENTRY_XDR.length);
  });

  it('throws on input that is not a ContractDataEntry', () => {
    expect(() => ledgerKeyFromContractDataXdr('not xdr')).toThrow();
  });
});
import { xdr } from '@stellar/stellar-sdk';
import { classifyBand, type Thresholds } from './bands.js';
import { hashLedgerKey } from './ledger-key.js';
import type { EntryRef, EntryTtl } from './types.js';

/**
 * The only part of the Stellar RPC client the reader needs. The real
 * `rpc.Server` fits this shape, and so does a small fake in the tests.
 */
export interface LedgerEntryFetcher {
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{
    entries: ReadonlyArray<{ key: xdr.LedgerKey; liveUntilLedgerSeq?: number }>;
    latestLedger: number;
  }>;
}

/** The RPC refuses getLedgerEntries calls with more keys than this. */
export const MAX_KEYS_PER_REQUEST = 200;

/**
 * Asks the RPC when each entry expires and classifies it.
 * Results come back in the same order as `refs`.
 * An entry the RPC does not return gets liveUntilLedger null and band 'not_found'.
 */
export async function readTtls(
  fetcher: LedgerEntryFetcher,
  refs: readonly EntryRef[],
  thresholds: Thresholds,
): Promise<EntryTtl[]> {
  const results: EntryTtl[] = [];

  for (let start = 0; start < refs.length; start += MAX_KEYS_PER_REQUEST) {
    const chunk = refs.slice(start, start + MAX_KEYS_PER_REQUEST);
    const keys = chunk.map((ref) => xdr.LedgerKey.fromXDR(ref.ledgerKeyXdr, 'base64'));
    const response = await fetcher.getLedgerEntries(...keys);

    // The answer lists only the entries that exist, in no promised order,
    // so match each one back to its request by the key's hash.
    const liveUntilByHash = new Map<string, number>();
    for (const entry of response.entries) {
      if (entry.liveUntilLedgerSeq !== undefined) {
        liveUntilByHash.set(hashLedgerKey(entry.key), entry.liveUntilLedgerSeq);
      }
    }

    for (const ref of chunk) {
      const liveUntilLedger = liveUntilByHash.get(ref.keyHash) ?? null;
      results.push({
        ...ref,
        liveUntilLedger,
        latestLedger: response.latestLedger,
        band: classifyBand({
          kind: ref.kind,
          liveUntilLedger,
          latestLedger: response.latestLedger,
          thresholds,
        }),
      });
    }
  }

  return results;
}
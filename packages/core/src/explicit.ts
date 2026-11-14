import { Address, xdr } from '@stellar/stellar-sdk';
import { hashLedgerKey } from './ledger-key.js';
import type { DiscoverySource, EntryKind, EntryRef } from './types.js';

/**
 * Reads a list of ledger keys from text: one base64 XDR LedgerKey per line.
 * Blank lines are skipped, and so is anything after a `#`, so a file can carry notes.
 * The caller reads the file; this function only parses text, so tests need no disk.
 */
export function parseKeyList(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = line.split('#')[0]?.trim() ?? '';
    if (key !== '') keys.push(key);
  }
  return keys;
}

/** The ledger key of a contract's instance entry, as base64 XDR. Handy for building a key file. */
export function contractInstanceKeyXdr(contractId: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXDR('base64');
}

/**
 * Discovery from keys you already know, with no Hubble and no network.
 * This is what lets `extend` be tried on testnet, which Hubble does not cover.
 * Only contract data keys are accepted (that includes a contract's instance entry).
 */
export class ExplicitSource implements DiscoverySource {
  readonly name = 'explicit' as const;

  constructor(private readonly keysXdr: readonly string[]) {}

  async *discover(contractId: string): AsyncIterable<EntryRef> {
    const seen = new Set<string>();
    for (const [index, keyXdr] of this.keysXdr.entries()) {
      const where = `key ${index + 1}`;

      let key: xdr.LedgerKey;
      try {
        key = xdr.LedgerKey.fromXDR(keyXdr, 'base64');
      } catch {
        throw new Error(`${where} is not a base64 LedgerKey`);
      }
      if (key.type !== 'contractData') {
        throw new Error(`${where} is a ${key.type} key; only contractData keys are supported`);
      }

      const data = key.contractData;
      if (Address.fromScAddress(data.contract).toString() !== contractId) continue;

      const keyHash = hashLedgerKey(key);
      if (seen.has(keyHash)) continue;
      seen.add(keyHash);

      let kind: EntryKind;
      if (data.key.type === 'scvLedgerKeyContractInstance') kind = 'instance';
      else if (data.durability.name === 'temporary') kind = 'temporary';
      else kind = 'persistent';

      yield { contractId, kind, ledgerKeyXdr: key.toXDR('base64'), keyHash, source: 'explicit' };
    }
  }
}

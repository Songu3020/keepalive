import { createHash } from 'node:crypto';
import { Address, xdr } from '@stellar/stellar-sdk';
import type { EntryKind } from './types.js';

export interface RebuiltKey {
  contractId: string;
  kind: EntryKind;
  /** base64 XDR of the LedgerKey: what getLedgerEntries wants */
  ledgerKeyXdr: string;
  /** hex sha256 of the LedgerKey XDR: what Hubble calls ledger_key_hash and ttl key_hash */
  keyHash: string;
}

/** Hubble's `key_hash` is the hex sha256 of the XDR bytes of the LedgerKey. */
export function hashLedgerKey(key: xdr.LedgerKey): string {
  return createHash('sha256').update(key.toXDR()).digest('hex');
}

/**
 * Rebuilds a LedgerKey from the `contract_data_xdr` column of Hubble's
 * contract_data tables. That column holds a ContractDataEntry, which has the
 * contract, key and durability (plus the value, which we do not need).
 */
export function ledgerKeyFromContractDataXdr(entryXdr: string): RebuiltKey {
  const entry = xdr.ContractDataEntry.fromXDR(entryXdr, 'base64');

  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: entry.contract,
      key: entry.key,
      durability: entry.durability,
    }),
  );

  let kind: EntryKind;
  if (entry.key.type === 'scvLedgerKeyContractInstance') {
    kind = 'instance';
  } else if (entry.durability.name === 'temporary') {
    kind = 'temporary';
  } else {
    kind = 'persistent';
  }

  return {
    contractId: Address.fromScAddress(entry.contract).toString(),
    kind,
    ledgerKeyXdr: key.toXDR('base64'),
    keyHash: hashLedgerKey(key),
  };
}
export type EntryKind = 'instance' | 'code' | 'persistent' | 'temporary';

export type DiscoverySourceName =
  | 'deterministic'
  | 'explicit'
  | 'hubble'
  | 'galexie';

export interface EntryRef {
  contractId: string;
  kind: EntryKind;
  /** base64 XDR of the LedgerKey */
  ledgerKeyXdr: string;
  keyHash: string;
  source: DiscoverySourceName;
}

export type EntryBand =
  | 'healthy'
  | 'expiring_soon'
  | 'critical'
  | 'archived' // expired persistent or instance entry: restorable
  | 'deleted' // expired temporary entry: gone for good
  | 'not_found'; // the RPC returned no entry for the key

export interface EntryTtl extends EntryRef {
  /** null when the RPC returned no entry */
  liveUntilLedger: number | null;
  latestLedger: number;
  band: EntryBand;
}

export interface DiscoverySource {
  name: DiscoverySourceName;
  discover(contractId: string): AsyncIterable<EntryRef>;
}

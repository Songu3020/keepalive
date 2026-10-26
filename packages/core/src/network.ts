import { xdr } from '@stellar/stellar-sdk';
import type { NetworkLimits } from './planner.js';

/** The part of the RPC client needed to read network settings. `rpc.Server` fits it. */
export interface SettingsFetcher {
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{
    entries: ReadonlyArray<{ val: xdr.LedgerEntryData }>;
  }>;
}

export interface NetworkSettings extends NetworkLimits {
  /** shortest life a new persistent entry gets, in ledgers */
  minPersistentTtl: number;
  /** shortest life a new temporary entry gets, in ledgers */
  minTemporaryTtl: number;
}

function settingKey(id: xdr.ConfigSettingId): xdr.LedgerKey {
  return xdr.LedgerKey.configSetting(new xdr.LedgerKeyConfigSetting({ configSettingId: id }));
}

/**
 * Reads the limits Keepalive depends on straight from the network, because
 * they differ between networks and some Stellar docs pages are out of date
 * (experiment E4).
 */
export async function readNetworkSettings(fetcher: SettingsFetcher): Promise<NetworkSettings> {
  const response = await fetcher.getLedgerEntries(
    settingKey(xdr.ConfigSettingId.configSettingStateArchival),
    settingKey(xdr.ConfigSettingId.configSettingContractLedgerCostV0),
  );

  let archival: { maxEntryTtl: number; minPersistentTtl: number; minTemporaryTtl: number } | undefined;
  let cost: { txMaxDiskReadEntries: number; txMaxWriteLedgerEntries: number } | undefined;

  for (const entry of response.entries) {
    if (entry.val.type !== 'configSetting') continue;
    const setting = entry.val.configSetting;
    if (setting.type === 'configSettingStateArchival') {
      archival = setting.stateArchivalSettings;
    } else if (setting.type === 'configSettingContractLedgerCostV0') {
      cost = setting.contractLedgerCost;
    }
  }

  if (archival === undefined || cost === undefined) {
    throw new Error('The RPC did not return the network settings Keepalive needs');
  }

  return {
    maxEntryTtl: archival.maxEntryTtl,
    minPersistentTtl: archival.minPersistentTtl,
    minTemporaryTtl: archival.minTemporaryTtl,
    // Extending reads entries; to be safe, obey the stricter of the read and write caps.
    maxEntriesPerTransaction: Math.min(cost.txMaxDiskReadEntries, cost.txMaxWriteLedgerEntries),
  };
}
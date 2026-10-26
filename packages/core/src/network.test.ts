import type { xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { readNetworkSettings, type SettingsFetcher } from './network.js';

// The reader only looks at these fields, so the fake builds plain objects with
// just them. The real XDR shapes were exercised against testnet in experiment E4.
function settingEntry(setting: Record<string, unknown>): { val: xdr.LedgerEntryData } {
  return { val: { type: 'configSetting', configSetting: setting } as unknown as xdr.LedgerEntryData };
}

const archival = settingEntry({
  type: 'configSettingStateArchival',
  stateArchivalSettings: { maxEntryTtl: 3_110_400, minPersistentTtl: 120_960, minTemporaryTtl: 720 },
});
const cost = settingEntry({
  type: 'configSettingContractLedgerCostV0',
  contractLedgerCost: { txMaxDiskReadEntries: 200, txMaxWriteLedgerEntries: 150 },
});

function fetcherReturning(entries: Array<{ val: xdr.LedgerEntryData }>) {
  let requested = 0;
  const fetcher: SettingsFetcher = {
    async getLedgerEntries(...keys) {
      requested = keys.length;
      return { entries };
    },
  };
  return { fetcher, requestedKeys: () => requested };
}

describe('readNetworkSettings', () => {
  it('reads the limits from the two config settings in one request', async () => {
    const { fetcher, requestedKeys } = fetcherReturning([archival, cost]);
    const settings = await readNetworkSettings(fetcher);
    expect(settings.maxEntryTtl).toBe(3_110_400);
    expect(settings.minPersistentTtl).toBe(120_960);
    expect(settings.minTemporaryTtl).toBe(720);
    expect(requestedKeys()).toBe(2);
  });

  it('uses the stricter of the read and write entry caps', async () => {
    const { fetcher } = fetcherReturning([cost, archival]);
    const settings = await readNetworkSettings(fetcher);
    expect(settings.maxEntriesPerTransaction).toBe(150);
  });

  it('throws when the RPC leaves out a setting', async () => {
    const { fetcher } = fetcherReturning([archival]);
    await expect(readNetworkSettings(fetcher)).rejects.toThrow('network settings');
  });
});
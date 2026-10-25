// Experiment 01: read-only. No account, no keys, no money.
//
// What it answers:
//   E4  What are the network's TTL limits (max TTL, minimum TTL)?
//   E5a What does the RPC return for an entry that does not exist?
//   And as a warm-up: how long until a real contract's data expires?
//
// Run:  node experiments/01-read-ttl.mts

import { Asset, Contract, Networks, StrKey, rpc, xdr } from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

// About one ledger every 5 seconds, so about 17,280 ledgers a day.
const LEDGERS_PER_DAY = 17_280;

function days(ledgers: number): string {
  return (ledgers / LEDGERS_PER_DAY).toFixed(1);
}

async function main(): Promise<void> {
  const server = new rpc.Server(RPC_URL);

  // 1. Where is the chain right now?
  const latest = await server.getLatestLedger();
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Latest ledger: ${latest.sequence}\n`);

  // 2. E4: read the network's state archival settings.
  //    These live in a special "config setting" ledger entry. getLedgerEntries
  //    looks things up by key, so we build the key for that entry.
  const settingsKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId.configSettingStateArchival,
    }),
  );
  const settingsResponse = await server.getLedgerEntries(settingsKey);
  const settingsEntry = settingsResponse.entries[0];
  if (
    settingsEntry === undefined ||
    settingsEntry.val.type !== 'configSetting' ||
    settingsEntry.val.configSetting.type !== 'configSettingStateArchival'
  ) {
    throw new Error('Could not read the state archival settings entry');
  }
  const s = settingsEntry.val.configSetting.stateArchivalSettings;
  console.log('E4: state archival settings');
  console.log(`  maxEntryTtl      ${s.maxEntryTtl} ledgers (~${days(s.maxEntryTtl)} days)`);
  console.log(`  minPersistentTtl ${s.minPersistentTtl} ledgers (~${days(s.minPersistentTtl)} days)`);
  console.log(`  minTemporaryTtl  ${s.minTemporaryTtl} ledgers (~${days(s.minTemporaryTtl)} days)\n`);

  // 3. Warm-up: the native XLM token has a contract on every network.
  //    Read its "instance" entry and see when it expires.
  const xlmContractId = Asset.native().contractId(NETWORK_PASSPHRASE);
  const instanceKey = new Contract(xlmContractId).getFootprint();
  const instanceResponse = await server.getLedgerEntries(instanceKey);
  const instance = instanceResponse.entries[0];
  console.log(`Warm-up: XLM contract ${xlmContractId}`);
  if (instance === undefined || instance.liveUntilLedgerSeq === undefined) {
    console.log('  instance entry not returned by the RPC\n');
  } else {
    const remaining = instance.liveUntilLedgerSeq - instanceResponse.latestLedger;
    console.log(`  liveUntilLedgerSeq ${instance.liveUntilLedgerSeq}`);
    console.log(`  ledgers remaining  ${remaining} (~${days(remaining)} days)\n`);
  }

  // 4. E5a: ask for an entry that cannot exist and see what comes back.
  //    A contract id made from zeros has no data.
  const nobodyId = StrKey.encodeContract(new Uint8Array(32));
  const missingResponse = await server.getLedgerEntries(new Contract(nobodyId).getFootprint());
  console.log(`E5a: asked for the instance of ${nobodyId}`);
  console.log(`  entries returned: ${missingResponse.entries.length}`);
  console.log('  (0 means a missing entry is simply left out of the answer)');
}

main().catch((error: unknown) => {
  console.error('Experiment failed:', error);
  process.exitCode = 1;
});
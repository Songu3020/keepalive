// Experiment 02: writes to TESTNET (play money only).
//
// What it answers:
//   E2  Can an account that did NOT create a contract extend its entries?
//   E1  Can one transaction extend several entries at once, and what does it cost?
//   E3  What are the network's per-transaction entry limits?
//
// How: it makes two throwaway accounts, funds them from the testnet faucet,
// creates 5 token contracts (each has one "instance" entry we can extend),
// then runs the tests. Keys are random every run and are never saved.
//
// Run:  node experiments/02-extend.mts

import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const LEDGERS_PER_DAY = 17_280;
const CONTRACT_COUNT = 5;

const server = new rpc.Server(RPC_URL);

function days(ledgers: number): string {
  return (ledgers / LEDGERS_PER_DAY).toFixed(1);
}

/** Send a transaction, wait for it to finish, and return what we need to learn. */
async function submit(
  tx: Parameters<typeof server.prepareTransaction>[0],
  signer: Keypair,
): Promise<{ hash: string; maxFee: string; feeCharged: string }> {
  // prepareTransaction asks the RPC to simulate the transaction first. The
  // simulation works out the resources and fee, and fills them in for us.
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const done = await server.pollTransaction(sent.hash);
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${sent.hash} ended with status ${done.status}`);
  }
  return {
    hash: sent.hash,
    maxFee: prepared.fee,
    feeCharged: String(done.resultXdr.feeCharged),
  };
}

async function liveUntil(key: xdr.LedgerKey): Promise<{ liveUntil: number | null; latest: number }> {
  const response = await server.getLedgerEntries(key);
  const entry = response.entries[0];
  return { liveUntil: entry?.liveUntilLedgerSeq ?? null, latest: response.latestLedger };
}

async function remaining(keys: xdr.LedgerKey[]): Promise<number[]> {
  const out: number[] = [];
  for (const key of keys) {
    const { liveUntil: until, latest } = await liveUntil(key);
    out.push(until === null ? -1 : until - latest);
  }
  return out;
}

function describe(label: string, ledgers: number[]): void {
  const text = ledgers.map((n) => (n < 0 ? 'missing' : `${n} (~${days(n)}d)`)).join(', ');
  console.log(`  ${label}: ${text}`);
}

async function extend(
  signer: Keypair,
  keys: xdr.LedgerKey[],
  extendTo: number,
): Promise<{ hash: string; maxFee: string; feeCharged: string }> {
  const account = await server.getAccount(signer.publicKey());
  // For an extend operation, the entries go in the READ-ONLY part of the footprint.
  const data = new SorobanDataBuilder().setReadOnly(keys).build();
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .setSorobanData(data)
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setTimeout(60)
    .build();
  return submit(tx, signer);
}

async function readSettings(): Promise<{
  maxEntryTtl: number;
  txMaxDiskReadEntries: number;
  txMaxWriteLedgerEntries: number;
}> {
  const archivalKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({ configSettingId: xdr.ConfigSettingId.configSettingStateArchival }),
  );
  const costKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({ configSettingId: xdr.ConfigSettingId.configSettingContractLedgerCostV0 }),
  );
  const response = await server.getLedgerEntries(archivalKey, costKey);
  let maxEntryTtl: number | undefined;
  let txMaxDiskReadEntries: number | undefined;
  let txMaxWriteLedgerEntries: number | undefined;
  for (const entry of response.entries) {
    if (entry.val.type !== 'configSetting') continue;
    const setting = entry.val.configSetting;
    if (setting.type === 'configSettingStateArchival') {
      maxEntryTtl = setting.stateArchivalSettings.maxEntryTtl;
    } else if (setting.type === 'configSettingContractLedgerCostV0') {
      txMaxDiskReadEntries = setting.contractLedgerCost.txMaxDiskReadEntries;
      txMaxWriteLedgerEntries = setting.contractLedgerCost.txMaxWriteLedgerEntries;
    }
  }
  if (maxEntryTtl === undefined || txMaxDiskReadEntries === undefined || txMaxWriteLedgerEntries === undefined) {
    throw new Error('Could not read the network settings');
  }
  return { maxEntryTtl, txMaxDiskReadEntries, txMaxWriteLedgerEntries };
}

async function attempt(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.log(`  ${name} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  console.log(`RPC: ${RPC_URL}\n`);

  // E3 (on paper): the limits the network enforces for one transaction.
  const settings = await readSettings();
  console.log('E3: per-transaction limits from the network settings');
  console.log(`  txMaxDiskReadEntries    ${settings.txMaxDiskReadEntries}`);
  console.log(`  txMaxWriteLedgerEntries ${settings.txMaxWriteLedgerEntries}`);
  console.log(`  maxEntryTtl             ${settings.maxEntryTtl} ledgers\n`);

  // Two accounts: the creator, and a stranger who has nothing to do with the contracts.
  const creator = Keypair.random();
  const stranger = Keypair.random();
  console.log(`creator  ${creator.publicKey()}`);
  console.log(`stranger ${stranger.publicKey()}`);
  await server.fundAddress(creator.publicKey());
  await server.fundAddress(stranger.publicKey());
  console.log('both accounts funded from the testnet faucet\n');

  // Create CONTRACT_COUNT token contracts. Each one has an instance entry that
  // starts with the minimum lifetime. One transaction can hold only one
  // contract-creating operation, so this is one transaction each.
  const keys: xdr.LedgerKey[] = [];
  for (let i = 1; i <= CONTRACT_COUNT; i++) {
    const asset = new Asset(`KA${i}`, creator.publicKey());
    const account = await server.getAccount(creator.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.createStellarAssetContract({ asset }))
      .setTimeout(60)
      .build();
    await submit(tx, creator);
    keys.push(new Contract(asset.contractId(NETWORK_PASSPHRASE)).getFootprint());
    console.log(`created contract ${i} of ${CONTRACT_COUNT}`);
  }

  const target = Math.min(200_000, settings.maxEntryTtl);
  console.log(`\nbaseline: ledgers remaining for each entry`);
  describe('before', await remaining(keys));

  // E2: the stranger extends an entry that belongs to a contract they did not make.
  console.log(`\nE2: stranger extends entry 1 to ${target} ledgers`);
  await attempt('E2', async () => {
    const first = keys[0];
    if (first === undefined) throw new Error('no entry');
    const result = await extend(stranger, [first], target);
    console.log(`  OK  tx ${result.hash}`);
    console.log(`  max fee ${result.maxFee} stroops, charged ${result.feeCharged} stroops`);
    describe('after ', await remaining(keys));
  });

  // E1: one transaction extends all the other entries.
  const others = keys.slice(1);
  console.log(`\nE1: creator extends entries 2 to ${CONTRACT_COUNT} (${others.length} entries) in ONE transaction`);
  await attempt('E1', async () => {
    const result = await extend(creator, others, target);
    console.log(`  OK  tx ${result.hash}`);
    console.log(`  max fee ${result.maxFee} stroops, charged ${result.feeCharged} stroops`);
    describe('after ', await remaining(keys));
  });

  console.log('\nDone. Paste everything above back to Claude.');
}

main().catch((error: unknown) => {
  console.error('Experiment failed:', error);
  process.exitCode = 1;
});
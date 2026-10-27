// Experiment 03: runs Keepalive's own code end to end on TESTNET (play money only).
//
// What it answers:
//   Does the whole chain work against a real network?
//   read expiry -> plan -> build -> simulate (fee ceiling) -> sign -> send -> read again
//
// How: it makes one throwaway account, funds it from the testnet faucet, creates
// 3 token contracts (each has an instance entry that starts with a short life),
// then lets Keepalive extend them. The secret key lives in memory only and is
// never written anywhere.
//
// Run:  npm run build && node experiments/03-keepalive-testnet.mts

import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import {
  FeeTooHighError,
  buildExtendTransactions,
  hashLedgerKey,
  planExtensions,
  prepareWithFeeCeiling,
  readNetworkSettings,
  readTtls,
  type EntryRef,
} from "../packages/core/dist/index.js";

// This script only ever talks to testnet. Do not change these two lines.
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;

const CONTRACT_COUNT = 3;
const EXTEND_TO = 500_000; // ledgers, about 29 days
const FEE_CEILING_STROOPS = 600_000; // 0.03 XLM, the most one transaction may cost
const LEDGERS_PER_DAY = 17_280;

const server = new rpc.Server(RPC_URL);

/** Sign, send and wait. The transaction must already be prepared (simulated). */
async function signAndSend(
  tx: Transaction,
  signer: Keypair,
): Promise<{ hash: string; feeCharged: string }> {
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR")
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  const done = await server.pollTransaction(sent.hash);
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `transaction ${sent.hash} ended with status ${done.status}`,
    );
  }
  return { hash: sent.hash, feeCharged: String(done.resultXdr.feeCharged) };
}

function describe(
  label: string,
  entries: Array<{
    band: string;
    liveUntilLedger: number | null;
    latestLedger: number;
  }>,
) {
  console.log(`  ${label}:`);
  for (const e of entries) {
    const left =
      e.liveUntilLedger === null
        ? "missing"
        : `${e.liveUntilLedger - e.latestLedger} ledgers (~${((e.liveUntilLedger - e.latestLedger) / LEDGERS_PER_DAY).toFixed(1)} days)`;
    console.log(`    ${e.band.padEnd(14)} ${left}`);
  }
}

async function main(): Promise<void> {
  console.log(`RPC: ${RPC_URL} (testnet)\n`);

  const creator = Keypair.random();
  console.log(`throwaway account ${creator.publicKey()}`);
  await server.fundAddress(creator.publicKey());
  console.log("funded from the testnet faucet\n");

  // Create the contracts we will keep alive. One transaction each.
  const refs: EntryRef[] = [];
  for (let i = 1; i <= CONTRACT_COUNT; i++) {
    const asset = new Asset(`KA${i}`, creator.publicKey());
    const account = await server.getAccount(creator.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.createStellarAssetContract({ asset }))
      .setTimeout(60)
      .build();
    const prepared = await server.prepareTransaction(tx);
    await signAndSend(prepared, creator);

    const contractId = asset.contractId(PASSPHRASE);
    const key = new Contract(contractId).getFootprint();
    refs.push({
      contractId,
      kind: "instance",
      ledgerKeyXdr: key.toXDR("base64"),
      keyHash: hashLedgerKey(key),
      source: "explicit",
    });
    console.log(`created contract ${i} of ${CONTRACT_COUNT}: ${contractId}`);
  }

  // 1. Read. The thresholds are chosen so these fresh entries count as "expiring soon".
  const thresholds = { expiringSoon: 200_000, critical: 1_000 };
  const before = await readTtls(server, refs, thresholds);
  console.log("\n1. read expiry");
  describe("before", before);

  // 2. Plan. maxBatchSize 2 forces two transactions, to test sequence numbers.
  const settings = await readNetworkSettings(server);
  console.log(
    `\n2. plan (network: maxEntryTtl ${settings.maxEntryTtl}, ${settings.maxEntriesPerTransaction} entries per transaction)`,
  );
  const plan = planExtensions(before, settings, {
    extendToLedgers: EXTEND_TO,
    maxBatchSize: 2,
  });
  console.log(
    `  extendTo ${plan.extendTo}, ${plan.batches.length} transaction(s): ${plan.batches.map((b) => b.entries.length).join(" + ")} entries`,
  );

  // 3. Build and simulate.
  const account = await server.getAccount(creator.publicKey());
  const unsigned = buildExtendTransactions(account, plan, PASSPHRASE);

  console.log("\n3a. fee ceiling check: a ceiling of 100 stroops must refuse");
  const first = unsigned[0];
  if (first === undefined) throw new Error("the plan has no transactions");
  try {
    await prepareWithFeeCeiling(server, first, 100);
    console.log("  FAIL: the ceiling did not stop it");
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof FeeTooHighError)
      console.log(`  OK, refused: ${error.message}`);
    else throw error;
  }

  console.log(
    `\n3b. simulate with the real ceiling of ${FEE_CEILING_STROOPS} stroops, then send in order`,
  );
  for (const [index, tx] of unsigned.entries()) {
    const { transaction, feeStroops } = await prepareWithFeeCeiling(
      server,
      tx,
      FEE_CEILING_STROOPS,
    );
    const result = await signAndSend(transaction, creator);
    console.log(
      `  transaction ${index + 1}: max fee ${feeStroops}, charged ${result.feeCharged} stroops, tx ${result.hash}`,
    );
  }

  // 4. Read again and check.
  const after = await readTtls(server, refs, thresholds);
  console.log("\n4. read expiry again");
  describe("after ", after);

  const tolerance = 200; // ledgers that pass while we wait
  const ok = after.every(
    (e) =>
      e.liveUntilLedger !== null &&
      e.liveUntilLedger - e.latestLedger >= EXTEND_TO - tolerance,
  );
  console.log(
    ok
      ? "\nPASS: every entry now has the planned time left."
      : "\nFAIL: some entries were not extended.",
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Experiment failed:", error);
  process.exitCode = 1;
});

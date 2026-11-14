// Experiment 04 (setup): makes everything needed to try `keepalive extend` on TESTNET.
//
// It creates one throwaway account (play money from the faucet) and one token
// contract whose instance entry starts with a short life. It writes that entry's
// ledger key to a key file and prints the commands to run next.
//
// The secret key is only printed, never written to a file. Testnet keys are play money.
//
// Run:  npm run build && node experiments/04-extend-testnet-setup.mts

import { writeFileSync } from "node:fs";
import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";

// Testnet only. Do not change these two lines.
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const KEYS_FILE = "/tmp/keepalive-testnet-keys.txt";

const server = new rpc.Server(RPC_URL);

async function main(): Promise<void> {
  const creator = Keypair.random();
  console.log(`RPC: ${RPC_URL} (testnet)`);
  console.log(`throwaway account ${creator.publicKey()}`);
  await server.fundAddress(creator.publicKey());
  console.log("funded from the testnet faucet");

  const asset = new Asset("KAEXT", creator.publicKey());
  const account = await server.getAccount(creator.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.createStellarAssetContract({ asset }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(creator);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const done = await server.pollTransaction(sent.hash);
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${sent.hash} ended with status ${done.status}`);
  }

  const contractId = asset.contractId(PASSPHRASE);
  const key = new Contract(contractId).getFootprint();
  writeFileSync(
    KEYS_FILE,
    `# instance entry of ${contractId} (testnet)\n${key.toXDR("base64")}\n`,
  );

  console.log(`\ncreated contract ${contractId}`);
  console.log(`wrote its ledger key to ${KEYS_FILE}\n`);
  console.log("Next, in this same terminal window:\n");
  console.log(`  export KEEPALIVE_SECRET=${creator.secret()}`);
  console.log(`  C=${contractId}`);
  console.log(`  node apps/cli/dist/index.js check  $C --network testnet --keys-file ${KEYS_FILE}`);
  console.log(`  node apps/cli/dist/index.js extend $C --network testnet --keys-file ${KEYS_FILE}`);
  console.log(`  node apps/cli/dist/index.js extend $C --network testnet --keys-file ${KEYS_FILE} --yes`);
  console.log(`  node apps/cli/dist/index.js check  $C --network testnet --keys-file ${KEYS_FILE}`);
}

main().catch((error: unknown) => {
  console.error("Setup failed:", error);
  process.exitCode = 1;
});

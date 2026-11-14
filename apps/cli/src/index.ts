#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import {
  ExtendFailedError,
  ExplicitSource,
  HubbleSource,
  parseKeyList,
  planExtensions,
  planRestores,
  prepareExtension,
  prepareRestore,
  readNetworkSettings,
  readTtls,
  sendExtension,
  type DiscoverySource,
  type EntryRef,
  type EntryTtl,
  type PreparedExtension,
} from '@keepalive/core';
import { StrKey, rpc, type Account, type Keypair, type Transaction } from '@stellar/stellar-sdk';
import { DEFAULT_MAX_BYTES_BILLED, createBigQueryRunner } from './bigquery-runner.js';
import {
  formatOutcomes,
  formatPrepared,
  formatRestorePlan,
  formatRestorePrepared,
} from './extend-format.js';
import { LEDGERS_PER_DAY, formatPlan, formatReport } from './format.js';
import { networkFor, requireTestnetForSending, type NetworkConfig } from './networks.js';
import { readKeypair, SECRET_ENV } from './secret.js';
import { getVersion } from './version.js';

const VERSION = getVersion();
// check and plan use mainnet unless you pass --network. --rpc picks another RPC server.
const DEFAULT_NETWORK = 'mainnet';
const DEFAULT_MAX_FEE_STROOPS = 1_000_000;

const HELP = `keepalive ${VERSION}

Usage:
  keepalive check <contract-id> [options]   Show how long each storage entry has left
  keepalive plan <contract-id> [options]    Show what would be extended (sends nothing)
  keepalive extend <contract-id> [options]  Extend entries. TESTNET ONLY, needs --keys-file. Dry run unless --yes.
  keepalive restore <contract-id> [options] Restore archived entries. Same rules as extend.

Entries are found through Hubble (mainnet only), or from a file of ledger keys
you give with --keys-file. Their expiry is read from the Stellar RPC.

Options:
  --project <id>       Google Cloud project that runs the Hubble query.
                       Or set GOOGLE_CLOUD_PROJECT. Not needed with --keys-file.
  --keys-file <path>   Use the ledger keys in this file instead of Hubble: one base64
                       XDR LedgerKey per line, '#' starts a comment. Works on testnet.
  --network <name>     testnet or mainnet (default ${DEFAULT_NETWORK}; extend needs it spelled out)
  --rpc <url>          Stellar RPC server (default: a public one for the network)
  --max-fee <stroops>  extend, restore: refuse if all transactions together could cost more
                       than this (default ${DEFAULT_MAX_FEE_STROOPS} stroops = 0.1 XLM)
  --yes                extend, restore: really send. Without it, they only show what they would do.
  --limit <n>          Most entries to fetch from Hubble (default 10000)
  --show <n>           check: how many of the soonest-expiring entries to print (default 20)
  --warn-days <n>      "expiring_soon" below this many days left (default 30)
  --critical-days <n>  "critical" below this many days left (default 7)
  --extend-days <n>    plan: extend entries to at least this many days (default 90)
  --max-gb <n>         Refuse any Hubble query that would bill more than this (default 2)
  -v, --version        Print the version
  -h, --help           Print this help

extend and restore read the secret key of the paying account from ${SECRET_ENV} (never from an option).
`;

const OPTIONS = {
  project: { type: 'string' },
  'keys-file': { type: 'string' },
  rpc: { type: 'string' },
  network: { type: 'string' },
  'max-fee': { type: 'string' },
  yes: { type: 'boolean' },
  limit: { type: 'string' },
  show: { type: 'string' },
  'warn-days': { type: 'string' },
  'critical-days': { type: 'string' },
  'extend-days': { type: 'string' },
  'max-gb': { type: 'string' },
} as const;

function positiveNumber(name: string, text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${text}"`);
  }
  return value;
}

interface Loaded {
  network: NetworkConfig;
  contractId: string;
  server: rpc.Server;
  entries: EntryTtl[];
  show: number;
  extendDays: number;
}

/** Shared by `check` and `plan`: find the entries (Hubble or a key file), then read their expiry. */
async function load(argv: string[]): Promise<Loaded> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });

  const contractId = positionals[0];
  if (contractId === undefined || !StrKey.isValidContract(contractId)) {
    throw new Error('Give a contract id that starts with C, for example: keepalive check CAS3J7...');
  }
  const limit = positiveNumber('--limit', values.limit, 10_000);
  const show = positiveNumber('--show', values.show, 20);
  const warnDays = positiveNumber('--warn-days', values['warn-days'], 30);
  const criticalDays = positiveNumber('--critical-days', values['critical-days'], 7);
  const extendDays = positiveNumber('--extend-days', values['extend-days'], 90);
  const maxGb = positiveNumber('--max-gb', values['max-gb'], DEFAULT_MAX_BYTES_BILLED / 1e9);
  if (criticalDays > warnDays) throw new Error('--critical-days must not be larger than --warn-days');

  const network = networkFor(values.network ?? DEFAULT_NETWORK);
  const rpcUrl = values.rpc ?? network.rpcUrl;
  const keysFile = values['keys-file'];
  let source: DiscoverySource;
  if (keysFile !== undefined) {
    console.error(`Reading ledger keys from ${keysFile}...`);
    source = new ExplicitSource(parseKeyList(readFileSync(keysFile, 'utf8')));
  } else {
    const project = values.project ?? process.env['GOOGLE_CLOUD_PROJECT'];
    if (project === undefined) {
      throw new Error(
        'No Google Cloud project. Pass --project <id> or set GOOGLE_CLOUD_PROJECT, or use --keys-file.',
      );
    }
    console.error(`Finding entries through Hubble (project ${project})...`);
    source = new HubbleSource(createBigQueryRunner(project, Math.round(maxGb * 1e9)), limit);
  }
  const refs: EntryRef[] = [];
  for await (const ref of source.discover(contractId)) refs.push(ref);

  console.error(`Found ${refs.length}. Reading expiry from ${rpcUrl}...`);
  const server = new rpc.Server(rpcUrl);
  const entries = await readTtls(server, refs, {
    expiringSoon: Math.round(warnDays * LEDGERS_PER_DAY),
    critical: Math.round(criticalDays * LEDGERS_PER_DAY),
  });
  if (keysFile === undefined && refs.length >= limit) {
    console.error(`Note: stopped at the --limit of ${limit}; the contract may have more entries.`);
  }
  return { network, contractId, server, entries, show: Math.round(show), extendDays };
}

async function check(argv: string[]): Promise<void> {
  const { contractId, entries, show } = await load(argv);
  console.log(formatReport(contractId, entries, show));
}

async function plan(argv: string[]): Promise<void> {
  const { contractId, server, entries, extendDays } = await load(argv);
  console.error('Reading the network limits...');
  const settings = await readNetworkSettings(server);
  const result = planExtensions(entries, settings, {
    extendToLedgers: Math.round(extendDays * LEDGERS_PER_DAY),
  });
  console.log(formatPlan(contractId, result, settings.maxEntryTtl));
}

/** Signs with the key, sends, and waits until the network has finished the transaction. */
function signAndSendWith(server: rpc.Server, signer: Keypair) {
  return async (transaction: Transaction) => {
    transaction.sign(signer);
    const sent = await server.sendTransaction(transaction);
    if (sent.status === 'ERROR') {
      throw new Error(`the network refused it: ${JSON.stringify(sent.errorResult)}`);
    }
    const done = await server.pollTransaction(sent.hash);
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`transaction ${sent.hash} ended with status ${done.status}`);
    }
    return { hash: sent.hash, feeChargedStroops: Number(String(done.resultXdr.feeCharged)) };
  };
}

/** What differs between `extend` and `restore`. Everything else is shared, so the safety checks exist once. */
interface Work {
  batches: ReadonlyArray<{ entries: readonly unknown[] }>;
  /** printed before anything else */
  summary: string;
  /** printed when there is nothing to do */
  nothing: string;
  prepare(source: Account): Promise<PreparedExtension>;
  /** printed after simulation: what will be sent and what it can cost */
  describe(prepared: PreparedExtension): string;
  /** printed after a successful send */
  next?: string;
}

async function sendCommand(argv: string[], command: 'extend' | 'restore'): Promise<void> {
  const { values } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  if (values.network === undefined) {
    throw new Error(`${command} needs --network testnet (the network is never guessed).`);
  }
  // Both checks come first, before any network call and before the key is read.
  requireTestnetForSending(networkFor(values.network));
  if (values['keys-file'] === undefined) {
    throw new Error(
      `${command} needs --keys-file for now. Hubble only knows mainnet, so it cannot find testnet entries.`,
    );
  }
  const loaded = await load(argv);

  const maxFee = positiveNumber('--max-fee', values['max-fee'], DEFAULT_MAX_FEE_STROOPS);
  if (!Number.isInteger(maxFee)) throw new Error('--max-fee must be a whole number of stroops');

  console.error('Reading the network limits...');
  const settings = await readNetworkSettings(loaded.server);
  const common = { networkPassphrase: loaded.network.passphrase, feeCeilingStroops: maxFee, preparer: loaded.server };

  let work: Work;
  if (command === 'extend') {
    const plan = planExtensions(loaded.entries, settings, {
      extendToLedgers: Math.round(loaded.extendDays * LEDGERS_PER_DAY),
    });
    work = {
      batches: plan.batches,
      summary: formatPlan(loaded.contractId, plan, settings.maxEntryTtl),
      nothing: 'Nothing to extend.',
      prepare: (source) => prepareExtension({ ...common, plan, source }),
      describe: (prepared) => formatPrepared(prepared, plan.extendTo, maxFee),
    };
  } else {
    const plan = planRestores(loaded.entries, settings);
    work = {
      batches: plan.batches,
      summary: formatRestorePlan(loaded.contractId, plan),
      nothing: 'Nothing to restore.',
      prepare: (source) => prepareRestore({ ...common, plan, source }),
      describe: (prepared) => formatRestorePrepared(prepared, maxFee),
      next: 'Restored entries get only a short life. Run `keepalive extend` next to give them a long one.',
    };
  }

  console.log(work.summary);
  if (work.batches.length === 0) {
    console.log(`\n${work.nothing}`);
    return;
  }

  const signer = readKeypair(process.env);
  const reported = (await loaded.server.getNetwork()).passphrase;
  if (reported !== loaded.network.passphrase) {
    throw new Error('The RPC server is on a different network than --network. Nothing was sent.');
  }
  const source = await loaded.server.getAccount(signer.publicKey());

  console.error('Simulating the transactions...');
  const prepared = await work.prepare(source);
  console.log(`\nPaying account: ${signer.publicKey()}`);
  console.log(work.describe(prepared));

  if (values.yes !== true) {
    console.log('\nDry run: nothing was sent. Add --yes to send.');
    return;
  }

  console.error('Sending...');
  try {
    const outcomes = await sendExtension(prepared, work, signAndSendWith(loaded.server, signer));
    console.log(`\nDone.\n${formatOutcomes(outcomes)}`);
    if (work.next !== undefined) console.log(`\n${work.next}`);
  } catch (error) {
    if (error instanceof ExtendFailedError && error.completed.length > 0) {
      console.error(`Already sent before the failure:\n${formatOutcomes(error.completed)}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '-v' || command === '--version') {
    console.log(VERSION);
  } else if (command === 'check') {
    await check(rest);
  } else if (command === 'plan') {
    await plan(rest);
  } else if (command === 'extend' || command === 'restore') {
    await sendCommand(rest, command);
  } else {
    console.log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
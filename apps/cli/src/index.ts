#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import {
  ExplicitSource,
  HubbleSource,
  parseKeyList,
  planExtensions,
  readNetworkSettings,
  readTtls,
  type DiscoverySource,
  type EntryRef,
  type EntryTtl,
} from '@keepalive/core';
import { StrKey, rpc } from '@stellar/stellar-sdk';
import { DEFAULT_MAX_BYTES_BILLED, createBigQueryRunner } from './bigquery-runner.js';
import { LEDGERS_PER_DAY, formatPlan, formatReport } from './format.js';
import { getVersion } from './version.js';

const VERSION = getVersion();
// A public third-party mainnet RPC from the Stellar docs. Use --rpc to choose another.
const DEFAULT_RPC = 'https://mainnet.sorobanrpc.com';

const HELP = `keepalive ${VERSION}

Usage:
  keepalive check <contract-id> [options]   Show how long each storage entry has left
  keepalive plan <contract-id> [options]    Show what would be extended (sends nothing)

Entries are found through Hubble (mainnet only), or from a file of ledger keys
you give with --keys-file. Their expiry is read from the Stellar RPC.

Options:
  --project <id>       Google Cloud project that runs the Hubble query.
                       Or set GOOGLE_CLOUD_PROJECT. Not needed with --keys-file.
  --keys-file <path>   Use the ledger keys in this file instead of Hubble: one base64
                       XDR LedgerKey per line, '#' starts a comment. Works on testnet.
  --rpc <url>          Stellar mainnet RPC (default ${DEFAULT_RPC})
  --limit <n>          Most entries to fetch from Hubble (default 10000)
  --show <n>           check: how many of the soonest-expiring entries to print (default 20)
  --warn-days <n>      "expiring_soon" below this many days left (default 30)
  --critical-days <n>  "critical" below this many days left (default 7)
  --extend-days <n>    plan: extend entries to at least this many days (default 90)
  --max-gb <n>         Refuse any Hubble query that would bill more than this (default 2)
  -v, --version        Print the version
  -h, --help           Print this help
`;

const OPTIONS = {
  project: { type: 'string' },
  'keys-file': { type: 'string' },
  rpc: { type: 'string' },
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

  const rpcUrl = values.rpc ?? DEFAULT_RPC;
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
  return { contractId, server, entries, show: Math.round(show), extendDays };
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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '-v' || command === '--version') {
    console.log(VERSION);
  } else if (command === 'check') {
    await check(rest);
  } else if (command === 'plan') {
    await plan(rest);
  } else {
    console.log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
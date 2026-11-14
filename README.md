# Keepalive

Keepalive keeps Stellar smart contract storage from expiring.

Every Soroban contract storage entry has a time to live (TTL) that someone has to extend. When it runs out, a temporary entry is deleted for good, and a persistent or instance entry is archived. Archived entries can be restored, but restoring costs fees and can break the contract's users in the meantime.

The Stellar RPC cannot list a contract's storage entries: `getLedgerEntries` only looks up keys you already know. Keepalive's main idea is to **find the entries automatically** through Hubble (the public Stellar dataset on Google BigQuery), read their live expiry from the RPC, and plan or send the transactions that extend them.

## Status

Early, and honest about it. Everything below is covered by unit tests, and the sending path has been run end to end on testnet.

| Feature | State |
|---|---|
| `check`: find a contract's entries and show how long each has left | Works on mainnet (through Hubble) and on any network (through a key file) |
| `plan`: show which entries would be extended and how many transactions it takes. Sends nothing. | Works |
| `extend`: build, simulate, sign and send the extension transactions | Works on **testnet only**. Mainnet is refused on purpose until it has its own safety review. |
| Restore archived entries | Not started ([issue #8](https://github.com/Songu3020/keepalive/issues/8)) |
| Long-running watcher with alerts | Not started |
| CI check for a missing TTL extension in contract source | Not started |

The evidence behind each design decision is in [experiments/README.md](experiments/README.md), and the plan is in [docs/architecture.md](docs/architecture.md).

## Quick start

You need Node.js 22.12 or newer.

```bash
git clone https://github.com/Songu3020/keepalive.git
cd keepalive
npm install
npm run build
```

Then run the CLI with `node apps/cli/dist/index.js <command>` (written below as `keepalive`).

### Check a contract (mainnet, through Hubble)

Hubble runs on Google BigQuery. A one-contract lookup reads roughly 100 to 300 MB, which fits the BigQuery sandbox free tier (no billing needed). Keepalive refuses any query that would bill more than 2 GB (`--max-gb` changes that).

```bash
gcloud auth application-default login
keepalive check <contract-id> --project <your-google-cloud-project>
```

### Check a contract from a list of keys (any network, no Google account)

Put one base64 `LedgerKey` per line in a file (`#` starts a comment), then:

```bash
keepalive check <contract-id> --keys-file keys.txt --network testnet
```

Example output (the instance entry of the mainnet XLM contract):

```
Contract CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA: 1 entries
  healthy        1

Soonest to expire (ledger 65467940):
  healthy        instance    148.5 days   a63213d713ef
```

Entries fall into bands: `healthy`, `expiring_soon` (under 30 days by default), `critical` (under 7 days), `archived` (expired but restorable), `deleted` (an expired temporary entry) and `not_found`.

### Plan an extension

```bash
keepalive plan <contract-id> --keys-file keys.txt --network testnet --extend-days 90
```

This lists the entries that need extending, the entries it skipped and why, and how they are grouped into transactions. Limits such as the longest allowed life are read from the network at run time, never hardcoded.

### Extend (testnet only)

The paying account's secret key is read from the `KEEPALIVE_SECRET` environment variable. It is never accepted as an option, because options end up in shell history, and it is never printed.

```bash
export KEEPALIVE_SECRET=S...            # a testnet account with some XLM
keepalive extend <contract-id> --network testnet --keys-file keys.txt            # dry run
keepalive extend <contract-id> --network testnet --keys-file keys.txt --yes      # really send
```

Without `--yes` it only simulates and shows what it would do. A real run on testnet looked like this:

```
Will send 1 transaction(s) to extend 1 entries,
each to at least 1555200 ledgers of life.
Most it can cost: 687473 stroops (0.0687473 XLM),
under your ceiling of 1000000 stroops. The real charge is usually lower.
Sending...

Done.
  transaction 1: 1 entries, charged 593789 stroops, tx 3bf005e5b9e24a41cce024ef6123a3fd0c77964c999fb98cdfb2c0a2053b02cd
```

Afterwards `check` showed the entry `healthy` with 90.0 days left. The full result is in [experiments/README.md](experiments/README.md) (experiment 04).

## Safety rules

- Sending is refused on mainnet, and `--network` must be written out, never guessed. Both checks run before any network call and before the key is read.
- A fee ceiling (`--max-fee`, default 1,000,000 stroops = 0.1 XLM) covers all transactions together. If the simulated maximum is above it, nothing is sent.
- Transactions are sent one at a time, in order, and it stops at the first failure and reports what already went through.
- Tests never use the network. Anything that sends transactions is verified on testnet first.

## Development

```bash
npm install
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md), including the rules for using AI tools. Open issues with a clear scope are labelled `good first issue` and `help wanted`. Security reports: see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

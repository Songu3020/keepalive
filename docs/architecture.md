# Architecture

## The problem

Every Soroban contract storage entry has a time to live (TTL) that someone must extend. When it reaches zero, a temporary entry is deleted for good, and a persistent or instance entry is archived. Since Protocol 23, an archived entry is restored automatically when a simulated transaction touches it, and the sender pays the restore fee. Manual restore is still used when auto-restore makes a transaction too large, or when a developer wants to pay instead of their users.

Tools that extend entries need the entries' keys. The Stellar RPC cannot list a contract's storage: `getLedgerEntries` looks up keys you already know, at most 200 per call. Keepalive's main idea is to find the keys automatically, through Hubble, and then read live expiry from the RPC.

## What exists today

### `packages/core` (the logic, no network of its own)

| Module | What it does |
|---|---|
| `types.ts` | Shared types: entry references, expiry bands, the discovery-source interface |
| `bands.ts` | `classifyBand`: turns an expiry ledger into healthy, expiring_soon, critical, archived, deleted or not_found |
| `ledger-key.ts` | Rebuilds a LedgerKey from Hubble's `contract_data_xdr` and computes its hash |
| `hubble.ts` | `HubbleSource`: finds a contract's entries through a `QueryRunner` (the BigQuery client plugs in here) |
| `reader.ts` | `readTtls`: asks the RPC for each entry's expiry, in batches of 200, and classifies it |
| `network.ts` | `readNetworkSettings`: reads maximum entry life and the per-transaction entry cap from the network |
| `planner.ts` | `planExtensions`: chooses which entries to extend and groups them into transactions |
| `transaction.ts` | Builds unsigned extend transactions, simulates them, and enforces a fee ceiling |

Each module that needs the outside world takes a small interface (`QueryRunner`, `LedgerEntryFetcher`, `SettingsFetcher`, `TransactionPreparer`). The real clients fit those interfaces, and tests pass fakes.

### `apps/cli`

| Command | What it does |
|---|---|
| `keepalive check <contract>` | Finds entries through Hubble, reads expiry from the RPC, prints a report |
| `keepalive plan <contract>` | The same, then prints what would be extended. Sends nothing. |

The CLI also holds the BigQuery wiring (with a per-query cost cap) and the text formatting.

## Data flow

```
Hubble (BigQuery)               Stellar RPC
  contract_data_current           getLedgerEntries
          |                              |
  HubbleSource.discover   keys   readTtls (batches of 200)
          |  ------------------>         |
          |                              v
          +----------------------> classifyBand
                                         |
                       readNetworkSettings --> planExtensions
                                         |
                              buildExtendTransactions
                                         |
                          prepareWithFeeCeiling (simulate)
                                         |
                         unsigned transactions (caller signs)
```

## Decisions and the evidence behind them

The experiments are recorded in `experiments/README.md`.

| Decision | Why | Evidence |
|---|---|---|
| Find entries through Hubble's `contract_data_current` | The RPC cannot list a contract's entries | E6 |
| Rebuild each key from `contract_data_xdr` | It holds the contract, key and durability. The rebuilt key hashes to exactly Hubble's `ledger_key_hash`. | E6 |
| Use the `_current` tables and cap every query at 2 GB | A one-contract lookup reads about 100 to 300 MB, while the raw history tables are 1.4 TB. One lookup briefly needed 175 GB, and the cap refused it without charge. | E6, 2026-10-26 incident |
| Take expiry from the RPC, not Hubble | Hubble lags the network by minutes and also lists deleted entries | E6, first live run |
| Read network limits at runtime | Documentation pages disagreed with the network | E4 |
| Work in ledgers, convert to days only for display | The network defines TTL in ledgers | E4 |
| Put entries in the read-only footprint, as the only operation | That is what ExtendFootprintTTL requires | E1, E2 |
| Build unsigned transactions, simulate first, enforce a fee ceiling | The charge depends on entries times extension length, and the maximum fee is above the real charge | E1, experiment 03 |
| A missing temporary entry is `deleted`, a missing persistent entry is `not_found` | Temporary entries are removed at expiry. For persistent entries we cannot tell why the RPC omitted one. | E5 on mainnet |
| Default batch of 50 entries | The network allows 200 on testnet, but only small batches were tested | E3 (partial), experiment 03 |

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Core reader and expiry bands | Done |
| 2 | Planner and unsigned extend transactions | Done, verified end to end on testnet (experiment 03) |
| 3 | Hubble discovery | Done, verified on mainnet reads |
| 4 | `extend` command that signs and sends, mainnet-safe | Next |
| 5 | Restore command for archived entries | Not started |
| 6 | Long-running daemon with saved state and alerts | Not started |
| 7 | CI check for missing TTL extension in contract source | Not started |
| - | Discovery without Hubble (deterministic instance and code entries, Galexie) | Not started |

## Open questions

- The largest safe batch size (E3 stress test).
- What the RPC returns for an archived entry on testnet, and the exact restore flow (E5).
- Whether the longest allowed `extendTo` is `maxEntryTtl` or `maxEntryTtl - 1`. The code uses the lower one to be safe.
- Whether extension cost is exactly proportional to the ledgers added. Three testnet data points are consistent with it. Mainnet fee settings may differ.
- How stable Hubble's table layout and cost are over time.
- Reliance on third-party public mainnet RPC endpoints.

## Non-goals, for now

- Keepalive does not hold keys. Signing happens outside the library.
- It is not a hosted service.

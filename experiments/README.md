# Experiments to run on testnet before milestone 1

| #   | Question                                                                                                                                                     | Why it matters                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| E1  | Can one extend transaction carry several entries? One docs page says the op takes entries in its footprint. The JS guide says one footprint per transaction. | Sets cost and sequence-number handling.                   |
| E2  | Can an unrelated funded account extend another contract's entries?                                                                                           | Decides whether the tool works from outside the contract. |
| E3  | How many entries fit in one transaction before simulation fails?                                                                                             | Sets batch size.                                          |
| E4  | How does the keeper read max and min TTL at runtime?                                                                                                         | Needed for a correct extendTo.                            |
| E5  | What does getLedgerEntries return for an archived entry versus a deleted temporary one?                                                                      | Defines the band logic for expired entries.               |
| E6  | Can a LedgerKey be rebuilt from Hubble columns alone, and what does a typical query cost?                                                                    | Decides whether Hubble discovery works.                   |

Record each result in this file with the date and the exact commands used.

## Results

Run on 2026-10-26 against Stellar testnet with @stellar/stellar-sdk 17.4.0.
Commands: `node experiments/01-read-ttl.mts`, `node experiments/02-extend.mts`.

| #   | Result                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Yes. 4 entries extended in one transaction (tx 3b749aa131f0660dcc9b402beccf37ecf6b0df1bf838cb398dbc36099b20dcfa). Fee charged 126,601 stroops, against 32,512 for 1 entry. Cost is almost entirely per entry, so batching saves about 3% in fees. |
| E2  | Yes. An account that did not create the contract extended its instance entry from about 7 to about 11.6 days (tx 2977c4bd8637634e81068b98fb4dd4653099c5d251cbc188a7ffb7e216c35e48). Tested only on token contract instance entries.               |
| E3  | Partly. The network settings allow 200 disk read entries and 200 write entries per transaction. Only 4 entries were tested, so the real maximum is unknown.                                                                                       |
| E4  | Done. maxEntryTtl 3,110,400 ledgers (180 days), minPersistentTtl 120,960 (7 days), minTemporaryTtl 720 (1 hour). These differ from numbers in some Stellar docs pages, so Keepalive must read them from the network.                              |
| E5  | Partly. A missing entry is left out of the getLedgerEntries answer. Not yet tested: what an archived entry looks like.                                                                                                                            |
| E6  | Yes, GO. A LedgerKey can be rebuilt from Hubble's `contract_data_xdr`, and the hash matched. A lookup costs about 91 to 217 MB. Details below.                                                                                                    |

### E6: Hubble discovery (2026-10-26) - GO

- Hubble `crypto_stellar_dbt.contract_data_current` is clustered by contract_id.
  Listing one contract's entries: ~91 MB. With the XDR column: ~217 MB.
- The key rebuilds from `contract_data_xdr` (a ContractDataEntry): take contract,
  key and durability, build the LedgerKey. sha256 of its XDR matched Hubble's
  `ledger_key_hash` exactly (mainnet XLM contract, one Balance entry).
- Expiry: `ttl_current.live_until_ledger_seq`, looked up by key_hash: ~47 MB.
  Example: live_until 66,921,804, last modified 64,848,205 (a 120-day extension).
- Do NOT use raw `contract_data`/`ttl` (1,441 GB / 165 GB) or join the two
  current tables without testing: a join estimated 256 GB.
- Limits: mainnet only, 5-10 min lag, one entry of one contract tested.
  Confirm with RPC before extending.
- Sandbox allowance: 1 TiB/month. Always read "will process" before Run.

### E5 on mainnet, first live run (2026-10-26)

`keepalive check CAS3J7... --limit 20` on the mainnet XLM contract:
12 healthy, 1 expiring_soon, 4 archived, 3 not_found.

- The mainnet RPC returned 4 archived persistent entries with a past
  liveUntilLedgerSeq (seen for 4 entries; may be entries awaiting eviction).
- The 3 not_found entries are all temporary. Hubble's contract_data_current
  still lists deleted temporary entries, so discovery must not assume every
  Hubble row is a live entry.

  ### Hubble cost is not guaranteed (2026-10-26)

The same discovery query billed ~200 MB, then was refused by the 2 GB cap
(BigQuery needed ~175 GB), then worked again about 10 minutes later. Likely
cause: Hubble rebuilt contract_data_current and it was briefly not
clustered by contract_id (unconfirmed). Design rule: every Hubble query
keeps a bytes-billed cap, and discovery must handle a refusal gracefully.

## Experiment 03: Keepalive end to end on testnet (2026-10-26) - PASS

Script: `node experiments/03-keepalive-testnet.mts` (uses packages/core, not raw SDK calls).
3 token-contract instance entries, 7.0 days -> 28.9 days (extendTo 500,000).
Plan split them 2 + 1 into two transactions; both succeeded in order.

- A fee ceiling of 100 stroops refused; the real ceiling (600,000) allowed both.
- tx 1 (2 entries): max fee 339,821, charged 291,497 stroops.
- tx 2 (1 entry):   max fee 172,887, charged 146,323 stroops.
- Cost is ~146k stroops per entry whatever the batch size, so batching saves
  almost nothing. Cost per entry per ledger added: ~0.38 here, ~0.40 in E1,
  consistent with cost growing in proportion to the extension length.
  Testnet numbers; mainnet fee settings can differ. Charged fee was ~14%
  below the maximum fee.

## Experiment 04: `keepalive extend` on testnet (the real command)

Question: does the finished `keepalive extend` command extend a real entry on testnet, with the fee ceiling and dry run working as designed?

How: `experiments/04-extend-testnet-setup.mts` makes a throwaway funded account and one token contract, and writes the contract's instance key to a key file. Then `check`, `extend` (dry run), `extend --yes` and `check` again, all with `--network testnet --keys-file`.

Result: PASS.
- The dry run planned 1 transaction for 1 entry, extended to 1,555,200 ledgers (90 days), with a maximum fee of 687,473 stroops, under the 1,000,000 ceiling. Nothing was sent.
- With `--yes` it sent the transaction and was charged 593,789 stroops, about 14 percent below the maximum, as in experiment 03.
- The second `check` showed the entry as `healthy` with 90.0 days left.

Safety checks verified by hand: `extend` without `--network` is refused, and `--network mainnet` is refused with a clear message, before any network call and before the key is read.

Not verified: more than one transaction in a row through the command, large batches, and archived entries (those need restore, issue #8). Mainnet sending is deliberately not supported yet.

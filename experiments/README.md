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

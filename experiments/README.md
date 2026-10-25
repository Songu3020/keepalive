# Experiments to run on testnet before milestone 1

| # | Question | Why it matters |
|---|----------|----------------|
| E1 | Can one extend transaction carry several entries? One docs page says the op takes entries in its footprint. The JS guide says one footprint per transaction. | Sets cost and sequence-number handling. |
| E2 | Can an unrelated funded account extend another contract's entries? | Decides whether the tool works from outside the contract. |
| E3 | How many entries fit in one transaction before simulation fails? | Sets batch size. |
| E4 | How does the keeper read max and min TTL at runtime? | Needed for a correct extendTo. |
| E5 | What does getLedgerEntries return for an archived entry versus a deleted temporary one? | Defines the band logic for expired entries. |
| E6 | Can a LedgerKey be rebuilt from Hubble columns alone, and what does a typical query cost? | Decides whether Hubble discovery works. |

Record each result in this file with the date and the exact commands used.

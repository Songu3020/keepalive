# Architecture (v0.1 plan)

## Problem

Contract entries expire unless their TTL is extended. Temporary entries are deleted when it reaches zero. Persistent and instance entries are archived. Since Protocol 23, archived entries are restored automatically when a simulated transaction touches them, and the sender pays the restore fee. Manual restore is still used when auto-restore makes a transaction too large, or when a developer wants to pay the fees instead of their users.

Keepalive pays rent on time, so users do not pay restore fees or hit failed transactions, and temporary entries do not reach zero.

## Scope of v0.1

Discovery, TTL reading, planning, extension, an optional restore command, a CLI and a daemon. A source-code check for missing TTL extension is planned for later and is not part of v0.1.

## Language

TypeScript for the core, CLI and daemon. Rust is reserved for the later source check.

## Rules

- The standard RPC cannot list a contract's storage. getLedgerEntries looks up known keys only, at most 200 per call.
- Discovery sources sit behind one interface: deterministic (instance and code), explicit (user-supplied keys), hubble (BigQuery), and later galexie.
- Extension uses ExtendFootprintTTLOp. It takes entries in the read-only footprint and an extendTo value, and it must be the only operation in its transaction.
- Restore uses RestoreFootprintOp with entries in the read-write footprint. Only persistent and instance entries can be restored.
- Cost comes from simulation. Rent math is not reimplemented.
- Network limits (max TTL, entries per transaction) are read at runtime. Nothing is hardcoded.
- Units are ledgers, not days. About 17,280 ledgers a day at 5-second ledgers.

## Milestones

1. Core reader and bands, deterministic discovery
2. Planner and extend, with unsigned-XDR output
3. Hubble discovery
4. Daemon, SQLite state, webhook alerts
5. Restore command and a check command for CI
6. Docs, CI, and the source check

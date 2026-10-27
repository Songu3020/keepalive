# Keepalive

Keepalive keeps Stellar smart contract storage from expiring.

Every contract entry on Stellar has a time to live (TTL) that someone has to extend. When it runs out, temporary entries are deleted for good, and persistent and instance entries are archived. Archived entries can be restored, but restoring costs fees, and a transaction built without simulation fails when it touches one. Keepalive watches the expiry dates of a contract's entries, renews them before they lapse, and restores archived ones on request.

Status: pre-alpha. The workspace, CI and a TTL band classifier exist. Nothing else is implemented yet. The plan is in docs/architecture.md and the open questions are in experiments/README.md.

## Development

    npm install
    npm run typecheck
    npm test

## License

Not chosen yet.

### Experiment 03: Keepalive end to end on testnet (2026-10-26) - PASS

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

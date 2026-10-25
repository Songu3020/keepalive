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

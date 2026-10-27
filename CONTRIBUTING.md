# Contributing to Keepalive

Thanks for helping. Keepalive finds a Stellar contract's storage entries, shows how long each has left, and plans the transactions that extend them. Small, focused contributions are welcome.

## Set up

You need Node.js 22.12 or newer.

```bash
git clone https://github.com/Songu3020/keepalive.git
cd keepalive
npm install
npm run typecheck
npm test
```

The tests use fakes for the network and for BigQuery, so you do not need a Google account, a Stellar account, or an internet connection to run them.

## How the code is organised

| Folder | What is in it |
|---|---|
| `packages/core` | The logic: expiry bands, key rebuilding, the RPC reader, Hubble discovery, the extend planner, the transaction builder |
| `apps/cli` | The `keepalive` command: argument parsing, BigQuery wiring, text output |
| `experiments` | Scripts and notes that answered design questions on testnet and mainnet. Results are in `experiments/README.md`. |
| `docs` | Architecture notes |

Rule of thumb: logic goes in `packages/core` as a function that takes its inputs and returns a result, with the network hidden behind a small interface. That is what makes it testable with a fake.

## Rules that matter

- **Every behaviour change needs a test.** Fix a bug by adding a test that fails first.
- **No network in tests.** Use the fakes the existing tests use.
- **Never commit secrets.** No secret keys, no Google credentials, no `.env` files. A real key must never appear in code, tests, issues or pull requests.
- **Never hardcode network limits.** Maximum entry life and per-transaction caps differ between networks and change over time. Read them from the network.
- **Hubble queries stay cheap.** Use the `_current` tables, pass values as query parameters (never paste them into the SQL), and keep the bytes-billed cap. Read `experiments/README.md` (E6) before changing a query.
- **Use ledgers as the unit.** Convert to days only for display.
- **Test spending code on testnet only.** Never run anything that sends transactions against mainnet with real funds as part of a contribution.

## Making a change

1. Pick an open issue, or open one first for anything larger than a small fix, so we can agree on the approach.
2. Fork the repository and create a branch.
3. Make the change with tests. Run `npm run typecheck` and `npm test`.
4. Commit with a clear message in the style `type(scope): what changed`, for example `fix(core): ...`, `feat(cli): ...`, `docs: ...`, `test: ...`.
5. Open a pull request and fill in the template. CI must pass before review.

## Reporting problems

- Bugs and ideas: open an issue using the templates.
- Security problems: do not open a public issue. See [SECURITY.md](SECURITY.md).

Please be respectful and patient with other contributors.

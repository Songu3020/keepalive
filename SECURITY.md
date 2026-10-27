# Security policy

Keepalive is pre-alpha software. It reads public data and builds unsigned transactions. It does not yet send transactions on mainnet.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what you think the impact is.

The maintainer aims to reply within 7 days. This is a one-person project, so please be patient.

## What counts

Examples of problems we want to hear about:

- Anything that could leak or mishandle a secret key or Google credential
- A way to get around the fee ceiling or the BigQuery bytes-billed cap
- A transaction built with the wrong entries, wrong extension length, or the wrong network
- Input (a contract id, an RPC response, a Hubble row) that makes the tool misbehave dangerously

## Never include secrets

Do not put a real secret key, seed phrase or credential in a report, issue or pull request. Use testnet keys, or describe the problem without the key.

## Supported versions

Only the latest commit on `main` is supported while the project is pre-alpha.

# Isolated Sepolia standings worker

Default-off scheduled publication for a separately reviewed future tournament.
This is a new worker project, distinct from the main app and existing indexer.
No signing credentials, token deployment, funding or payout path exists here.

The [implementation and activation runbook](../../docs/onchain-sepolia-rewards-and-automatic-standings-2026-10-19.md)
documents the reviewed policy, durable/fenced checkpoints, least-privilege role,
resource limits, recovery and separate future activation requirements.

`prepare.mjs` produces a private deployment package from clean committed
`onchain-sepolia` source. It never deploys. `schema.sql` is for separate review
on the isolated preview database, after the explicit future-tournament migration.
Leave `ONCHAIN_STANDINGS_ENABLED` unset or false until activation is authorized.

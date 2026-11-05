# Isolated Sepolia resolver scheduler

Default-off, credential-limited scheduling for the `onchain-sepolia` preview.
The worker calls one immutable preview endpoint; database access, evidence
validation and durable signing stay inside that preview. No RPC, database,
Turnkey or private-key credentials belong in this worker project.

See the [implementation and release runbook](../../docs/onchain-sepolia-admin-settlement-and-resolver-2026-11-04.md).

`prepare.mjs --output NEW_PRIVATE_DIRECTORY --target IMMUTABLE_PREVIEW_ENDPOINT`
creates a standby package from clean committed source with no cron.
Adding `--active` creates a package with a five-minute cron; it does not deploy
or enable anything. The source branch, SHA, mode and target are embedded.
An active package must still pass all project/secret/flag/source-SHA guards.

Worker settings for a later release:

- `PREVIEW_RESOLVER_PROJECT_ID`: this separate worker's own Vercel project ID.
- `CRON_SECRET`: worker-only bearer secret, at least 32 characters.
- `RESOLVER_TRIGGER_SECRET`: separate main-preview trigger secret, at least 32
  characters; matches the preview's `ONCHAIN_RESOLVER_CRON_SECRET`.
- `ONCHAIN_RESOLVER_WORKER_ENABLED`: leave unset/false before authorized activation.
- `PREVIEW_PROTECTION_BYPASS_SECRET`: optional preview protection bypass for the
  exact target; stored only in the worker runtime.

The main preview separately requires `ONCHAIN_ADMIN_SETTLEMENT_ENABLED` and
`ONCHAIN_RESOLVER_SCHEDULE_ENABLED`, the explicit migration, correct signer
roles and a matching deployment SHA. Enabling resolution submits transactions
and spends gas. No activation or live test occurred during implementation.

`node --test ops/onchain-sepolia-resolver/worker.test.js` runs only local fixtures.

The admin panel can inspect current source evidence through the read-only
`/api/points/admin/onchain-resolution-preview` endpoint while scheduling stays
disabled. Scheduled batches persist a rotating queue cursor so markets beyond
the first 25 are eventually checked. See the [November implementation report](../../docs/onchain-sepolia-roadmap-implementation-2026-11-05.md)
for local verification and separate release requirements.

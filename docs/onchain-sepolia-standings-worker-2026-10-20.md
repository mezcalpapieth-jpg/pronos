# Dedicated Sepolia standings worker — 2026-10-20

Configured and deployed in standby on `onchain-sepolia`. Publication and scheduling are disabled. The current token and cycle are unchanged, Pointbreak and main application deployments are untouched, and no ETH was spent.

## Deployed configuration

| Setting | Value |
| --- | --- |
| Dedicated project | `pronos-onchain-sepolia-standings` |
| Project ID | `prj_8Et2ZFYdeNNdwuZ67mmT2Z7e3qEJ` |
| Deployment | `dpl_3qa2RnHBQiqnkL6gBGubyMJqmzi3` — READY |
| Worker alias | `https://pronos-onchain-sepolia-standings.vercel.app` |
| Committed worker source | `ffb2ef77e571c6e974aacb2593c33b8e55c72a4a` |
| Release mode | `standby`, no reviewed policy |
| Runtime | Node.js 22, `iad1`, Fluid Compute, 300-second limit |
| Cron definitions | Empty |
| Database | `neondb`, preview branch `br-sweet-dream-amb6hlfe` |
| Database endpoint | `ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech` |
| Database login | `sepolia_standings`, no role memberships |
| RPC | HTTPS Arbitrum Sepolia, chain `421614` |

Vercel uses the **production environment of this separate preview-worker project**. This is independent of Pronos production and the existing indexer. The project has no Git integration; deploying the main app does not update this worker. The worker code was committed locally to produce its exact-source package; this configuration step did not push the branch.

Only six environment keys were provisioned: `DATABASE_URL` and `CRON_SECRET` as sensitive values, and `ARB_RPC_URL`, `CHAIN_ID`, `PREVIEW_STANDINGS_PROJECT_ID` and `ONCHAIN_STANDINGS_ENABLED=false` as plain configuration. Database and cron secrets are fresh and specific to this worker. `STANDINGS_POLICY_HASH` is intentionally absent because there is no reviewed future policy. No signing credential is configured.

## Database boundary

The committed additive future-tournament migration was applied only to the isolated preview database. Its nine tables remain empty: cycles, locks, mints, joins, closures, standings, checkpoints, jobs and eligibility. This creates storage for future work; it does not create a tournament plan or change active Points cycle 5.

The restricted login is non-superuser, cannot create databases/roles or persistent schema objects, has no inherited roles, and is limited to six connections, a 25-second statement timeout and a 3-second lock timeout. Grants follow [`schema.sql`](../ops/onchain-sepolia-standings/schema.sql). It can append standings, maintain fenced jobs/leases and delete disposable capture checkpoints. It cannot change Points balances/trades, cycles, closures or eligibility decisions, delete published standings, or read user wallet fields and signed transaction bytes. PostgreSQL's existing public temporary-table privileges were not changed.

## Verification

- Fourteen local worker, packaging and PostgreSQL scheduler tests passed without skips.
- Locked dependency installation and the standalone worker build passed; Vercel reported READY.
- The remote digests of all 243 uploaded source files matched the prepared package, including the embedded SHA, standby mode and empty cron configuration.
- Eight live HTTP checks passed. Missing/incorrect bearer credentials return 401, POST returns 405, and authorized GET returns `{"status":"disabled"}` even with query overrides. Source/policy paths are not publicly served.
- Actual login with the restricted database password succeeded. All effective write privileges matched the four allowed tables; ten private-field/unauthorized-write checks returned permission denied. All nine future tables remained empty after the live checks.
- The main preview still reports chain `421614`, symbol `MXNP`, and disabled late joining/future-season presentation. Main production/preview deployment IDs, main-app/indexer environments and Pointbreak refs matched the initial baseline.
- Token supply and reserve/operations/gas balances and nonces matched the baseline. No signing, transaction or ETH expenditure occurred.

Full evidence: [verification JSON](./onchain-sepolia-standings-worker-verification-2026-10-20.json). The disabled endpoint does not exercise live scoring or publication; those are covered locally and await a separately authorized future-season rehearsal.

## Activation and recovery

Keep this release in standby. A future activation requires an actual reviewed funded plan, complete canonical registry/context, a reviewed policy/hash and current indexer coverage. Prepare a new committed-source package with `--policy` and `--reviewed-policy-hash`; the existing standby package cannot be activated by changing its flag alone. Authorize the application's future-season flags and worker activation together with the rehearsal scope. No monetary reward/payment authorization is implied.

Follow the [existing activation runbook](./onchain-sepolia-rewards-and-automatic-standings-2026-10-19.md) for leases, checkpoints, confirmation depth and publication review. Active releases must be deployed to this dedicated project, never the main app or existing indexer. After activation, monitor job status/lease/next-run time and immutable publication timestamps, policy hash and source SHA. To stop future publication, set the dedicated flag false and deploy a standby package with no crons. Preserve published and frozen results.

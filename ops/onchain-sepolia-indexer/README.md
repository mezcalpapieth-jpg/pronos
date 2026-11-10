# Arbitrum Sepolia preview indexer

Vercel Cron calls production deployments only. This separate project exists
solely to index the `onchain-sepolia` preview database every minute; it is not
the Pronos production application. No app domains or existing schedules change.

The worker imports the same protocol event reader as `/api/indexer`, bypasses
all Points/generator/resolver multiplex code, and has no signing credentials.
It validates the dedicated project ID, actual RPC chain ID, exact testnet
factories and isolated database endpoint/role before writes. Query parameters
cannot override its scan range or enable unrelated jobs.

Provision the `sepolia_indexer` login role on the isolated Neon branch, then
apply `schema.sql` as the existing schema owner after the protocol schema has
created `protocol_resolution_objections`. The role can read, insert
and update only protocol/indexer tables; it cannot alter schema, delete rows or
access Points user/balance/trade tables. Do not grant it Neon administrative
membership. Configure only these project environment variables:

- `DATABASE_URL` — isolated preview URL using `sepolia_indexer`.
- `CRON_SECRET` — a new dedicated secret, unrelated to the main app's secrets.
- `PREVIEW_INDEXER_PROJECT_ID` — the dedicated scheduler project ID.
- `CHAIN_ID=421614`, `PROTOCOL_CHAIN_ID=421614`.
- `ARB_RPC_URL` — Arbitrum Sepolia RPC.
- `FACTORY_ADDRESS=0xb6cf9f65ab82c17c8e9d58d06073ca3af3e5443d`.
- `FACTORY_V2_ADDRESS=0x33c1cdd4e22a9732ad808f2ad7efe82211b65c6a`.
- `ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS=0x69440742a168635d9fa7cc0cfb0935afffe79ad3`.
- `ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS=0xfcac9cfcf22df809ba365c85dd767c90bb260fd6`.
- `INDEXER_MAX_BATCHES=2` — at most 4,000 blocks per factory each minute.

Use sensitive variables for the database URL and cron secret. They never belong
in source files, command arguments or verification artifacts.

After committing and pushing on `onchain-sepolia`, deploy with the installed
Vercel CLI and existing account connection:

```sh
VERCEL_CLI_PATH=/absolute/path/to/vercel/dist/vc.js node ops/onchain-sepolia-indexer/deploy.mjs DEDICATED_PROJECT_ID team_Ru2mJw1I6wlB1oAnSb5re7J0
```

The helper validates branch/project identity, stages only committed worker and
shared-reader files in a temporary directory and embeds the source SHA. It
never copies `.env` files or changes the app's Vercel link. Redeploy this worker
when the shared reader changes; app previews and this scheduler have separate
deployments. Stopping/deleting an app preview does not stop this worker; remove
the dedicated cron or pause its project explicitly when retiring the preview.

Successful scheduled invocations persist their source SHA, block ranges,
event counts and duration in `preview_indexer_runs`. A 330-second database
lease exceeds the 300-second function timeout and prevents concurrent runs;
an interrupted run retries from committed factory checkpoints after its lease
expires. Check for stale starts or errors in this table; this is not a paging
integration. Keep run history bounded during longer test campaigns.

Verification must observe real cron rows and new chain events being ingested
without manually calling `/api/indexer` or `/api/tick`. In particular, resolve
and index a market before redeeming so the later scheduled scan proves that
closed pools remain watched. Compare receipts, run ranges, immutable event
counts and adapter reads, then observe another idle pass for duplicates.

## Reviewed markets

Once the reviewed factories are deployed, add
`SEPOLIA_REVIEW_FACTORY_V1_ADDRESS`, `SEPOLIA_REVIEW_FACTORY_V2_ADDRESS` and
`SEPOLIA_REVIEW_INDEXER_START_BLOCK` (the earlier of their deployment blocks)
to the worker. Keep the existing factory variables and their checkpoints. The
worker verifies the new factories enforce review and reads their events only
through the finalized head. Apply the protocol schema and worker grants
before starting that backfill.

On the isolated app preview, configure the same reviewed factory addresses and
start block, point `ONCHAIN_MARKET_FACTORY_ADDRESS` and
`ONCHAIN_MARKET_FACTORY_V2_ADDRESS` to the reviewed factories, and retain the
existing MXNP collateral address. Keep the legacy addresses configured for
existing markets. Pin a trading router bound to both reviewed factories and
their share tokens before enabling broadcast. Enable `ONCHAIN_SEPOLIA_REVIEW_ENABLED` and
`ONCHAIN_REVIEWED_CREATION_ENABLED` to use reviewed creation from **Por aprobar**.
Set `ONCHAIN_REVIEWED_CREATOR_ADDRESS`, `ONCHAIN_REVIEWED_CREATOR_SUBORG_ID`,
`ONCHAIN_REVIEWED_CREATION_MAX_SEED_MXNP`, and
`ONCHAIN_REVIEWED_CREATION_MAX_GAS_ETH`. The dedicated creator needs gas,
existing MXNP and an allowance on each reviewed factory before enabling
`ONCHAIN_REVIEWED_CREATION_BROADCAST_ENABLED`.

The form commits the exact written or generated criteria in `createReviewedMarket`
for a single pool of two to eight outcomes. Proposals appear in **Publicando**
until the finalized receipt matches the indexed pool and rules hash. Use
**Continuar publicación** to check progress or retry the same signed transaction.

In **Por resolver**, the resolver proposes the outcome and commits the evidence.
In **Revisión de liquidaciones**, the reviewer can approve or open a dispute.
Lifting a dispute restarts the 24-hour window and requires fresh approval.
After the window ends, the owner can finalize and then recover excess
collateral to treasury. Admin prepares these transactions for the respective
wallets. The finalized event enables indexed claims, and recovery preserves
the collateral owed to winning holders.

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
apply `schema.sql` there as the existing schema owner. The role can read, insert
and update only protocol/indexer tables; it cannot alter schema, delete rows or
access Points user/balance/trade tables. Do not grant it Neon administrative
membership. Configure only these project environment variables:

- `DATABASE_URL` — isolated preview URL using `sepolia_indexer`.
- `CRON_SECRET` — a new dedicated secret, unrelated to the main app's secrets.
- `PREVIEW_INDEXER_PROJECT_ID` — the dedicated scheduler project ID.
- `CHAIN_ID=421614`, `PROTOCOL_CHAIN_ID=421614`.
- `ARB_RPC_URL` — Arbitrum Sepolia RPC.
- `FACTORY_ADDRESS=0x69440742a168635d9fa7cc0cfb0935afffe79ad3`.
- `FACTORY_V2_ADDRESS=0xfcac9cfcf22df809ba365c85dd767c90bb260fd6`.
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

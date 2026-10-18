# Optional second on-chain Points cycle

Implemented locally on `onchain-sepolia`. **Preparation only: no new token is deployed, no MXNP is minted, no ETH is spent, no migration is applied and no preview configuration is switched by this change.** The current tournament continues with its current token. Pointbreak is untouched.

## What resets

Each future tournament gets a new deployment of the existing `TournamentMXNP` ERC20, both existing factories/share tokens and the existing immutable trading router. Contracts under `contracts/src/` are unchanged. Prices, fees, buy/sell/redeem, market resolution and collateral backing behave as before.

Opening funds use the new token address. A user receives the same allocation regardless of their old token balance or Points ledger balance. Old tokens are not deleted. Old market collateral, positions, grants and redemption rights are preserved. The registry stores the previous deployment alongside the new one; later cycles cannot reuse the same recorded token/factories/router.

One **new owner authorization per user per tournament router** is required. Within that tournament it covers future pools as before. The funding job does not copy grants, authorize users or sign as them. Native ETH continues through the existing automatic, on-demand gas service, with no blanket ETH distribution.

## Budgets and boundaries

The reviewed snapshot includes all `points_users` rows, without a query limit. Unique wallet + Turnkey-suborg mappings are eligible; users without one are listed as skipped. Invalid addresses, duplicate usernames/wallets/suborgs and system-address recipients block planning. The file contains private account mappings: keep it outside Git with restrictive permissions.

- Default opening grant: **500 MXNP per eligible wallet**, configurable before preparing the snapshot.
- Separate, explicit **market seed liquidity budget**, minted to the operations wallet.
- Separate, explicit maximum total issuance. User grants plus seed liquidity must fit that cap.
- Example only: 600 users × 500 = 300,000 MXNP, **plus the reviewed market seed budget**. Previous-cycle treasury balances do not fund a new token.

This is an application-enforced issuance cap. The unchanged ERC20 owner retains its existing mint authority. The job checks total supply against confirmed ledger issuance before each new batch; unexpected outside minting stops the job. Funding is deliberately completed before creating any new-cycle markets. The token starts with zero supply and the factories must have zero markets.

No Points balances, cycle snapshots, trading records, old token balances or old pools are changed. Late signups, rewards, leaderboard scoring and supplemental issuance are separate roadmap work; the opening snapshot is immutable. Skipped/late users are not silently added on resume. Cycle dates identify the funding window; they do not change the trading contracts' individual market deadlines.

## Operator workflow when a second cycle is actually approved

These are future operational steps, **not commands executed for this implementation**. The CLI loads no `.env` automatically. Supply the isolated preview environment through the existing secure environment workflow; do not print credentials.

Required destination guard for every DB operation: current Git branch `onchain-sepolia`, `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=onchain-sepolia`, `ONCHAIN_PREVIEW_APPROVALS_ENABLED=true`, `ONCHAIN_CHAIN_ID=421614`, explicit `ONCHAIN_RPC_URL`, and the pinned preview **direct** `DATABASE_URL`. Pass:

```sh
--expected-host=ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech
```

1. Archive the current deployed configuration, immutable preview URL, signer-policy targets, indexer configuration and outstanding claims. Save its public deployment JSON with `chainId`, `token`, `factoryV1`, `factoryV2`, `shareV1`, `shareV2`, `router`, `routerCodeHash`, `owner`, `operations`. Obtain addresses/hash from verified contracts, not a user's input. Preserve existing historical/legacy deployment records too.
2. Simulate `contracts/script/DeployTournamentCycle.s.sol` on Arbitrum Sepolia. It uses explicit `CYCLE_OWNER_ADDRESS`, `CYCLE_OPERATIONS_ADDRESS`, `CYCLE_RESOLVER_ADDRESS`, `TREASURY_ADDRESS`, `LIQUIDITY_RESERVE`, `EMERGENCY_RESERVE`, and `DEPLOYER_PRIVATE_KEY`. It deploys and configures the unchanged stack, transfers roles, prints deployment JSON and **does not mint**. Broadcasting is a later explicitly authorized step. After any interrupted broadcast, inspect Foundry's journal and use its resume procedure; do not start a second deployment from scratch. Verify receipts/code and retain the final manifest.
3. Print and review the new schema, then explicitly install it only in the isolated preview DB. No application cold start creates these tables.

```sh
node frontend/api/scripts/onchain-sepolia-tournament.mjs schema
# Only during the approved future rollout:
node frontend/api/scripts/onchain-sepolia-tournament.mjs schema --apply \
  --expected-host=ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech
```

4. Build the private funding plan. Choose dates, actual seed budget and total cap; the following 50,000/350,000 values are illustrative, not a recommended market capacity.

```sh
node frontend/api/scripts/onchain-sepolia-tournament.mjs plan \
  --expected-host=ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech \
  --deployment=/private/tmp/next-cycle-deployment.json \
  --previous-deployment=/private/tmp/current-cycle-deployment.json \
  --cycle-id=sepolia-cycle-two --label='Second Sepolia cycle' \
  --starts-at=2026-11-01T00:00:00Z --ends-at=2026-12-01T00:00:00Z \
  --allocation=500 --liquidity-mxnp=50000 --max-total-mxnp=350000 \
  --batch-size=50 --out=/private/tmp/sepolia-cycle-two.json
```

Planning verifies the actual RPC chain, zero token supply, owner/decimals, deployed code, router runtime hash, all immutable bindings, both factory owners/creators, zero market counts and share-token ownership. The previous manifest must match the current preview. The plan output reports its SHA-256 hash, counts, budget and skipped count without dumping recipient mappings.

5. Review the complete private snapshot, including skipped users. Run `prepare --plan=... --plan-hash=...` first without `--apply`; add `--apply` to record it. Include the same `--expected-host` for this and subsequent commands. Preparation writes the registry only. Repeating the same prepare is safe; changing a prepared plan fails.
6. Configure the **new token owner's** signer explicitly: either `TOURNAMENT_MINTER_PRIVATE_KEY`, or `TOURNAMENT_MINTER_SUBORG_ID` plus the existing Turnkey backend credentials with actual owner signing permission. Neither the user's delegation nor the gas-funder wallet is a minting identity. Turnkey uses the checksummed owner address. No policy is broadened by the CLI.
7. Run `fund --cycle-id=sepolia-cycle-two --plan-hash=...` without `--apply` to view status. When approved, add `--apply`. Each invocation sends or reconciles **one batch**; rerun until the status is `funded`. With 600 eligible users and a batch size of 50 there are 13 batches, including the separate liquidity recipient. Reconciliation waits for two confirmations across invocations; it does not run a background service. Use `status --cycle-id=...` for public receipt hashes and progress.

The job locks the mint owner across cycles, fences expired workers, rechecks each batch's account mappings, checks issuance and native-gas balances, simulates the mint through gas estimation, bounds fee ceilings at 0.02 ETH per batch, verifies the signed payload and saves it **before** broadcasting. Changed or newly ambiguous wallet mappings stop new funding without rewriting the snapshot. That ceiling is a refusal threshold, not expected gas usage. A unique batch ledger prevents a second confirmed allocation; the DB also validates the batch budget. Status output excludes signed transaction bytes.

An RPC timeout or dropped transaction resumes with the **same saved bytes/hash**. Never delete a pending row or manually repeat a mint. A consumed nonce with no receipt, payload mismatch, supply mismatch or reorg inconsistency requires investigation. A confirmed revert records zero allocation and requires explicit `--retry-reverted` after reviewing the cause; the failed attempt remains in the audit history. Do not use the mint owner's nonce concurrently elsewhere. Pending transactions can still be reconciled after cycle end; new mint batches cannot start then. Protect and back up this ledger: restoring an outdated copy can invalidate the duplicate-funding guarantee.

## Runtime activation stays a separate release

`runtime --cycle-id=...` prints the new public environment values only after all funding batches have confirmed. It **does not** edit Vercel, indexer settings, Turnkey policies, frontend state or a live cycle. It includes the current factory aliases used by the indexer, client collateral address, router hash and the old deployment archive. Retain the complete current runtime configuration separately; this handoff is a diff, not a replacement `.env`.

Before a future switch, verify new operations/resolver signer targets and permissions, preview/worker factory settings and start blocks, readiness checks, one normal owner authorization and a real buy/sell/redeem rehearsal. Resolve all old markets or maintain an explicitly tested historical settlement deployment/indexer and owner authorization path for outstanding claims. **The current single-router application does not automatically route arbitrary past tournament routers or aggregate their balances.** Old on-chain claims remain valid; automatic historical-cycle UI/routing is not introduced here. Do not overwrite existing legacy factory settings or assume a new router can redeem an old router's pools.

The current preview can remain on its existing token indefinitely. Only an explicitly approved future deployment and runtime release makes this second-cycle flow active.

## Local verification

- Full existing Solidity suite plus the new cycle deployment test passed offline. The new test uses the real unchanged contracts, deploys two independent stacks, funds the second and redeems an old winning position while verifying both token balances remain isolated.
- Unit checks cover deterministic snapshots/hashes, caps, wallet uniqueness, preview destination guards, deployment bindings and exact mint receipts.
- PostgreSQL integration checks run in local PGlite, with no preview/production DB: immutable snapshots, token uniqueness, lease fencing, persist-before-send, timeout/drop recovery, confirmation threshold, duplicate/cap constraints, reverted retry, nonce ambiguity and refusal of wrong-chain/expired/over-budget/wrong-signer requests.

```sh
SEPOLIA_GAS_TEST_PGLITE=/private/tmp/pronos-sepolia-gas-test/node_modules/@electric-sql/pglite/dist/index.js \
  node --test frontend/api/_lib/sepolia-tournament.test.js frontend/api/_lib/onchain-reset-plan.test.js
cd contracts
forge test --offline
```

The PGlite module is an optional local test dependency outside the application. CI should provision it and set the test variable; absent that variable, its integration test is explicitly skipped. No new production dependency is introduced.

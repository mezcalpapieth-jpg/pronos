# Automatic user gas on Arbitrum Sepolia

Branch: `onchain-sepolia`. Automatic funding remains disabled pending the incoming ETH reserve. Pointbreak is unchanged.

## Release configuration, 2026-10-17

The dedicated Turnkey gas wallet is **`0x252a1cfa015612EFB8C7c2f1643A9F541b866990`**, wallet ID `06f12b74-51c4-5472-b011-fbf15f404628`, in organization `34e1b782-dc66-4b66-9ac7-477b743718f5`. The existing server credential signed a native Arbitrum Sepolia transfer from it and the recovered signer matched. The probe was not broadcast. No user delegation changed.

The exported migration was applied transactionally through the Neon connector to `onchain-sepolia-preview` (`br-sweet-dream-amb6hlfe`), after verifying its direct compute `ep-delicate-glitter-amp7yrkv`. Both tables and all five indexes exist. The migration owner and existing `pronos_writer` application role have SELECT/INSERT/UPDATE; the restricted indexer has no table access. The ledger contains zero transfers.

Only this branch's Preview configuration has the new funder address, funder organization and `ONCHAIN_AUTO_GAS_FUNDING_ENABLED=false`. All 100 environment records outside this branch remain unchanged. At 17:53 UTC the incoming reserve still held **0.002244109750225488 ETH**, and the new wallet held zero. The proposed 0.1-ETH float cannot be transferred yet. Funding, activation, authenticated readiness and the real zero-ETH buy/sell/resolve/redeem rehearsal remain outstanding; local tests and the signing probe do not establish those outcomes.

## Behavior

The existing authenticated buy, sell and redeem endpoints prepare the user's native ETH balance before signing an approval or trade. Quotes and administrator transactions cannot trigger user funding. The user still presses Comprar, Vender or Cobrar and sees the normal result; no ETH instructions, gas controls or additional wallet confirmation are added.

Funding requires all four gates: `ONCHAIN_AUTO_GAS_FUNDING_ENABLED=true`, the existing preview approvals flag, Vercel Preview on branch `onchain-sepolia`, and chain `421614`. The database endpoint is pinned to the same isolated preview branch as the existing indexer (`ep-delicate-glitter-amp7yrkv`, direct or pooled); another database fails configuration. The RPC network is checked independently before any transfer. Other branches, production, Arbitrum One and Base cannot activate this path.

| Limit | ETH |
| --- | ---: |
| Low balance threshold | 0.0002, or 125% of the full approval/trade gas allowance if higher |
| Balance after top-up | 0.0005 |
| Wallet or Turnkey account, rolling 24 hours | 0.002 |
| All funding, rolling 24 hours, including maximum transfer fees | 0.1 |
| Minimum retained gas-wallet reserve | 0.01 |
| Minimum time between top-ups for an account/wallet | 5 minutes |

The limits are fixed in reviewed code. Fees above the existing user delegation's 0.2-gwei ceiling stop preparation. Buys budget 700,000 gas including a possible collateral approval; sells budget 720,000 including a possible share approval; redemption budgets 600,000. Transfer gas is estimated on Arbitrum, buffered 30%, and capped at 200,000. These allowances are upper bounds, not transaction cost predictions. A user with enough ETH does not need a funding ledger write or a funding signature.

Before receiving ETH the user must have a unique database wallet/account mapping and a live, verified owner-approved trading policy covering this pool. Buy/sell checks reject inactive pools, invalid amounts, stale minimum output and insufficient collateral/shares. Redemption simulates the exact owner call and rejects unavailable winnings or disputed/canceled markets. The API cannot choose another recipient. Funding does not grant trading permission, alter the human root quorum, mint MXNP, reset a tournament or change scoring.

The wallet owner can move the received test ETH. These are bounded native transfers, not a paymaster or a claim that users are unable to withdraw test gas. Wallet/account caps, cooldown, finite gas-wallet balance and the global cap limit that exposure; no lifetime/Sybil-proof guarantee is claimed.

## Funding source and activation

The incoming reserve address is **`0x0Caa37c077924038e14e9D8dE46B5208788e52CF` on Arbitrum Sepolia**. The latest checked balance is recorded above. That local deployer key must stay outside hosted runtime configuration.

Use a **dedicated Turnkey EVM gas wallet** separate from the local deployer, contract owner, market creator and resolver. A separate wallet prevents funding requests and market operations competing for the same nonce. The implementation rejects those operational addresses as funders. It never imports `DEPLOYER_PRIVATE_KEY`.

Activation order:

1. Commit/push the reviewed `onchain-sepolia` changes and deploy only its Preview.
2. Create the dedicated Turnkey gas wallet and verify the existing server signing credential can sign native Arbitrum Sepolia transfers from it. Configure server-only `ONCHAIN_GAS_FUNDER_ADDRESS` and `ONCHAIN_GAS_FUNDER_SUBORG_ID`. Keep user trading policies at zero native value. No new user authorization is needed for incoming ETH.
3. Install the exported schema in the **existing isolated preview database**, using its direct connection. Never run this against the Points production database or with the dedicated indexer's restricted login. The script defaults to printing SQL and requires explicit apply, matching destination hostname and preview metadata:

   ```sh
   node frontend/api/scripts/onchain-sepolia-gas-schema.mjs
   # With the isolated preview's DATABASE_URL and server metadata supplied securely:
   node frontend/api/scripts/onchain-sepolia-gas-schema.mjs --apply --expected-host=ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech
   ```

   The schema must be installed by a migration role. Grant the preview application role SELECT/INSERT/UPDATE on both `sepolia_gas_lock` and `sepolia_gas_transfers` if it is a different role. The indexer needs no access or redeployment.

4. After the reserve arrives, transfer an initial **0.1 ETH** from that reserve to the dedicated gas wallet. This amount leaves most of the proposed reserve separate. It is a suggested initial float, not a transfer performed by this implementation. No MXNP mint is involved.
5. Set `ONCHAIN_AUTO_GAS_FUNDING_ENABLED=true` only for Preview / `onchain-sepolia`, then deploy that branch's Preview. Leave `GAS_SPONSORSHIP_ENABLED=false`; the status exposes native prefunding separately.
6. Rehearse with an owner-authorized normal account holding MXNP and **zero native ETH**: buy with its initial approval, sell, resolve and redeem. Verify exactly one successful `sepolia_gas_transfers` entry, the native transfer receipt, successful trade receipts and normal automatic indexing. Retry the same account on a later pool and confirm it reuses both ETH and the router grant. A depleted balance should top up again only within the cooldown and rolling limits.
7. Check authenticated `/api/points/admin/onchain-status`, especially `gas.autoFunding`. Configuration alone never reports ready: the live probe requires the actual chain, a dedicated EOA, table/write access, matching funder, reserve, remaining global budget, no unresolved payment, and a confirmed ledger transfer signed with the current public-key fingerprint. A prior transfer is historical permission evidence; it cannot guarantee that permissions have not subsequently been revoked. The real funded trade rehearsal remains required.

## Recovery and accounting

The database holds a chain-wide 60-second funding lease. Fencing prevents an expired worker persisting a new transfer or releasing its successor's lease. A signed transaction and hash are committed with the budget decision **before** broadcast. The database permits only one unresolved payment. Retries reconcile or rebroadcast that same signed payload; RPC errors and timeouts never allocate another nonce. A receipt must confirm success before the user transaction starts. Prepared transfers retain budget even beyond 24 hours; reverted transfers count conservatively for the rolling day.

The gas wallet must be exclusive to this service. An unexplained pending nonce, another configured funder, unknown signing result, schema failure, depleted reserve or exhausted limit stops funding. Already sufficiently funded users can continue without a funding write/signature. The feature flag is the operational kill switch for new transfers; switching it off does not top up unfunded accounts or cancel transactions already submitted.

For a stuck prepared payment, inspect its recorded hash and receipt on Arbitrum Sepolia and let a subsequent low-balance trade retry reconciliation. **Do not delete the pending row, reset the nonce, rotate the funder or manually send a second payment while that signature could still mine.** The implementation has no automatic fee replacement or funder rotation. Operator recovery must reconcile the outstanding nonce/payment first. Signed transaction payloads remain server/database-only and are never included in public API errors.

## Verification

The focused tests cover funding before approvals, zero/partial/already-funded balances, signature checks, ambiguous broadcast recovery, overlapping requests, failed persistence, unknown pending nonces, reserve/fee/network/recipient guards, live delegation coverage, balances and simulated redemption, plus admin readiness. User errors have Spanish and English copy without wallet addresses or gas instructions. The PostgreSQL ledger integration test uses a temporary local PGlite engine, with no preview or production data:

```sh
npm install --prefix /private/tmp/pronos-sepolia-gas-test --ignore-scripts --no-audit --no-fund @electric-sql/pglite
cd frontend
SEPOLIA_GAS_TEST_PGLITE=/private/tmp/pronos-sepolia-gas-test/node_modules/@electric-sql/pglite/dist/index.js \
  node --test api/_lib/sepolia-gas-*.test.js api/_lib/sepolia-user-gas.test.js
```

The PostgreSQL tests exercise real constraints, lease claims/fencing, durable pending payments, cooldown, rolling wallet/account caps and fee-inclusive global limits. PGlite serializes its local connection; this is not a multi-connection production load test. The test engine is installed outside the application and adds no runtime dependency. A live zero-ETH wallet rehearsal remains part of activation.

Read-only Arbitrum Sepolia RPC checks also exercised the deployed router/pool: a zero-ETH address with no shares was rejected, while the zero-ETH pool address holding winning tokens successfully simulated a one-unit redemption. That contract holder is a positive simulation control, not an eligible normal-user account. The check exposed ethers v5 `provider.call` normalizing an empty revert into `0x`; the redemption preflight therefore uses raw `eth_call` through `provider.send`, which preserves RPC errors. No transaction was signed or sent by these probes.

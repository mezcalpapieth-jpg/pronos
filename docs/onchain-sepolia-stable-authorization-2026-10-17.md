# Stable trading authorization — Arbitrum Sepolia

Implemented locally on `onchain-sepolia`, October 17, 2026. **Not committed, pushed, deployed or activated.** No live Turnkey policies, funds, database records, contracts or environment variables changed in this implementation. Pointbreak is outside this release.

## Result

An owner can approve one persistent trading grant before the first market exists. The grant targets a fixed, non-upgradeable `PronosTradingRouter`, which validates every pool against its two immutable factory registries. Adding a binary or multi-outcome pool from those factories changes neither the policy nor its scope hash. The first applicable trade sets the router's ERC20 allowance or ERC1155 operator approval; later pools reuse those approvals without an owner prompt.

The router accepts only guarded buy, guarded sell and redeem. Its calls always act for `msg.sender`, pay that wallet directly and preserve the pool's original user events and cost basis. It has no generic call, arbitrary recipient, withdrawal, administration or upgrade entry point. Transfers go directly between the wallet and pool. Buys and sells require positive minimum output; paused, expired or settled pools cannot trade. Redemption retains resolution/dispute/cancellation checks.

The Turnkey grant still binds the wallet, chain `421614`, zero native value, gas at most 600,000 and max fee at most 0.2 gwei. It has no time expression or daily spending cap. The browser's owner credential remains necessary to install, replace or revoke a grant. The backend signer remains non-root. Login session expiry is separate from trading authorization expiry.

The backend verifies the deployed runtime's pinned keccak256 hash, chain, router version, collateral, share tokens, both factories and their one-time router bindings before preparing/verifying grants or dispatching trades. Invalid or partial router configuration fails closed. Frontend coverage requires the verified installed policy and a fresh server mapping to one of those factories; `active` alone cannot bypass consent. Readiness reports configured routers that fail verification as blockers.

## Compatibility and migration

The existing deployed factories store immutable pool creation code. They cannot acquire the new routed entry points through a frontend release. Activation requires **new V1/V2 share tokens, compatible V1/V2 factories and the router**, using the **existing MXNP collateral**. No mint or token-supply increase is required.

Historical pools stay direct targets with exact pool permissions and their original share tokens. Explicit legacy configuration keeps their catalog mappings, delegation verification and indexing available, including after resolution. Old installed policies remain valid for their original pools; no policy is expanded silently. Users approve the router scope once through the normal owner flow when they need a new routed market. Replacing the router or its factory pair requires new consent.

Do not keep creating markets on the legacy factories after cutover: additional legacy pools still require explicit exact-pool scope extensions. Do not remove historical configuration until all affected positions, refunds and redemptions are retired. The existing protocol schema already keys markets/checkpoints by chain and factory; this change needs no new schema migration.

## Activation sequence for the next release

1. Review and commit the implementation, run the local checks, and push only `onchain-sepolia`.
2. Record the current factory/share-token addresses and each factory's deployment block. Retain them in the legacy settings below. Preserve existing Points/protocol IDs and rows.
3. Simulate the existing `DeployProtocol.s.sol` and `DeployProtocolV2.s.sol` scripts on Arbitrum Sepolia with the existing MXNP collateral and correct treasury, fee, market-creator and resolver roles. Deploy new tokens/factories from this source. Keep factory ownership with the deployer until the next step; verify the existing operations credential can create/resolve on the new factory targets before allowing approvals. Update only the preview's operations policy through its authorized owner flow if required.
4. Set the two **new** factory addresses in the deployment shell and simulate `DeployTradingRouter.s.sol`. It requires chain 421614, deployer ownership of both factories and unbound routers. After review, broadcast the router deployment and the two one-time bindings. Transfer factory ownership to the intended admin after binding. Verify source and runtime bytecode, then independently compute the deployed runtime keccak256 hash. The router script prints its address/hash; it never mints collateral or creates markets.
5. Configure only the `onchain-sepolia` preview with the new current factories/share tokens and `ONCHAIN_TRADING_ROUTER_ADDRESS` / `ONCHAIN_TRADING_ROUTER_CODE_HASH`. Keep all existing branch, chain and preview gates. Update current factory/token aliases consistently, including `FACTORY_ADDRESS`, `FACTORY_V2_ADDRESS`, `PRONOS_FACTORY_ADDRESS`, `PRONOS_FACTORY_V2_ADDRESS` and the Arbitrum Sepolia client aliases. Keep the collateral and MXNP supply unchanged.
6. In the **dedicated Sepolia indexer project**, update the current hard-coded `factories` pins in `ops/onchain-sepolia-indexer/worker.js` to the two reviewed deployment addresses. Keep `legacyFactories` pinned to the old addresses. Update the worker's current factory aliases, add the two legacy factory settings, and redeploy the worker from the reviewed branch SHA. Keep its isolated DB role/endpoint, project ID, actual RPC chain validation, signing-key prohibition, lease and cron protections. Never replace the pins with arbitrary environment-supplied addresses. Ensure the start block includes new factory creation; historical factories resume their existing checkpoints.
7. Deploy the exact-SHA application preview. Verify readiness shows `tradingAuthorization.scope = router` and `verified = true`, with no router blocker. Check all four factory checkpoints, current and historical catalog mappings, and legacy resolved holdings.
8. Through a real owner's normal login/consent flow, authorize once **before creating another market**. Record the Turnkey policy ID and scope hash, create fresh V1 and V2 pools, and prove they are unchanged. Run guarded buy/sell, resolve, index, redeem and index again. Check real owner addresses in receipts/events and compare the final wallet, protocol ledger and frontend positions. Confirm automatic cron handles new and historical pools without a manual indexing trigger.
9. Test revocation against actual Turnkey signing, returning login with an unchanged persistent grant, unauthorized pool/recipient/chain rejection and canceled consent. These live checks remain outstanding; local tests do not establish deployed behavior.

Preview legacy settings:

```text
ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS=<original V1 factory>
ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS=<original V2 factory>
ONCHAIN_LEGACY_SHARE_TOKEN_ADDRESS=<original V1 share token>
ONCHAIN_LEGACY_SHARE_TOKEN_V2_ADDRESS=<original V2 share token>
```

Only the two legacy factory settings are needed by the indexer; it must continue to have no signing credentials. The application also needs both legacy share-token settings to reconstruct exact historical policies.

## Local validation

**135 contract tests and 110 focused JavaScript tests passed**, as did both frontend builds, the dedicated indexer bundle build and `git diff --check`.

Contract tests cover approvals before pool creation, multiple future V1/V2 pools, real-user events/payouts, no router custody, price-guard rollback, spoof/unknown-pool rejection, owner isolation, one-time binding, token-approval revocation, non-Sepolia rejection and proportional cost-basis fuzzing. Eight-outcome buy/sell tests include cold account/storage access and stay below 570,000 execution gas, leaving room within the existing 600,000 transaction limit. Real Arbitrum transaction gas/fees still require the live rehearsal.

JavaScript tests cover unchanged future-market scope hashes, exact legacy token permissions, pinned-code/binding rejection, owner migration/completion/revocation, actual dispatcher approval reuse and ABI encoding, server-mapped frontend coverage, readiness blockers and four-factory indexing configuration. Both frontend builds target temporary directories so generated served assets are not modified.

Activation and the remaining roadmap work—normal-user gas support, tournament reset/funding limits, registration/scoring/rewards and lifecycle rehearsals—remain separate from this local implementation. This is not an independent contract audit.

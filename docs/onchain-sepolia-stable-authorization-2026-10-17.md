# Stable trading authorization — Arbitrum Sepolia

Deployed and verified on `onchain-sepolia`, October 17, 2026. Implementation commit `1fe6cb1` and deployment configuration commit `0c9e272` are pushed. The compatible share tokens, factories and immutable router use existing MXNP on Arbitrum Sepolia. A real owner approved once while both new factories were empty; subsequent binary and three-outcome markets both completed buy, sell, resolution and redemption without another grant. Pointbreak and Pronos production remain unchanged. Receipts and bytecode checks are in [the deployment manifest](./onchain-sepolia-router-deployment-2026-10-17.json); live policy, transaction, indexing and reconciliation evidence is in [the verification record](./onchain-sepolia-stable-authorization-verification-2026-10-17.json).

## Result

An owner can approve one persistent trading grant before the first market exists. The grant targets a fixed, non-upgradeable `PronosTradingRouter`, which validates every pool against its two immutable factory registries. Adding a binary or multi-outcome pool from those factories changes neither the policy nor its scope hash. The first applicable trade sets the router's ERC20 allowance or ERC1155 operator approval; later pools reuse those approvals without an owner prompt.

The router accepts only guarded buy, guarded sell and redeem. Its calls always act for `msg.sender`, pay that wallet directly and preserve the pool's original user events and cost basis. It has no generic call, arbitrary recipient, withdrawal, administration or upgrade entry point. Transfers go directly between the wallet and pool. Buys and sells require positive minimum output; paused, expired or settled pools cannot trade. Redemption retains resolution/dispute/cancellation checks.

The Turnkey grant still binds the wallet, chain `421614`, zero native value, gas at most 600,000 and max fee at most 0.2 gwei. It has no time expression or daily spending cap. The browser's owner credential remains necessary to install, replace or revoke a grant. The backend signer remains non-root. Login session expiry is separate from trading authorization expiry.

The backend verifies the deployed runtime's pinned keccak256 hash, chain, router version, collateral, share tokens, both factories and their one-time router bindings before preparing/verifying grants or dispatching trades. Invalid or partial router configuration fails closed. Frontend coverage requires the verified installed policy and a fresh server mapping to one of those factories; `active` alone cannot bypass consent. Readiness reports configured routers that fail verification as blockers.

## Compatibility and migration

The existing deployed factories store immutable pool creation code. They cannot acquire the new routed entry points through a frontend release. Activation requires **new V1/V2 share tokens, compatible V1/V2 factories and the router**, using the **existing MXNP collateral**. No mint or token-supply increase is required.

Historical pools stay direct targets with exact pool permissions and their original share tokens. Explicit legacy configuration keeps their catalog mappings, delegation verification and indexing available, including after resolution. Old installed policies remain valid for their original pools; no policy is expanded silently. Users approve the router scope once through the normal owner flow when they need a new routed market. Replacing the router or its factory pair requires new consent.

Do not keep creating markets on the legacy factories after cutover: additional legacy pools still require explicit exact-pool scope extensions. Do not remove historical configuration until all affected positions, refunds and redemptions are retired. The existing protocol schema already keys markets/checkpoints by chain and factory; this change needs no new schema migration.

## Live verification

Application preview `dpl_BKSvNUTdsCW1usv1eFR5xB492ZzT` and dedicated indexer `dpl_Gm2KenMHSnwPxMRTpHGwsJckNcG7` are READY at exact runtime source `0c9e27210b451e29b484fe795c6fc8da26e5993f`. The [verified preview](https://pronos-fto0ou4gd-mezcalpapieth-jpgs-projects.vercel.app/points) and branch alias serve the same Points entry, authorization copy and guarded lazy buy module. The dedicated worker retains its original restricted database role and has no signing credentials. Its new and legacy factory pins cover four factories.

At **17:01:46 UTC**, `pronos` used its real OTP-bound owner session and the actual frontend delegation client to approve policy `307adccf-2e00-449e-9ec7-4c6cc7fb5437`. Both new factories had market count **0**. Scope hash `1179f5ea6e60274c3aacfb80a3cf0b88b7536253e8876ad7a41686e664ee6715` and policy ID remained unchanged after both future markets and all six trade actions. Final deployed status is active, persistent, `coversFutureMarkets: true`, `needsRefresh: false`, with no expiry or daily cap. The human root quorum was unchanged; the trading signer is non-root.

| Future market | Pending / Points / protocol DB IDs | Buy | Sell | Redemption |
| --- | --- | --- | --- | --- |
| V1 binary, contract ID 0 | 37697 / 360639 / 7 | 5 MXNP → 9.523390 shares | 1 share → 0.508851 MXNP; fee 0.013684 | 8.523390 MXNP |
| V2 three outcomes, contract ID 0 | 37698 / 360640 / 8 | 5 MXNP → 14.024037 shares | 1 share → 0.364737 MXNP; fee 0 | 13.024037 MXNP |

Each pool used **100 existing MXNP** as seed and was created after consent. The fixtures went pending first, were deployed with the operations helper, and were explicitly approved into the hidden test catalog through the Neon connector after protocol indexing. This fixture setup does not claim an admin UI or pending auto-deploy rehearsal. User trading used the actual Points execution adapter and deployed authenticated APIs. All six receipts come from the user's wallet to the router and used **126,180–273,571 gas**, below the 600,000 limit. One ERC20 router allowance served both pools; each share token received one operator approval. No additional owner approval was needed.

Nine scheduled cron runs from **17:01–17:09 UTC** ingested both creations, both seeds, four trades, two resolutions and two later redemptions; no manual indexing trigger was used. All four configured factory checkpoints passed the final receipt block. Final adapter history agrees with receipts and the protocol ledger; no positions or claimable shares remain.

The wallet reconciles exactly from **536.960738 to 549.381753 MXNP**: minus 10 in buys, plus 0.873588 in sales and 21.547427 in redemptions. It retains **0.000445142809610 ETH**. Operations hold **49,998,500 MXNP / 0.000666266156742 ETH**; total supply remains **50 million MXNP**. Router collateral and share balances are zero. The separate Points ledger remains **500 Points / zero trades**.

Actual Turnkey signing rejected eight no-broadcast probes: native value, wrong chain, excessive gas, excessive fee, an unapproved contract, token transfer, arbitrary approval spender and factory administration. A positive signing control passed. The router also rejected a legacy pool outside its immutable registries. All **100** environment records outside this branch remain identical. Pointbreak local, tracking and remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`; Pronos production remains READY `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` at that SHA.

These checks use real credentials, signatures, deployed APIs and chain receipts with SDK server transport; no browser click-through is claimed. The current admin readiness endpoint and a fresh router-specific revocation/returning-login cycle were not exercised. Earlier persistent-delegation verification covers those owner lifecycle mechanisms for the pool-scoped grant. Normal-user gas support, tournament reset/funding limits, registration/scoring/rewards, cancellation/refunds and resolution corrections remain before tournament activation.

## Reusable deployment sequence

1. Review and commit the implementation, run the local checks, and push only `onchain-sepolia`.
2. Record the current factory/share-token addresses and each factory's deployment block. Retain them in the legacy settings below. Preserve existing Points/protocol IDs and rows.
3. Simulate the existing `DeployProtocol.s.sol` and `DeployProtocolV2.s.sol` scripts on Arbitrum Sepolia with the existing MXNP collateral and correct treasury, fee, market-creator and resolver roles. Deploy new tokens/factories from this source. Keep factory ownership with the deployer until the next step; verify the existing operations credential can create/resolve on the new factory targets before allowing approvals. Update only the preview's operations policy through its authorized owner flow if required.
4. Set the two **new** factory addresses in the deployment shell and simulate `DeployTradingRouter.s.sol`. It requires chain 421614, deployer ownership of both factories and unbound routers. After review, broadcast the router deployment and the two one-time bindings. Transfer factory ownership to the intended admin after binding. Verify source and runtime bytecode, then independently compute the deployed runtime keccak256 hash. The router script prints its address/hash; it never mints collateral or creates markets.
5. Configure only the `onchain-sepolia` preview with the new current factories/share tokens and `ONCHAIN_TRADING_ROUTER_ADDRESS` / `ONCHAIN_TRADING_ROUTER_CODE_HASH`. Keep all existing branch, chain and preview gates. Update current factory/token aliases consistently, including `FACTORY_ADDRESS`, `FACTORY_V2_ADDRESS`, `PRONOS_FACTORY_ADDRESS`, `PRONOS_FACTORY_V2_ADDRESS` and the Arbitrum Sepolia client aliases. Keep the collateral and MXNP supply unchanged.
6. In the **dedicated Sepolia indexer project**, update the current hard-coded `factories` pins in `ops/onchain-sepolia-indexer/worker.js` to the two reviewed deployment addresses. Keep `legacyFactories` pinned to the old addresses. Update the worker's current factory aliases, add the two legacy factory settings, and redeploy the worker from the reviewed branch SHA. Keep its isolated DB role/endpoint, project ID, actual RPC chain validation, signing-key prohibition, lease and cron protections. Never replace the pins with arbitrary environment-supplied addresses. Ensure the start block includes new factory creation; historical factories resume their existing checkpoints.
7. Deploy the exact-SHA application preview. Verify readiness shows `tradingAuthorization.scope = router` and `verified = true`, with no router blocker. Check all four factory checkpoints, current and historical catalog mappings, and legacy resolved holdings.
8. Through a real owner's normal login/consent flow, authorize once **before creating another market**. Record the Turnkey policy ID and scope hash, create fresh V1 and V2 pools, and prove they are unchanged. Run guarded buy/sell, resolve, index, redeem and index again. Check real owner addresses in receipts/events and compare the final wallet, protocol ledger and frontend positions. Confirm automatic cron handles new and historical pools without a manual indexing trigger.
9. Test revocation against actual Turnkey signing, returning login with an unchanged persistent grant, unauthorized pool/recipient/chain rejection and canceled consent. This release verified live wrong-chain and unauthorized-target signing rejection and on-chain legacy-pool rejection. A fresh router-specific revoke/relogin/canceled-consent cycle remains outstanding; local tests alone do not establish deployed behavior.

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

Contract tests cover approvals before pool creation, multiple future V1/V2 pools, real-user events/payouts, no router custody, price-guard rollback, spoof/unknown-pool rejection, owner isolation, one-time binding, token-approval revocation, non-Sepolia rejection and proportional cost-basis fuzzing. Eight-outcome buy/sell tests include cold account/storage access and stay below 570,000 execution gas, leaving room within the existing 600,000 transaction limit. Actual binary/three-outcome transaction gas is recorded above; an eight-outcome live rehearsal remains separate.

JavaScript tests cover unchanged future-market scope hashes, exact legacy token permissions, pinned-code/binding rejection, owner migration/completion/revocation, actual dispatcher approval reuse and ABI encoding, server-mapped frontend coverage, readiness blockers and four-factory indexing configuration. Both frontend builds target temporary directories so generated served assets are not modified.

Tournament activation and the remaining roadmap work—normal-user gas support, tournament reset/funding limits, registration/scoring/rewards and lifecycle rehearsals—remain separate from this preview release. This is not an independent contract audit.

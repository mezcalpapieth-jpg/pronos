# MVP Mainnet Readiness Runbook

This is the operator checklist for opening the `/mvp` app on Arbitrum One with
MXNB collateral. The app can be code-ready while mainnet is still blocked by
provider credentials, Safe ownership, funding rails, or contract deployment.

## 1. Provider Readiness: Juno / Bitso

- Confirm production docs and endpoint paths for CLABE creation, blockchain
  account registration, deposits, withdrawals, and webhooks.
- Set `JUNO_API_KEY`, `JUNO_API_SECRET`, `JUNO_BEARER_TOKEN`,
  `JUNO_API_BASE_URL`, and `JUNO_WEBHOOK_SECRET` in Vercel.
- Set `JUNO_CLABE_PATH`, `JUNO_BLOCKCHAIN_ACCOUNT_PATH`, and
  `JUNO_WITHDRAWAL_PATH` only after Juno / Bitso confirm the final paths.
- Confirm what KYC states arrive in the webhook payload and map them to the UI
  before letting users deposit.
- Keep `JUNO_WITHDRAWALS_ENABLED=false` until the provider approves production
  withdrawals. With it off, withdrawal requests remain in the admin queue.
- Turn on `JUNO_CARD_CHECKOUT_ENABLED` or `JUNO_APPLE_PAY_ENABLED` only after
  those rails are approved. Until then, the main deposit path is CLABE / SPEI.

## 2. Wallets, Safe, and Turnkey

- Create the Arbitrum One Safe with founder/admin owners before deployment.
- Set `ADMIN_SAFE_ADDRESS` and `RESOLVER_SAFE_ADDRESS` for deployment scripts.
- Set `ONCHAIN_DEPLOYER_SUBORG_ID` and `ONCHAIN_DEPLOYER_ADDRESS` to the
  Turnkey ops wallet that can create markets.
- Set `ONCHAIN_RESOLVER_SUBORG_ID` and `ONCHAIN_RESOLVER_ADDRESS` to the
  Turnkey resolver wallet.
- If admin should push owner-only actions directly from the app, set
  `ONCHAIN_OWNER_SUBORG_ID` and `ONCHAIN_OWNER_ADDRESS`. Otherwise owner-only
  actions such as contract cancellation, dispute correction, and refund batches
  must be executed through the Safe.
- Set `TURNKEY_POLICIES_ENABLED=true` only after policies are scoped to
  Arbitrum One, MXNB, the factories, and active AMM pools.

## 3. Contract Deployment

- Set `COLLATERAL_ADDRESS` and `ONCHAIN_COLLATERAL_ADDRESS` to the real MXNB
  Arbitrum address.
- Deploy V1 with `contracts/script/DeployProtocol.s.sol`.
- Deploy V2 with `contracts/script/DeployProtocolV2.s.sol`.
- Verify the contracts on Arbiscan.
- Copy the script output into Vercel:
  `ONCHAIN_MARKET_FACTORY_ADDRESS`, `ONCHAIN_MARKET_FACTORY_V2_ADDRESS`,
  `VITE_PRONOS_ARBITRUM_FACTORY`, `VITE_PRONOS_ARBITRUM_FACTORY_V2`,
  `VITE_PRONOS_ARBITRUM_TOKEN`, `FACTORY_ADDRESS`, `FACTORY_V2_ADDRESS`,
  `PRONOS_FACTORY_ADDRESS`, and `PRONOS_FACTORY_V2_ADDRESS`.
- Set `INDEXER_START_BLOCK` to the deployment block before the first indexer
  run.

## 4. CRE Resolution

- Keep the Chainlink CRE workflow in dry-run until deploy access is approved.
- Set `CRE_RESOLUTION_WEBHOOK_SECRET`, `CRE_RESOLUTION_MIN_CONFIDENCE_BPS`, and
  `CRE_RESOLUTION_MAX_AGE_MS` before enabling CRE submissions.
- Simulate `chainlink/cre/pronos-resolver` against staging settings.
- For AI/sentiment markets, CRE should submit resolution candidates only. Admin
  must press `Confirmar resolución` before funds settle.

## 5. Canary Market

- Run `/api/protocol/admin/onchain-status` and resolve every blocker.
- Create one tiny canary market from `/mvp/admin`.
- Buy both outcomes with a small amount.
- Verify `/api/indexer?key=<INDEXER_KEY>` imports the market, trades,
  positions, and portfolio value.
- Resolve the canary market from admin and verify redemption in the portfolio.
- Remove fake featured markets once real deployed markets are visible.

## 6. Emergency Rehearsal

- Create a second tiny canary market and buy a small position.
- Mark it canceled in admin and confirm trading is blocked.
- Export the refund report from the lifecycle response.
- Run `push-cancel-refunds` with a small batch and verify the portfolio/history
  update after indexing.
- Resolve a canary market, mark it disputed, clear the dispute, then verify the
  indexer does not overwrite the admin lifecycle state.

## 7. Gas Sponsorship

- Keep `GAS_SPONSORSHIP_ENABLED=false` until a relayer, paymaster, or funded
  Turnkey wallet path is live.
- If sponsorship is not live, the UI and support flow must explain that users
  still need Arbitrum ETH for on-chain transactions even though Turnkey removes
  wallet popups.

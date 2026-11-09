# MVP Mainnet Readiness Runbook

This is the operator checklist for opening real-money trading in the Points
app on Arbitrum One with MXNB collateral. The legacy `/mvp` app still hosts
funding and older protocol admin tools while those capabilities are integrated
into Points.

## Local MXNB fork rehearsal

From `contracts`, run the following with an Arbitrum One RPC that serves
historical state at block 522521132. Set `ARBITRUM_ONE_FORK_BLOCK` to another
specific block if the RPC lacks that historical state. The fixture holder
must still have sufficient MXNB at the selected block.

```sh
ARBITRUM_ONE_FORK_RPC="$ARBITRUM_ONE_ARCHIVE_RPC" \
  forge test --offline --match-contract ArbitrumOneMXNBForkTest --threads 1
```

Foundry executes all writes inside the fork. It uses the official MXNB proxy
and funds the test wallets by simulating an ERC-20 transfer from a historical
holder. The suite covers binary and multi-outcome markets, exact quote and
balance reconciliation, and duplicate cancellation refund rejection. It also
checks the trading cutoff, independent approval, stale proposals, public
objections, and corrections. Treasury can recover the pool's own winning
shares immediately after finalization. The transaction rolls back if the remaining collateral cannot
back every outstanding winning share. Sepolia keeps its 30-day recovery
delay. Each factory's fee vault distributes reviewed amounts by market and
batch ID, within fees actually collected by that market.

For the mainnet portfolio, show available wallet MXNB separately from
estimated payouts under review. Wallet MXNB can be traded or transferred
during a challenge. Estimated payouts become spendable after finalization
and a confirmed claim to the wallet. Each cash-out request must reconcile
to a confirmed MXNB debit before the provider sends fiat.

## Mainnet resolution review

1. Publish an immutable rules document before opening a market. Include the
   exact question, outcome mapping, event or observation ID, official source,
   cutoff with time zone, fallback source, and rules for postponement,
   ambiguity and cancellation. Pass the Keccak-256 hash of the exact
   published bytes to `createReviewedMarket`. Both factories store the hash.
   The factory cutoff applies to routed and direct pool trades.
2. After the cutoff, publish the result and its evidence in an immutable
   document. Include the market and rules hash, official result link and
   snapshot, observation time, and outcome under the published rules.
   The resolver calls `proposeResolution` with that document's hash.
   `ResolutionProposed` identifies the proposal and its review deadline.
3. The reviewer checks the evidence against the published rules and calls
   `approveResolution` for that exact proposal ID. A wallet can submit an
   objection hash through `flagResolution`. A flag creates a public event
   for triage. The reviewer or owner can open a dispute to block finalization.
4. To replace a disputed proposal, the resolver calls
   `proposeResolutionCorrection` with the disputed proposal ID and the new
   evidence hash. The reviewer can also clear the dispute and keep the
   outcome. Either action creates a new proposal revision, restarts the
   24-hour window, and requires fresh approval. The owner can call
   `finalizeResolution` only for the approved current ID after the window and
   with no open dispute. Winning claims and treasury recovery then become
   available. Ordinary wallet MXNB remains transferable and usable throughout.

Keep rules and evidence retrievable by hash and publish the matching document
links in the app. The contracts enforce the workflow and hash commitments.
Reviewers verify the source, the result, and the interpretation of the rules.
Use independently controlled signers for the resolver, reviewer, and owner.
The reviewer address is set once per factory. Rotate signers inside its Safe.

Reviewed factories are detected by the shared indexer on Arbitrum One.
Set `INDEXER_START_BLOCK` at or before deployment and provision the protocol
schema before the first scan. The indexer reads reviewed factories through
the RPC's finalized head and only the exact `ResolutionReviewFinalized`
event makes an approved proposal resolved in the database. Legacy events
continue to drive lifecycle for the older factories and Sepolia.

After backfilling the indexer and linking a reviewed pool to its Points
market, set `ONCHAIN_MAINNET_REVIEW_ENABLED=true` in the target app. The Points
market detail shows the rules, evidence, current proposal, and review state.
The admin review panel can publish exact UTF-8 documents up to 32 KB by
matching the on-chain hash. Publish the rules externally before market
creation, then mirror that exact file once the rules commitment is indexed.
Signed-in users can submit one objection per proposal from the app, without
a wallet transaction. The Points admin inbox shows app reports and indexed
on-chain flags and distinguishes earlier proposals. Operators triage the
inbox and execute the on-chain actions through the separate reviewer and
owner Safes.

Before a real-money canary, finish reviewed market creation and the Arbitrum
One trading and portfolio integration in Points. Add independent review for
cancellation decisions and reconcile the exact refund batch before enabling
the current owner-operated refund path with real funds.

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
- Set `RESOLVER_ADDRESS` or `RESOLVER_SAFE_ADDRESS` and
  `RESOLUTION_REVIEWER_SAFE_ADDRESS` for both deployment scripts. The reviewer
  Safe must already be deployed. Record `ADMIN_SAFE_ADDRESS` for the ownership
  handoff after router binding.
- Set `ONCHAIN_DEPLOYER_SUBORG_ID` and `ONCHAIN_DEPLOYER_ADDRESS` to the
  Turnkey ops wallet that can create markets.
- Set `ONCHAIN_RESOLVER_SUBORG_ID` and `ONCHAIN_RESOLVER_ADDRESS` to the
  Turnkey resolver wallet.
- If admin should push owner-only actions directly from the app, set
  `ONCHAIN_OWNER_SUBORG_ID` and `ONCHAIN_OWNER_ADDRESS`. Otherwise owner-only
  actions such as finalization, cancellation, and refund batches
  must be executed through the Safe.
- Set `TURNKEY_POLICIES_ENABLED=true` only after policies are scoped to
  Arbitrum One, MXNB, the factories, and active AMM pools.

## 3. Contract Deployment

- Set `COLLATERAL_ADDRESS` and `ONCHAIN_COLLATERAL_ADDRESS` to the real MXNB
  Arbitrum address.
- Deploy V1 with `contracts/script/DeployProtocol.s.sol`.
- Deploy V2 with `contracts/script/DeployProtocolV2.s.sol`.
- Bind both with `contracts/script/DeployMainnetTradingRouter.s.sol`. For
  this script, defer factory ownership transfer during the two deploys, bind
  the router, then transfer both owners to the reviewed Safe before funding
  or opening markets. The Arbitrum One factories create their own fee vaults.
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
- For AI/sentiment markets, CRE should submit resolution candidates only.
  Apply the same published evidence, independent approval, and finalization
  workflow before funds settle.

## 5. Canary Market

- Run `/api/protocol/admin/onchain-status` and resolve every blocker.
- Create one tiny reviewed canary market and verify it in Points and Points admin.
- Buy both outcomes with a small amount.
- Verify `/api/indexer?key=<INDEXER_KEY>` imports the market, trades,
  positions, and portfolio value.
- Propose the canary outcome, approve it from the reviewer Safe, and verify
  redemption appears in the portfolio only after the challenge period and
  owner finalization.
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

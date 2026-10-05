# Onchain Sepolia Tournament Roadmap

Branch: `onchain-sepolia`

Status: design + first backend/token/readiness/reset dry-run groundwork started. This branch must stay hidden behind flags until the next tournament reset.

## Goal

Run the next Points tournament with tournament money represented by a testnet ERC20 on Base Sepolia, while keeping the product feeling exactly like Points:

- Users still press `Comprar`, `Vender`, or `Cobrar`.
- Users do not see wallet addresses, gas, approvals, chain IDs, or explorer links in the normal flow.
- Markets still enter the product through the pending row and admin approval flow.
- No live Points balances or active markets are migrated on this branch.
- The tournament reset creates a fresh on-chain cycle, funds eligible wallets, and starts scoring from zero.

For this roadmap, "Sepolia" now means Base Sepolia. The existing contracts are EVM-compatible, but chain IDs, RPCs, deploy scripts, frontend aliases, indexer settings, and reset checks must use Base Sepolia instead of Arbitrum Sepolia.

## Non-Negotiables

1. Pressing buy is the approval.
   The user action can trigger multiple backend-signed transactions internally, but the UI should show one normal buying flow.

2. Markets go through pending first.
   New tournament markets must be inserted into `points_pending_markets` and approved from admin. Approval may auto-deploy the on-chain contract, but we should not insert directly into active markets.

3. No visible launch before reset.
   Production flags stay off until the launch checklist passes. Preview/canary can use real Sepolia contracts.

4. Tournament scoring only trusts registered tournament wallets and tournament markets.
   External token transfers, faucet calls, and arbitrary wallets must not improve leaderboard score.

5. We keep off-chain Points intact.
   Current Points markets, balances, resolver behavior, and tournament history remain available.

## Current Starting Point

Already useful in the repo:

- `points_markets.mode` can distinguish `points` from `onchain`.
- Admin pending approval can approve with `mode: onchain`, chain ID, pool address, market ID, and `autoDeploy`.
- The protocol has V1 binary and V2 multi-outcome factories.
- `MockMXNB` exists as a 6-decimal test collateral token.
- `onchain-trader.js` can quote, buy, sell, redeem, and deploy protocol markets.
- Turnkey delegation already aims for a no-popup trade UX.
- Protocol endpoints exist for markets, quotes, trades, positions, leaderboard, admin creation, and resolution.

Started on this branch:

- Added ERC1155 `setApprovalForAll` to the Turnkey delegated selector allowlist.
- Added share token addresses to delegation policy targets.
- Added backend sell-time share operator approval so sell can stay invisible to the user.
- Added `TournamentMXNP`, an owner-minted 6-decimal testnet token with no public faucet.
- Added a Sepolia readiness profile so tournament rehearsals do not require mainnet Juno/Bitso checks.
- Added a dry-run reset/funding planner for Base Sepolia that audits eligible wallets, env blockers, delegation gaps, duplicate wallet mappings, and the exact 500 MXNP allocation before any DB or chain writes exist.

## Key Product Decision

The next tournament should not convert existing Points markets. It should create a new tournament cycle where:

- Admin approves pending markets as `mode='onchain'`.
- Each approved market deploys a Sepolia protocol pool.
- Each eligible user gets a hidden Turnkey wallet and test MXNP balance.
- Portfolio, history, leaderboard, and rewards read from the on-chain cycle adapter.
- The old off-chain Points ledger remains the fallback and archive.

## Architecture

### Market Spec And Execution

Keep one canonical market spec and separate executions:

```txt
points_pending_markets row
  -> canonical question, outcomes, resolver config, category, images, tags
  -> points execution: points_markets.mode = 'points'
  -> on-chain execution: points_markets.mode = 'onchain'
```

For the next tournament, approval should produce one `points_markets` row with:

- `mode = 'onchain'`
- `chain_id = 84532` for Base Sepolia
- `chain_market_id = protocol market id`
- `chain_address = deployed AMM pool address`
- normal `featured`, `tournament_featured`, resolver, image, tag, and deadline metadata

### Wallets

Use hidden Turnkey sub-org wallets already associated with users.

Required states:

- User has a Turnkey sub-org.
- User has an EVM wallet address.
- User has an active delegation policy.
- Wallet has Sepolia gas, unless a relayer/paymaster path is implemented.
- Wallet receives the reset allocation of tournament MXNP.

### Mock Coin

Recommended launch token for this tournament:

- Name: `Tournament MXNP`
- Symbol: `MXNP`
- Decimals: `6`
- Network: Base Sepolia
- Minting: owner/operator only, no public faucet
- Reset funding: mint or transfer exactly the tournament allocation to eligible wallets

The existing `MockMXNB` is useful for dry runs, but it has an unlimited public faucet. Since tournament fairness matters, the next implementation step should either replace it with an owner-minted `MockMXNP`/`TournamentMXNP` contract or score only event-derived PnL while ignoring raw wallet balance increases from external sources.

### Trading

The user-facing button should stay one action:

```txt
User taps Comprar
  -> API quotes trade
  -> API checks hidden wallet/delegation
  -> API signs ERC20 approve if needed
  -> API signs buy
  -> UI shows bought result
```

For sell:

```txt
User taps Vender
  -> API quotes sale
  -> API checks ERC1155 operator approval
  -> API signs setApprovalForAll if needed
  -> API signs sell
  -> UI shows sold result
```

For redeem:

```txt
User taps Cobrar
  -> API signs redeem
  -> indexer reconciles collateral and realized PnL
```

Longer-term optimization:

- Add `permit`/`buyWithPermit` for collateral approvals if we want one transaction per first buy.
- ERC1155 does not have a standard permit in the current contracts, so sell still needs either hidden `setApprovalForAll`, a custom permit-like token, or a custody/router redesign.

## Workstreams

### 1. Chain And Contracts

Tasks:

- Final testnet: Base Sepolia.
- Add controlled `TournamentMXNP` or `MockMXNP` ERC20 with 6 decimals and owner-only mint.
- Keep `MockMXNB` only for local/dry-run faucet testing.
- Deploy collateral token to Base Sepolia.
- Deploy V1 binary token/factory/pool stack with tournament collateral.
- Deploy V2 multi-outcome token/factory/pool stack with tournament collateral.
- Configure factory owner, market creator, resolver, treasury, liquidity reserve, emergency reserve.
- Verify contracts where possible.
- Run Foundry tests for:
  - buy with collateral approval
  - sell with ERC1155 operator approval
  - redeem after resolution
  - cancel/refund
  - V2 multi-outcome price and sell math
  - parallel-market leg behavior

Open decisions:

- Token name/symbol: use `Tournament MXNP` / `MXNP` for product consistency.
- Public faucet: avoid for launch fairness.
- Gas path: pre-fund wallets for Sepolia first, relayer/paymaster later.

### 2. Turnkey Delegation And Hidden Signatures

Tasks:

- Include collateral token, share token V1, share token V2, factories, and pools in policy targets.
- Include selectors:
  - ERC20 `approve(address,uint256)`
  - ERC1155 `setApprovalForAll(address,bool)`
  - binary buy/sell
  - multi buy/sell
  - redeem
- Refresh policies when new pools are deployed.
- Make policy refresh automatic when a user first trades a newly approved market.
- Keep one user-visible consent surface, ideally at signup or before first on-chain tournament action.
- Do not expose per-trade approvals in UI copy.

Launch blocker:

- A user who has never sold before must still be able to sell from the normal sell button.

### 3. Tournament Reset

Tasks:

- Create a reset command/job for an on-chain tournament cycle.
- Snapshot current off-chain tournament state before reset.
- Create or verify Turnkey wallets for eligible users.
- Create or refresh delegation policy for each eligible user.
- Fund each wallet with testnet gas.
- Mint or transfer exactly `500 MXNP` to each eligible tournament wallet.
- Store cycle metadata:
  - cycle ID
  - start timestamp
  - chain ID
  - collateral address
  - factory addresses
  - token addresses
  - wallet funding transaction hashes
- Mark old off-chain cycle closed.

Important scoring rule:

- Leaderboard score should be derived from tournament market events and positions, not from raw ERC20 balance alone.

### 4. Admin Market Approval

Tasks:

- Add an admin cycle setting: default approval destination `points` or `onchain`.
- For the on-chain tournament, default pending approval to `onchain` only while the cycle flag is enabled.
- Keep bulk approval disabled for on-chain unless each row auto-deploys its own market safely.
- Make auto-deploy idempotent enough for retries.
- Record failed deploy attempts with useful admin detail.
- For parallel markets, deploy each leg as its own binary V1 pool or build a native parallel deploy helper.
- Detect and report orphaned leg deploys.
- Add admin columns/badges for:
  - chain deploy pending
  - chain deploy failed
  - deployed pool
  - resolver ready
  - indexer seen

### 5. Points Frontend Adapter

Tasks:

- Add a market client adapter used by cards, detail, trade modal, portfolio, and history.
- Dispatch by market mode:
  - `points` calls existing `/api/points/*`.
  - `onchain` calls protocol/on-chain endpoints.
- Keep shared UI components where possible.
- Hide chain internals in normal user pages.
- Add admin/debug-only transaction hashes.
- Make the buy modal tolerate internal approve-plus-buy latency with one spinner state.
- Make sell and redeem use the same product language as today.
- Ensure cache keys separate `points` and `onchain` payloads.

### 6. Indexer And Read Models

Tasks:

- Configure indexer for Base Sepolia chain ID `84532`.
- Track both factory versions.
- Track deployed pools as markets are approved.
- Ingest:
  - `MarketCreated`
  - `SharesBought`
  - `SharesSold`
  - `MarketResolved`
  - `MarketCanceled`
  - `CancelRefundPushed`
- Build/read positions by wallet, market, outcome.
- Build/read trade history.
- Build/read realized PnL.
- Build/read open mark-to-market PnL.
- Add lag checks and admin status.

Launch blocker:

- After a trade confirms, portfolio and leaderboard must update from indexed data within an acceptable delay.

### 7. Tournament Scoring

Tasks:

- Define on-chain tournament score formula before implementation:
  - realized PnL
  - open mark-to-market PnL
  - conviction bonus
  - liquidity bonus
  - inactivity penalty
  - combined/parlay behavior
- Decide which rewards exist in on-chain v1.
- Port only the rewards that can be computed honestly from chain events and cycle metadata.
- Apply the October rule style carefully: qualifying markets are based on approval time and tournament cycle, not just featured UI placement.
- Exclude:
  - non-cycle markets
  - non-registered wallets
  - external transfers
  - faucet mints
  - admin/test wallets
- Add audit endpoint/export to reconcile a user's profile PnL against tournament PnL.

### 8. Security And Abuse Controls

Tasks:

- Keep wallet addresses out of normal UI.
- Do not publish faucet links.
- Prefer owner-only mint token for tournament launch.
- Rate limit trade endpoints.
- Cap delegated daily notional.
- Alert on:
  - unexpected token transfers into tournament wallets
  - failed trade bursts
  - wallets with external funding
  - policies near expiry
  - markets missing indexer coverage
- Keep admin/reset scripts branch-gated and explicit.

Even in a closed site, users should not be able to improve tournament score by moving tokens around. Score from protocol activity, not raw spendable balance.

### 9. Testing Plan

Local/unit:

- `node --test frontend/api/_lib/turnkey-delegation.test.js`
- `node --test frontend/api/_lib/partner-onchain.test.js`
- focused protocol payload/leaderboard tests
- `forge test` for contracts

Integration:

- Deploy token + factories on Base Sepolia.
- Create three test users.
- Fund 500 MXNP + gas.
- Approve two pending markets as on-chain:
  - one binary
  - one multi-outcome
- Buy, sell, resolve, redeem.
- Verify portfolio, history, market detail, leaderboard, and admin status.

Dry run:

- Run full reset in a preview/staging DB branch.
- Approve 5-10 pending markets.
- Simulate enough users to create real leaderboard movement.
- Resolve at least one win, one loss, one cancel/refund.
- Confirm no off-chain Points balances moved.

### 10. Deployment And Launch

Before launch:

- Keep flags off in production.
- Deploy branch preview with Sepolia env.
- Run launch readiness endpoint/checklist.
- Promote only a SHA-matched preview when ready.
- Freeze contract addresses in env docs.
- Export reset snapshot.
- Run the on-chain reset.
- Confirm all eligible wallets funded.
- Enable on-chain tournament flag.
- Approve first pending markets into on-chain mode.

After launch:

- Monitor failed transactions.
- Monitor indexer lag.
- Monitor leaderboard reconciliation.
- Keep manual admin correction path ready.
- Keep rollback plan: hide on-chain markets and continue off-chain Points if needed.

## 25-Day Timeline

Days 1-3: baseline and contract choice

- Finish sell approval plumbing.
- Add controlled tournament token.
- Decide final chain and env names.
- Deploy dry-run token/factories.
- Write first reset design.

Days 4-7: wallet and reset

- Create/verify Turnkey wallets for eligible users.
- Build reset funding job.
- Fund test wallets with gas and 500 MXNP.
- Persist cycle metadata.
- Add reset audit output.

Days 8-12: trading integration

- Add frontend/API market adapter.
- Route buy/sell/redeem by `mode`.
- Make on-chain trading feel like current Points trading.
- Handle internal approval-plus-action states.
- Add sell/redeem tests.

Days 13-16: indexer and scoring

- Configure Sepolia indexer.
- Build on-chain portfolio read model.
- Build tournament leaderboard read model.
- Add reconciliation endpoints.
- Decide on conviction/liquidity/inactivity rewards for v1.

Days 17-20: admin and operations

- Add on-chain approval destination in pending admin.
- Add deploy/retry/status UI.
- Add market deploy audit logs.
- Add resolver/cancel/refund status visibility.
- Add policy refresh path for new pools.

Days 21-23: dry run

- Run full reset in staging.
- Approve real pending markets into on-chain mode.
- Run multi-user buy/sell/resolve/redeem.
- Fix indexer/scoring/UI issues.
- Confirm no unintended live Points changes.

Days 24-25: launch prep

- Freeze contracts and env.
- Final build/tests.
- Promote SHA-matched preview.
- Run reset.
- Enable flag.
- Monitor first approved markets.

## Open Decisions

- Use existing `MockMXNB` for dry run only, or add `TournamentMXNP` immediately.
- Pre-fund hidden wallets with Sepolia ETH, or implement gas sponsorship now.
- Keep hidden approve-plus-buy as v1, or add permit/buyWithPermit in contracts.
- Which reward components ship in on-chain tournament v1.
- Whether partner/on-chain public calldata should expose ERC1155 sell approval transactions now or later.
- Whether the readiness checker should support Sepolia and mainnet profiles separately.

## Immediate Next Tasks

1. Done: finish and test the hidden ERC1155 sell approval patch.
2. Done: finish and test `TournamentMXNP` with owner-only mint and deployment script.
3. Done: add Sepolia-specific readiness profile instead of mainnet-only readiness checks.
4. Done: add reset/funding script skeleton with dry-run mode.
5. Next: wire admin pending approval to a branch-only on-chain default flag.

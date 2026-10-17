# Onchain Sepolia Tournament Roadmap

Branch: `onchain-sepolia`

Status: contracts, preview runtime, Points execution guards, and the Points frontend adapter are shipped to the isolated preview. The single-market approval/indexing rehearsal and the adapter's live mapping, quotes, public reads, Points separation, session guards, and served bundles are verified. A real user-wallet rehearsal, user delegation/funding, and tournament-cycle work remain. This branch must stay hidden behind flags until the next tournament reset.

## Goal

Run the next Points tournament with tournament money represented by a testnet ERC20 on Arbitrum Sepolia, while keeping the product feeling exactly like Points:

- Users still press `Comprar`, `Vender`, or `Cobrar`.
- Users do not see wallet addresses, gas, approvals, chain IDs, or explorer links in the normal flow.
- Markets still enter the product through the pending row and admin approval flow.
- No live Points balances or active markets are migrated on this branch.
- The tournament reset creates a fresh on-chain cycle, funds eligible wallets, and starts scoring from zero.

For this roadmap, "Sepolia" means Arbitrum Sepolia (chain ID `421614`). Use its RPC, deploy aliases, frontend aliases, indexer settings, and reset checks for tournament rehearsals.

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
- Added a dry-run reset/funding planner for Arbitrum Sepolia that audits eligible wallets, env blockers, delegation gaps, duplicate wallet mappings, and the exact 500 MXNP allocation before any DB or chain writes exist.

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
- `chain_id = 421614` for Arbitrum Sepolia
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
- Network: Arbitrum Sepolia
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

- Final testnet: Arbitrum Sepolia.
- Add controlled `TournamentMXNP` or `MockMXNP` ERC20 with 6 decimals and owner-only mint.
- Keep `MockMXNB` only for local/dry-run faucet testing.
- Deploy collateral token to Arbitrum Sepolia.
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

Deployed and verified through authenticated HTTP on 2026-10-17; real signed-wallet verification remains pending. See the checkpoint below.

Scope:

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

- Configure indexer for Arbitrum Sepolia chain ID `421614`.
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

- Deploy token + factories on Arbitrum Sepolia.
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
5. Done: wire admin pending approval to a branch-only on-chain default flag.
6. Done: configure the isolated preview database, Arbitrum Sepolia runtime, and separate operational secrets.
7. Done (2026-10-17): deploy MXNP and fresh V1/V2 factories; verify and fund the dedicated Turnkey operations wallet; replace only `onchain-sepolia` preview aliases. See the deployment checkpoint below.
8. Done (2026-10-17): ship the preview, verify its exact source SHA and readiness, and approve/index one 500-MXNP test market through the deployed admin API. Verify live protocol quotes and Points execution guards. See the rehearsal checkpoint below.
9. Next: connect the Points frontend adapter to protocol execution, preserving separate Points/protocol database IDs and ledger reads. Include market cards/detail, buy/sell/redeem, portfolio, and history; do not activate a partially routed tournament.
10. Remaining: obtain user-authorized delegation, establish user wallet gas support, and run the reset/funding dry run in its own authorized scope before any allocations. Then rehearse buy, sell, resolve, and redeem with a consenting test user, and verify indexed portfolio/score updates.

### Preview Admin Approval Setting

Set `ONCHAIN_PREVIEW_APPROVALS_ENABLED=true` only for the `onchain-sepolia` Preview environment. The server additionally requires `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=onchain-sepolia`, and `ONCHAIN_CHAIN_ID=421614`; the setting stays inactive in production or on other branches/chains. Vercel supplies the deployment metadata; do not spoof it in deployed environment variables.

When active, Points admin's pending queue shows a **Destino de aprobación (preview)** selector. It defaults to **Arbitrum Sepolia**, with **Points** available as an explicit alternative. Each Sepolia approval uses the existing deployment path to create its own contract. Bulk on-chain approval is disabled in the UI and rejected by the API before database work. Missing runtime configuration returns an error without falling back to a Points market.

The default applies only to human reviews through `/api/points/admin/pending-markets`. Scheduled tournament approvals and existing explicit MVP approval options keep their previous behavior. It does not migrate existing markets or enable on-chain trading in the Points UI.

Keep the flag off until the preview has an isolated database, verified Arbitrum Sepolia RPC/contracts, and a funded Turnkey deployer with the required factory permissions. Configure the token, factories and Turnkey runtime from the readiness checklist before approving a test market. This implementation does not deploy contracts, reset balances or change production configuration.

### Preview Runtime Configuration — 2026-10-17

This is the initial runtime checkpoint. The MXNP deployment checkpoint below supersedes its legacy contract aliases and unverified signer status.

Configured 37 variables in Vercel project `pronos` (`prj_Cq2kBrGtvtU7nVOH3T6yBGJWGRKi`), all targeting **Preview / `onchain-sepolia`**. These settings apply to the next deployment of this branch; no deployment, commit, or push was performed during configuration.

The database is now assigned to a dedicated Neon branch, `onchain-sepolia-preview` (`br-sweet-dream-amb6hlfe`) in project `pronos-mvp` (`tiny-heart-17710833`). It is a normal copy of `main` at creation, so existing test accounts and pending markets can be exercised independently. It is not continuously synchronized with production. Compute is 0.25–1 CU with a 300-second idle suspension.

- `DATABASE_URL` and `DATABASE_WRITE_URL` use the new branch's pooled writer connection (`neondb_owner`).
- `DATABASE_READ_URL` uses the same new endpoint with `pronos_reader`. SELECT checks confirmed it can read pending markets and cannot insert or update them.
- `POINTS_SESSION_SECRET`, `CRON_SECRET`, and `INDEXER_KEY` are newly generated branch-specific secrets. The three database URLs are also stored as sensitive variables. Existing production sessions and cron secrets were not changed.
- `ONCHAIN_READINESS_PROFILE=sepolia`; `ONCHAIN_CHAIN_ID`, `VITE_ONCHAIN_CHAIN_ID`, `CHAIN_ID`, and `PROTOCOL_CHAIN_ID` are all `421614`.
- `ONCHAIN_RPC_URL`, `ARB_RPC_URL`, and `ARB_SEPOLIA_RPC` use `https://sepolia-rollup.arbitrum.io/rpc`; a live read confirmed chain ID `421614`.

The following existing contracts were verified through read-only RPC calls and configured consistently across server, browser, and indexer aliases. They are **legacy USDC rehearsal contracts**, not the tournament MXNP deployment:

| Component | Verified Arbitrum Sepolia address |
| --- | --- |
| V1 factory | `0x68d09c6636019719cb7a3b50f93e421ec18ccfbc` |
| V2 factory | `0xf87f7e2c1e97054343670aa5cbe69eb69f1bbf8f` |
| V1 ERC1155 shares | `0x5039b8ad44e7c2485487d5801fdbf1344ebe35e1` |
| V2 ERC1155 shares | `0x28d99089673d5e1fd65999512b5345f40d85ea01` |
| USDC collateral | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

Both factories report the listed collateral and share tokens. Their owner is `0xF5015Ec3C55AbCbC1254BD959816325e683e5dE1`, an EOA holding 0 Sepolia ETH at this check; their resolver is `0xa8eE70541d537389ed287d204efC5297569321d5`, also an EOA. Neither returned `marketCreator()` through the current ABI, so automatic creation permissions must not be assumed. `INDEXER_START_BLOCK` points to the legacy V1 factory's deployment block; update it when replacing these factories.

`ONCHAIN_COLLATERAL_SYMBOL=USDC` and `VITE_ONCHAIN_COLLATERAL_ADDRESS` explicitly identify the legacy ERC20. `VITE_PRONOS_*_TOKEN` / `*_TOKEN_V2` identify ERC1155 shares. The readiness check now validates those separately and rejects zero-address Safe placeholders as owner controls.

**Activation remains off:** `ONCHAIN_PREVIEW_APPROVALS_ENABLED=false`, `TURNKEY_POLICIES_ENABLED=false`, `GAS_SPONSORSHIP_ENABLED=false`, and the three Juno checkout/withdrawal flags are false for this preview. Existing Turnkey API credentials and deployer settings remain inherited; their presence was checked via metadata, but the sensitive deployer identity/sub-org values and signing permissions have not been verified. Dedicated resolver and owner signer settings are still missing. No wallet policies, balances, markets, or chain state were modified.

Before enabling the preview:

1. Confirm the Turnkey deployer, resolver, and owner wallet addresses/sub-org IDs. A Foundry deployment key and a Turnkey runtime signer are separate configurations; do not infer one from the other.
2. Deploy `TournamentMXNP` and fresh V1/V2 factories on chain `421614`, configuring the confirmed creator, resolver, and owner roles. The existing legacy USDC contracts must not be relabeled as MXNP.
3. Replace the server, browser, and indexer factory/share/collateral aliases with the new deployment; set `ONCHAIN_TOURNAMENT_MXNP_ADDRESS`, `ONCHAIN_COLLATERAL_SYMBOL=MXNP`, `VITE_ONCHAIN_COLLATERAL_ADDRESS`, and the new factory start block.
4. Verify creator/resolver/owner permissions, runtime signer gas, seed collateral, and delegation targets. Keep both approval and signing flags off until these checks pass. The local Foundry wallet `0x0Caa37c077924038e14e9D8dE46B5208788e52CF` held `0.004659166628142` Sepolia ETH at this check; that does not establish the runtime signer's funding.
5. Ship a reviewed `onchain-sepolia` preview, verify its exact SHA and `/api/points/admin/onchain-status`, then enable the branch-specific signing/approval flags and deploy again for a single-market approval test. Keep the Points trading-adapter work and reset/funding dry run as separate remaining roadmap tasks.

Verification: read back all 31 public configuration values, confirmed six new variables are sensitive, and confirmed all 100 original environment-variable records were unchanged (including 70 production-targeted records and nine Pointbreak-specific records). Local `pointbreak` and `origin/pointbreak` stayed at `47aa9e19115d64bc36a2684e5eeb685caef117ba`. The 76 focused readiness, approval, factory-permission, reset-planner, deployment-script, and admin tests passed; `git diff --check` passed. No deployed application flow has been verified with this new configuration yet.

### MXNP Deployment And Turnkey Verification — 2026-10-17

Deployed on **Arbitrum Sepolia / chain `421614`** from the `onchain-sepolia` working tree. The machine-readable [deployment record](./onchain-sepolia-mxnp-deployment-2026-10-17.json) contains successful transaction receipts, constructor arguments, bytecode hashes, source SHA-256 fingerprints, role checks, funding proofs, and the preview configuration readback. The source changes are still uncommitted; the record identifies their base commit and fingerprints rather than claiming a committed SHA contains them.

| Component | New address |
| --- | --- |
| Tournament MXNP, ERC20 / 6 decimals | `0x6ed6C00C2B4cF9f5989866f4c5862D4cdeD67ef9` |
| V1 factory | `0x69440742A168635D9fA7cC0cfb0935AFFFe79Ad3` |
| V1 ERC1155 shares | `0xc26F94E86da1193DADE6d798AcDF8C0BC4d68946` |
| V2 factory | `0xFcac9cfCF22Df809ba365C85dD767C90BB260FD6` |
| V2 ERC1155 shares | `0x2748E2d6E64AA6aabB368C4e9d844c87fE615Caf` |
| V1 pool creation-code store | `0xaB878eF1b244FF4c53C6d212ceF7cbAC88Cd48F3` |
| V2 pool creation-code store | `0xf6723A289a356f20D1B5e09143580451fd120060` |

Both factories use the new MXNP collateral. Their ERC1155 tokens authorize their respective factories as minters and are owned by those factories. The new indexer start block is **`320053989`**, the V1 factory's creation block. The legacy USDC contracts and their roles remain unchanged; the explicitly named `VITE_PRONOS_ARB_SEPOLIA_USDC` alias still refers to USDC, while `VITE_ONCHAIN_COLLATERAL_ADDRESS` now refers to MXNP.

**Dedicated preview operations signer:** `0x6e2f3D41F893C8DD0f638f3fee212ea0457E317c`, Turnkey wallet `pronos-onchain-sepolia-ops-2026-10-17` (`8f4bb026-14cf-5590-b9f7-6100fc2ad08c`). It belongs to the existing parent organization `34e1b782-dc66-4b66-9ac7-477b743718f5`; the three `ONCHAIN_*_SUBORG_ID` settings intentionally use that organization ID for this operations wallet. No private key was exported. This wallet owns MXNP and holds the owner, creator, and resolver roles on both new factories.

The existing API credential authenticates as a **root user in the parent organization**. Signing was verified with that existing authority; no restrictive operations policy or separate API credential was created. The dedicated wallet separates preview funds and contract roles, but it does not isolate the existing API credential's broader authority. This verification does not establish user-wallet delegated signing: user consent, non-root delegation policies, target coverage, expiration, and trade-flow checks remain separate work. No existing policies or credentials were modified.

Read-only contract calls verified that the operations signer passes owner controls, reaches the seed validation in market creation, and reaches market validation in resolution. Calls from the former local deployment wallet fail the corresponding owner, creator, and resolver checks. No market was created during these probes.

Funding and actual Turnkey execution were confirmed:

- [Gas transfer](https://sepolia.arbiscan.io/tx/0x2f3cc93bfe64daf4e5d8cf1c7f3bfb31efb0081f744c9b837553bedd3790b4ba): `0.001` Sepolia ETH from local deployment wallet `0x0Caa37c077924038e14e9D8dE46B5208788e52CF` to the operations wallet.
- [Owner-only seed mint](https://sepolia.arbiscan.io/tx/0xf9821977bc0e05b0f30d613631c2f28b4761c49324e7ffdc429d534dd965b362): Turnkey signed and the chain confirmed `1,000 MXNP` minted only to the operations wallet. This covers two default `500 MXNP` market seeds. No tournament user received an allocation or balance reset.
- After that transaction, the operations wallet held **`0.000998578624076` Sepolia ETH and `1,000 MXNP`**. Total MXNP supply was `1,000`. The local deployment wallet retained `0.003296805304700215` Sepolia ETH. These are checkpoint balances, not fixed guarantees for later fee conditions.
- At the check, the application's buffered V2 approval/create gas reserve was `0.00052 ETH`, below the funded operations balance. The cofounder's additional test ETH was not needed for this deployment. For additional operating gas, transfer **Arbitrum Sepolia ETH on chain `421614`** to the dedicated operations address above.

Two deployment/runtime blockers were fixed on this branch:

1. Factory runtime bytecode originally exceeded EIP-170 (`29,611` / `32,962` bytes). Each constructor now stores its pool creation code in an immutable, inert contract. The factory copies that code and executes CREATE itself, preserving the pool's factory authority and existing constructor/call interfaces. Deployed factory sizes are `12,712` / `13,934` bytes with the existing Solidity 0.8.24 optimizer configuration. The complete 122-test Solidity suite passes, including pool lifecycle/fuzz coverage and two new code-storage/size checks.
2. ethers v5's `getFeeData()` supplied a `1.5 gwei` default tip against a roughly `0.02 gwei` Sepolia gas quote, inflating the runtime's funding requirement. The `421614` runtime now uses the node gas quote with a 2x fee cap and zero tip for both preflight and signing. Other chains retain their existing provider fee behavior. This follows the [Arbitrum gas model](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/gas-and-fees); the actual mint above confirms the Sepolia transaction path. Fee failures propagate without a fabricated quote.

Creation transaction bytecode and deployed runtime bytecode (accounting for constructor immutables) were matched to local artifacts for MXNP, both factories, and both share tokens. The stored pool initcode was also matched exactly. Public explorer source verification was not submitted; no Arbiscan API key was configured.

Updated **24 public Vercel configuration values**, exclusively for **Preview / `onchain-sepolia`**, covering the new contracts, collateral symbol, indexer start block, and the three signer roles. All values were read back. Existing branch database/secrets and disabled flags remain in place. All 100 environment records outside this branch, including 70 production-targeted records and nine Pointbreak-specific records, remain unchanged. Both Pointbreak refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`.

**Activation is still off.** The contract deployments are live; the new application configuration and fee helper require the next reviewed preview deployment. No application deployment, commit, push, production promotion, market approval, user reset, or user-policy modification was performed. All 91 focused JavaScript tests passed.

Next steps:

1. Commit and push the reviewed `onchain-sepolia` changes, deploy its preview, verify the exact source SHA and `/api/points/admin/onchain-status`, and check that new contracts and signer roles are reported.
2. Enable only this preview's signing/approval flags after reviewing its remaining readiness checks, then deploy again and approve one small market. Confirm collateral approval, factory creation, indexing, and admin response end to end.
3. Verify user-authorized delegation against the new MXNP/share/pool targets, finish the Points trading adapter, and run the tournament reset/funding planner in dry-run mode before any user allocations.

### Tournament Collateral Capacity — 2026-10-17

The deployed `1,000 MXNP` is a signing/deployment smoke-test balance. Size the tournament treasury from user grants **and** the actual market seed schedule. The read-only [capacity audit](./onchain-sepolia-capacity-2026-10-17.json) contains the aggregate source data, calculation assumptions, projections, and public RPC estimates. All source Points markets and balances remain unchanged.

| Funding component, MXNP-equivalent | August tournament, Aug 12 06:00–Aug 27 05:59 UTC | October, Oct 1 06:00–Oct 17 11:06 UTC |
| --- | ---: | ---: |
| User baseline, 500 per registered user | 95,000 (190 users) | 299,500 (599 users) |
| Rewards and explicit carryover | 125,893.03 | 181,299.49 |
| Published market pool seeds | 305,183.63 (304 pools) | 508,683.53 (333 pools) |
| Total budget before recycling collateral | **526,076.65** | **989,483.02** |

These are conservative equivalent-capital budgets for the observed Points workload, not a reconstruction of historical cash flows or collateral already deposited on-chain. Seeds include active, resolved and canceled published pools at their current configured amounts; pending/test rows are excluded. Count one scalar seed per unified pool and one per parallel child pool. Do not count a parallel parent again or sum unified per-outcome share reserves as extra collateral. New signup grants are included in the 500-per-user baseline once. Trade volume, sale proceeds, redemptions, refunds, reset balance deltas, and leaderboard-only bonuses are not fresh token issuance. Admin account adjustments and any migration of existing stock/parlay liabilities require separate review.

Most October pools use 1,000 points; 13 use 5,000 and 11 use 10,000. Mean October seed is 1,527.58. At the observed rate, the full October cycle projects to approximately **732,334 MXNP for users and rewards + 972,613 MXNP for seeds = 1.70 million MXNP**. This projection keeps the opening 410-user allocation fixed and scales subsequent signups, rewards and market creation. Existing pre-October active/recently resolved pool seeds add a further 929,729-equivalent capital proxy if future cycles overlap in that way; no historical market migration is planned.

Historical generation can be much larger: July's full calendar month published **12,345 pool equivalents with 12,330,145 points in seeds**, including 12,150,000 in `chainlink_price` pools. That is a broader stress case, not the August tournament window or an instruction to enable those generators in preview. Pool-owned winning-share collateral recovery waits **30 days after resolution**, and user winnings consume pool collateral; budget without assuming immediate or full seed recovery.

**Planning target: 50,000,000 MXNP in the operations treasury**, released only against approved market seeds and audited user/reward grants. A current-scope launch reserve of 10 million would cover the observed normal cadence with substantial headroom; the 50 million target also covers the historical high-frequency scenario. The explicit stress calculation is `1.5 × (2 × July monthly seed peak + 2 × projected October user funding) ≈ 39.19 million`, rounded up to 50 million. It is a reserve target, not a protocol minimum or a change to the 500-MXNP starting allocation. At the original capacity-audit checkpoint, supply was 1,000 and no larger mint had been executed. The subsequently authorized **49,999,000-MXNP** top-up is confirmed in the checkpoint below.

MXNP units and Arbitrum Sepolia ETH are independent budgets. `TournamentMXNP.mint` is owner-only and has no ETH payment/backing requirement or fixed application supply cap. At block `320056909`, read-only RPC simulation estimated `36,829` gas to mint 1,000 MXNP and `36,853` gas to mint either 10 million or 100 million to the existing treasury wallet: approximately **0.00000074 ETH** at the quoted `0.02 gwei`, before fee buffers and later fee changes. Gas scales chiefly with operations/recipients and market/trade transaction count, not nominal MXNP issuance. The operations wallet still held `1,000 MXNP` and `0.000998578624076 ETH`; total supply was still 1,000. The cofounder's 3 ETH would fund gas separately if transferred, rather than back the MXNP reserve.

Before activation, add user/reward issuance execution and reserve accounting, enforce mint idempotency and per-cycle grant limits, and estimate gas for the planned number of wallets, pool deployments, approvals, trades and resolutions. All 599 users have distinct valid wallet mappings, but no current user delegation policy rows were found, so capacity does not establish signing readiness. Keep preview activation disabled until the existing readiness checks and small-market end-to-end rehearsal pass. This audit adds no mint, transfer, user reset, deployment, or Pointbreak change.

### Operations Treasury Top-Up — 2026-10-17

Following explicit user authorization, Turnkey signed an owner-only mint of **49,999,000 MXNP** to the existing operations wallet `0x6e2f3D41F893C8DD0f638f3fee212ea0457E317c`, bringing both its balance and total supply from 1,000 to exactly **50,000,000 MXNP** on Arbitrum Sepolia (`421614`). Token: `0x6ed6C00C2B4cF9f5989866f4c5862D4cdeD67ef9`.

- [Successful transaction](https://sepolia.arbiscan.io/tx/0x06b4aae6e1321d3263e64ec1e7d419c8e976a8ad74c9d64ef78a028a3b18b5b1), block `320063087`; receipt status 1 and the single zero-address-to-operations mint event were verified. Readback at block `320063102` showed 50 million in both the treasury and total supply.
- Actual fee: **0.00000073250026 Sepolia ETH**, `36,490` gas at `0.020074 gwei`. The operations wallet retained `0.000997846123816 ETH` at that readback.
- Before signing, topping up the same 1,000 balance to 50 million or to 100 million each estimated **36,853 gas / 0.00000073706 ETH** at the same gas quote. The 100-million case was simulated only. Fees depend on execution, storage and transaction data; token quantity does not create a proportional ETH cost or backing requirement. Later quotes may vary.
- Spare treasury units do not alter user balances or market depth until distributed or seeded. Enforce the same per-user grant and per-market seed limits, exclude the operations wallet from tournament scoring, and audit reserve movements. This token has no public or owner burn function, so unnecessary issuance cannot be removed from total supply through the existing contract. Additional authorized minting remains possible later.

The [public top-up record](./onchain-sepolia-mxnp-topup-2026-10-17.json) preserves the preflight comparison, exact amount/calldata, Turnkey activity ID, successful receipt, and before/after balances. No private key was exported. No user received tokens, no market was created, and no application deployment, flag/configuration update, commit, push, or Pointbreak change was performed. The earlier deployment and capacity files remain historical checkpoint records; use this top-up record for the latest verified supply.

### Preview Readiness and Execution Boundary — 2026-10-17

Committed and pushed the deployment/runtime work as `eafdeb0965c1e523a5fd27d47ae710a2ff939e7f`. Its Vercel Preview deployment is READY. Authenticated `/api/points/admin/onchain-status` on the same source commit confirmed chain `421614`, matching V1/V2 factory and share-token aliases, the new MXNP collateral, owner/creator/resolver permissions, and the treasury's 50 million MXNP / `0.000997846123816 ETH`. The only configuration blocker was the deliberately disabled signing flag; CRE automation and user gas sponsorship remain review items. The served Points admin lazy bundle contains the preview approval selector. Unauthenticated admin requests return 401.

Enabled `TURNKEY_POLICIES_ENABLED` and `ONCHAIN_PREVIEW_APPROVALS_ENABLED` only for Preview / `onchain-sepolia`, for the one-market rehearsal. Gas sponsorship stays false. Rotated only this preview's session secret and manual indexer key for authenticated verification; temporary verification credentials are kept outside the repository and removed after the run. All 100 environment records outside this branch, including nine Pointbreak-specific records, were compared and remain unchanged. The subsequent preview below uses these updated settings.

Before integrating trading, added an explicit execution-mode boundary: Points buy/sell, quotes, redeem, limit-order creation/execution, and parlay quotes reject on-chain markets with HTTP 409 before Points balances, positions, order matching or settlement are accessed. Legacy null-mode and explicit Points markets retain their behavior. This is a prerequisite for the adapter, not an implementation of wallet trading in the Points UI.

The isolated preview database's aggregate audit reports 599 distinct mapped user wallets and zero current delegation-policy rows. The runtime's `launch.ready` field checks configuration; it must not be presented as proof that users can trade. User-authorized policies, wallet gas support, the frontend adapter, and buy/sell/resolve/redeem rehearsal remain outstanding. No user allocation or reset was performed. A broader user-level export was rejected by automatic approval review; this checkpoint uses aggregate counts only.

### Deployed Preview Rehearsal — 2026-10-17

Pushed application commit `e10f66f50ab8b27990cbdc27d9c13b9bc31718a3` to `origin/onchain-sepolia`. Vercel deployment `dpl_26kQSDhyCeRo5k6CxYLDc75CNjB2` is READY at [the verified preview](https://pronos-37azy28u1-mezcalpapieth-jpgs-projects.vercel.app). Its Git source matches that exact commit and branch. The branch preview alias is [onchain-sepolia](https://pronos-git-onchain-sepolia-mezcalpapieth-jpgs-projects.vercel.app). Later documentation-only deployments can replace that branch alias; the machine-readable [verification record](./onchain-sepolia-preview-verification-2026-10-17.json) preserves the exact application deployment tested here.

Authenticated readiness returned `ok: true`, no warnings, `launch.ready: true`, and zero configuration blockers both before and after approval. The two explicit review items remain CRE webhook configuration and user gas sponsorship. The actual served admin lazy bundle contains the preview destination selector; the pending API reports `previewEnabled: true`, `defaultMode: onchain`, and chain `421614`.

The single technical test passed through the deployed pending-market admin route, using the configured Turnkey operations signer:

- Pending row `37694` became Points market `360636`, with `mode=onchain`, chain `421614`, and contract market ID `0`. It is explicitly `is_test_market=true`, unfeatured, excluded from tournament featuring, and has no automatic resolver. The question identifies it as a technical test. A read-only production query found zero rows with its unique source event ID.
- First-use [ERC20 approval](https://sepolia.arbiscan.io/tx/0xeca00606aa8cf916e75483f8d3013b41460cbe03f29eb8d5a0ad4feaf2a03e6b) and [factory creation](https://sepolia.arbiscan.io/tx/0x0f6b7c53d106bc8002303f8152ecd1ea6a4dc2bd3cb05a3d671da26fedfb903f) both have successful receipts from the operations wallet. Creation used 3,772,929 gas and cost `0.00007545858 ETH`; collateral approval cost `0.00000093358 ETH`.
- Pool `0x1aca9bC8ce8b8f2Eef41fa4F4b39Ee8a7Bb0d6E7` holds exactly **500 MXNP**, with uniform 50/50 opening prices and 500/500 share reserves. Its collateral, share token, and factory getters match the deployed stack. V1 has exactly one market; V2 has zero. Treasury balance is **49,999,500 MXNP / 0.000921453963816 Sepolia ETH**; total supply remains 50,000,000 MXNP.
- A manual preview indexer run over blocks `320069646`–`320069663` ingested one market and one liquidity event. Protocol database market ID is **`3`**, distinct from Points ID `360636` and contract ID `0`. Both factory checkpoints reached block `320069663`. All resolution/generator jobs were skipped. This proves manual preview indexing; Vercel production cron does not schedule this preview.
- The public protocol market API returns the pool, its 500-MXNP seed and `[0.5, 0.5]` prices. A live 1-MXNP buy quote returns `1.948102` shares after a `0.025 MXNP` fee; a live 1-share sell quote returns `0.487257 MXNP`. These are read-only quotes; no user trade was signed.
- Bulk on-chain approval returned HTTP 400. Points quote-buy, quote-sell, buy, sell, redeem, and limit-order creation each returned HTTP 409 with `onchain_market_requires_protocol` for this market. The execution boundary also covers parlay quotes and limit-order execution through focused tests.

Validation passed: all 122 Solidity tests, 86 focused deployment/runtime/admin JavaScript tests, 51 execution-boundary and related trading tests, both Points and MVP Vite builds, and `git diff --check`. The proof record distinguishes automated checks from the live API/receipt evidence. No user reset, user token allocation, policy consent, or gas-sponsorship activation occurred.

Pointbreak local, tracking, and remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`. All 100 Vercel environment records outside this branch, including nine Pointbreak records, remain unchanged. Production deployment `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` retains that SHA and its four aliases, including `pronos.io` and `www.pronos.io`.

### Points Frontend Adapter — Preview Deployment, 2026-10-17

Implemented on `onchain-sepolia`, based on `aab9412e06e07f6733ee3ce7513dc2240476217a`, committed and pushed as `a653827061635eb3ec3e82ae275b6a6e7905c6ae`. Vercel deployment `dpl_H5Nfb6heufUDbs9cmeXFhzG5SopA` is READY for this exact application SHA at [the immutable preview](https://pronos-hllqqwoyy-mezcalpapieth-jpgs-projects.vercel.app/points). The branch alias is [the onchain-sepolia preview](https://pronos-git-onchain-sepolia-mezcalpapieth-jpgs-projects.vercel.app/points).

- A shared execution adapter routes cards, detail, buy, sell, redeem, portfolio, charts and trade history by market mode. Points keeps its existing endpoints. Test markets use protocol quotes and transactions, with 1% minimum-output protection and six-decimal share amounts. A signing failure never retries against the Points ledger.
- A read-only `/api/points/onchain` bridge is enabled only for the opted-in `onchain-sepolia` Preview on chain `421614`, with the configured collateral and both factories. It maps the stable Points ID to the protocol database ID by chain, pool and configured factory, and checks the contract market ID separately. Missing, ambiguous or unindexed mappings stop execution. Contract ID `0` remains valid.
- The preview defaults to `Torneo de prueba` and offers a separate `Points` selector. It reads the authenticated user's token balance over RPC without changing their Points balance. Mode/account changes remount the UI; private portfolio responses are not cached. Optional charts may be empty when unavailable, but cannot substitute Points history for test-market history.
- Portfolio positions, per-outcome basis, realized PnL and history come from immutable buys, sells and redemptions. Partial exits remove proportional basis; completed redemption removes claimable shares. V1 resolution values `1/2` become Points outcome indexes `0/1`; V2 retains its zero-based indexes. Invalid accounting or missing valuation returns an explicit unavailable state.
- Test mode hides unsupported limit orders, combinadas, Points rewards, scoring/leaderboards, cycle filters and the Points welcome-bonus copy. Users retain `Comprar`, `Vender` and `Cobrar`; normal pages expose no wallet coordinates, gas, approval transactions or explorer links. Existing admin transaction/debug output remains available.

Validation: **79 focused tests passed**, including endpoint gating, session-wallet isolation, identity collisions, protocol routing, legacy Points parallel legs, fees, partial sells and redemption accounting. Both Points and MVP Vite builds passed. An isolated localhost browser fixture exercised buy → partial sell → resolve → redeem, history/detail navigation and switching back to Points. The real read handler and read model ran against injected fixture SQL/RPC data; transaction routes only changed in-memory fixtures. The request trace submitted protocol database ID `3`, never Points ID `360636` or contract ID `0`: buy 50 MXNP with `minSharesOut=96.525`, sell 58.75 shares with `minCollateralOut=27.918`, then redeem 58.75 shares. The fixture balance moved `1,250 → 1,200 → 1,228.20 → 1,286.95`; redemption left zero positions and total PnL `+26.95`. Switching to Points restored its independent 777-point fixture balance and existing tabs. This is browser/contract-interface verification with simulated data, not a real signed-wallet rehearsal or live database verification.

Live verification used the actual frontend adapter module with the project's existing development identity against that deployment. All 23 HTTP checks passed: preview config is enabled on chain `421614`; market `360636` maps to protocol database ID `3` and contract ID `0` with indexed 50/50 prices; detail, price history, empty trade tape/activity, and a separate 20-market Points list load correctly. A read-only buy quote for 50 MXNP returns 93.169134 shares with a 1.25 MXNP fee; a sell quote for 10 shares returns 4.850625 MXNP. Both requests submitted protocol ID `3`. Unauthenticated balance and portfolio reads return 401, with private/no-store headers. The published entry and buy/detail/portfolio chunks contain the adapter behavior. No signed transaction was submitted.

The live authenticated user's balance/portfolio and direct protected-preview browser interaction were not exercised. Browser interaction was verified with the isolated fixture described above; live API/adapter integration and served assets were verified separately. Automatic approval review rejected creation of a shareable Vercel access link because it expands access; no share link or protection change was made. Existing authenticated HTTP access completed the deployment checks. Detailed evidence is in `docs/onchain-sepolia-frontend-adapter-verification-2026-10-17.json`.

Pointbreak local, tracking, and remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`. Production remains on READY deployment `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` with that SHA and the same four aliases. This release changed no Vercel settings.

Remaining work before activation:

1. Verify a consenting test user's own live RPC balance and indexed portfolio through the preview session.
2. Obtain that test user's explicit delegation consent, fund only the authorized test wallet, and verify gas handling. Perform a real buy/sell/resolve/redeem rehearsal with receipt and indexer readback. The earlier aggregate audit found zero current delegation policies; implementing the adapter does not grant them.
3. Arrange preview indexing during that rehearsal. Production cron does not run this preview; until a preview scheduler is configured, manual indexing must advance the portfolio after confirmed transactions.
4. Fix cancellation-refund indexing before testing refunds: its current zero-share redemption rows lack per-outcome burn attribution. The new read model deliberately reports those accounts unavailable instead of retaining stale claimable holdings. Historical binary resolution corrections also need outcome-at-redemption evidence before that workflow can be supported reliably.
5. Implement tournament reset/funding dry runs, issuance limits, cycle registration, scoring and reward behavior. The test selector is a rehearsal surface, not tournament-launch readiness.

No user funds, policies, live Points data, Vercel settings or Pointbreak files/refs were changed by this release. Only this branch's preview alias advanced.

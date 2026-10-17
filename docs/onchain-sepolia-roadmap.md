# Onchain Sepolia Tournament Roadmap

Branch: `onchain-sepolia`

Status: contracts, preview runtime, Points execution guards, frontend adapter, persistent owner delegation, automatic indexing and sell-fee presentation are deployed to the isolated preview. Stable router authorization is verified: one consent before pool creation covered real buy/sell/resolve/redeem rehearsals on subsequent binary and three-outcome markets. Existing MXNP is reused; Pointbreak and Pronos production are unchanged. Normal-user gas support, tournament reset/funding limits, registration/scoring/rewards and remaining lifecycle rehearsals remain. This branch must stay hidden behind flags until the next tournament reset.

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

- Include exact collateral/share approval calls and guarded trading calls for approved pools. User trading grants must not allow factory administration.
- Include selectors:
  - ERC20 `approve(address,uint256)`
  - ERC1155 `setApprovalForAll(address,bool)`
  - binary buy/sell
  - multi buy/sell
  - redeem
- Persistent owner-approved grants remain active until revoked; user login sessions have independent expiry.
- Require each account's owner consent before first on-chain trading. Never install the backend as a root user or silently grant all accounts trading authority.
- Keep parent OTP authentication credentials separate from the delegated signing credential; registering the login key in a user sub-org changes Turnkey's credential matching and can break returning login.
- Historical pool grants continue covering their earlier pools. Users explicitly migrate once to the fixed router grant; subsequent pools of its two immutable factories need no scope extension. Replacing the router or factories requires new consent.
- The fixed Sepolia router verifies each pool against its immutable factory registries. Deployment, one-time owner migration, subsequent V1/V2 trading and automatic indexing are verified in the stable authorization checkpoint below. Independent contract review remains separate.
- Do not expose per-trade approvals in UI copy.

Launch blocker:

- A user who has never sold before must still be able to sell from the normal sell button.

### 3. Tournament Reset

Tasks:

- Create a reset command/job for an on-chain tournament cycle.
- Snapshot current off-chain tournament state before reset.
- Create or verify Turnkey wallets for eligible users.
- Check each eligible user's owner-approved delegation; request consent where absent. The reset job cannot grant itself signing authority.
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
- Add an enforced delegated daily notional limit before claiming one. The current scoped preview grant has no daily spending cap.
- Alert on:
  - unexpected token transfers into tournament wallets
  - failed trade bursts
  - wallets with external funding
  - revoked/missing policies and markets outside an account's approved scope
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
9. Done (2026-10-17): connect and deploy the Points frontend adapter, preserving separate Points/protocol IDs and ledger reads; verify a consenting user's real buy/sell/resolve/redeem rehearsal.
10. Done (2026-10-17): implement owner-approved, persistent, non-root preview delegation with verified revocation and separate login/signing credentials. See the persistent delegation checkpoint below.
11. Done (2026-10-17): configure automatic preview indexing and deploy/verify corrected sell-quote fee presentation.
12. Done (2026-10-17): deploy compatible factories/share tokens and the stable router using existing MXNP; verify one owner grant covers future binary and three-outcome markets through buy/sell/resolve/redeem and automatic indexing.
13. Remaining: establish gas support for normal users and run the tournament reset/funding dry run before allocations. Issuance limits, registration, scoring, reward issuance and cancellation/correction accounting remain launch work.

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

Remaining work at the frontend-adapter deployment checkpoint (superseded by the wallet rehearsal below):

1. Verify a consenting test user's own live RPC balance and indexed portfolio through the preview session.
2. Obtain that test user's explicit delegation consent, fund only the authorized test wallet, and verify gas handling. Perform a real buy/sell/resolve/redeem rehearsal with receipt and indexer readback. The earlier aggregate audit found zero current delegation policies; implementing the adapter does not grant them.
3. Arrange preview indexing during that rehearsal. Production cron does not run this preview; until a preview scheduler is configured, manual indexing must advance the portfolio after confirmed transactions.
4. Fix cancellation-refund indexing before testing refunds: its current zero-share redemption rows lack per-outcome burn attribution. The new read model deliberately reports those accounts unavailable instead of retaining stale claimable holdings. Historical binary resolution corrections also need outcome-at-redemption evidence before that workflow can be supported reliably.
5. Implement tournament reset/funding dry runs, issuance limits, cycle registration, scoring and reward behavior. The test selector is a rehearsal surface, not tournament-launch readiness.

No user funds, policies, live Points data, Vercel settings or Pointbreak files/refs were changed by this release. Only this branch's preview alias advanced.

### Consenting Wallet and Real Trade Rehearsal — 2026-10-17

Created the dedicated **`pronos`** account through normal email OTP verification and username claim. Its wallet is `0xe1081Be279c5C23D2F37133218d1295C6b9bb37b`. The verified owner session authorized a non-root backend signer for one technical test pool on Arbitrum Sepolia. The human root quorum remains unchanged. The policy permits exact pool approvals and guarded buy/sell/redeem calls, with zero native value, gas/fee limits, and an enforced expiry of **2026-10-18 14:06:58 UTC**. Actual signing probes rejected native transfers, ERC20 transfers, an unapproved spender and another chain. The backend credential itself does not expire; the policy's time expression ends its trading permission.

Transferred **500 MXNP and 0.0005 Sepolia ETH** from the existing operations wallet, without minting. On the deployed `94db969` preview, the actual authenticated user and delegated signer completed:

- Buy: **50 MXNP → 93.169134 Yes shares**, with a 1% minimum-share guard.
- Partial sell: **30 shares → 15.727122 MXNP**, with a 1% minimum-collateral guard.
- Resolve the technical test to Yes using the existing operations resolver and the locally corrected dispatcher.
- Redeem: **63.169134 remaining shares → 63.169134 MXNP** through the deployed preview API.

Receipt, RPC, isolated database and authenticated adapter checks agree: the wallet ends with **528.896256 MXNP**, **0.000490227263776 ETH**, zero Yes/No shares, zero portfolio positions and realized test PnL of **+28.896256 MXNP**. Its separate Points balance remains **500**, with zero Points trades. The protocol ledger contains exactly two trades and one redemption. Total MXNP supply remains **50 million**; operations retain **49,999,000 MXNP / 0.000418746397616 ETH**. This is a technical test payout from seeded test liquidity.

The rehearsal exposed and locally fixed three blockers: V1 resolution now translates app indexes `0/1` to contract outcomes `1/2`; both admin resolution paths accept chain market ID `0`; and the indexer keeps watching resolved pools so it can record later redemptions. Replaying the existing redemption receipt after the indexer fix inserted one event and removed the stale claimable position. Manual indexing used only the isolated preview database; background resolver/generator jobs stayed disabled. **44 focused tests and `git diff --check` passed.** These fixes remain **uncommitted, unpushed and undeployed**. The deployed admin resolution and deployed indexer paths therefore still need verification after the next preview release. No live browser click-through was performed; real authenticated API execution and adapter reads were verified.

The [rehearsal proof](./onchain-sepolia-wallet-rehearsal-2026-10-17.json) records funding, approvals, all transaction receipts, permission rejections, indexer ranges, live read checkpoints and final ledger reconciliation. Temporary owner/session and database credentials were removed after verification. Pointbreak local/tracking/remote remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`; production retains READY deployment `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` and its aliases. All 100 Vercel environment records outside this branch are unchanged.

Remaining work before activation:

1. Commit/push these reviewed fixes, deploy an exact-SHA `onchain-sepolia` preview, and verify the deployed resolution and indexer behavior.
2. Implement the normal owner-authorized non-root delegation flow. This account used its real owner session for a scoped operational setup; the existing application delegation flow is not ready for arbitrary fresh accounts. The generic status endpoint still reports a default 200,000 daily cap despite this policy having no enforced daily spending cap. Correct the status and consent claims before broader use.
3. Fix sell-quote fee presentation: the live quote reported zero fee while the receipt reported **0.441719 MXNP**. The quoted net collateral and output guard were correct.
4. Arrange automatic preview indexing; production cron does not schedule this preview. Scanning closed pools is necessary for redemptions, but indexing cost must be monitored as historical pool count grows.
5. Complete cancellation-refund burn attribution, resolution-correction evidence, tournament reset/funding dry runs, issuance limits, registration, scoring and rewards before activation.

### Persistent Owner Delegation and Deployed Settlement — 2026-10-17

Supersedes the uncommitted/deployment-pending and generic-delegation limitations at the preceding checkpoint. Resolution/indexer fixes were committed and pushed in `0e734ae`; the normal owner delegation flow shipped in `c576fa5`; separate login/signing credentials shipped in `885f3cd`. The actual execution rehearsal below ran on READY preview `dpl_D6vix1d9XBHZbnpA4xAz3MroTX1J`, source `885f3cddbe353fa24c57d9611940748a1d172415`.

Each account explicitly approves its first trading grant through its own OTP-bound owner credential. The browser registers a **non-root** trading signer, installs an exact scoped policy with **no time expression**, removes superseded grants, and asks the server to verify the actual Turnkey state before recording consent. The policy and backend credential have no expiry; login sessions retain their independent expiry. Closing/canceling consent cannot submit a trade. The Points account menu exposes authorization management and real revocation. If the owner login has expired, changing the grant requires email verification; ordinary trades under an active grant do not.

The grant covers authorized Sepolia pools, exact collateral/operator approvals, guarded buy/sell and redemption, the user's own address, zero native value, and bounded gas/fees. It permits no withdrawals, token transfers or account administration. **No daily spending cap is enforced or advertised.** An existing grant stays usable for its approved pools when new markets are added; trading an additional pool requires an explicit scope extension. A stable, audited router/registry is the next design needed to remove those extensions as market count grows. Do not silently grant policies to all existing accounts.

Live verification found that registering the parent login key as a user's trading credential caused later Turnkey logins to evaluate the trading-only policy. A separate **non-root parent authentication user**, with only AUTH/OTP and suborganization-creation policy permissions, now handles preview login and parent reads. Its key is never installed in user suborganizations. Signing still uses the existing trading/operations credential. The new login key cannot sign wallet transactions. Only `onchain-sepolia` preview variables `TURNKEY_AUTH_API_PUBLIC_KEY` and `TURNKEY_AUTH_API_PRIVATE_KEY` were added; production/inherited credentials were not changed.

Using `pronos`, verified the real frontend delegation client against the deployed endpoints: authorize → revoke → rejected trading signature → remove the inactive non-root test signer → normal creation of a fresh non-root signer → authorize again. The human root quorum stayed unchanged throughout. A fresh returning OTP login then succeeded and the same persistent policy remained active. Native/token transfers, an unapproved spender and another chain were rejected by actual Turnkey signing probes; none were broadcast. These workflow checks used the real owner key with SDK server transport. They do not claim a browser IndexedDB click-through: the in-app browser blocked the temporary read-only localhost proxy, and Vercel protection was preserved.

Approved one new **100-MXNP-seeded technical test market**, pending `37695`, Points `360637`, protocol database `4`, contract ID `1`, pool `0xCB3149d9B41870F092162ab15a676a39d5058C17`. The actual frontend execution adapter and deployed APIs completed:

- Buy **5 MXNP → 9.52339 Yes shares**, fee `0.125 MXNP`, with a 1% minimum-share guard.
- Sell **1 share → 0.508851 MXNP**, receipt fee `0.013684 MXNP`, with a 1% minimum-output guard.
- Resolve to Yes through the **deployed admin endpoint**: app outcome `0` correctly becomes V1 contract outcome `1`.
- Index resolution through the **deployed preview indexer**, read back resolved/claimable holdings, then redeem **8.52339 shares → 8.52339 MXNP**.
- Index the later redemption while the pool is already resolved. Replaying the same narrow range inserts **zero** new redemptions; the ledger has exactly two trades and one redemption for this market.

Final RPC, receipt, isolated database and adapter reads agree: `pronos` holds **532.928497 MXNP / 0.000480877478672 Sepolia ETH**, with zero remaining shares/positions and cumulative realized test PnL **32.928497 MXNP** across both rehearsals. Its separate **500 Points and zero Points trades** are unchanged. Operations hold **49,998,900 MXNP / 0.000341966182954 ETH**; supply remains **50 million**. No new mint or additional user funding was needed. All checks used Arbitrum Sepolia `421614` and the isolated preview database.

The catalog read filter now uses indexed protocol status/outcome for matching preview chain, factory, pool and contract IDs, so settled markets can leave the active list and appear in resolved results without writing settlement into the Points ledger. Unindexed mappings retain their existing unavailable/pending behavior. The owner credential lookup uses the installed Turnkey browser SDK's session manager, separately from the IndexedDB signing client. Regression tests exercise the actual SDK with matching, wrong-account, rotated-key and expired sessions. **64 focused tests, both frontend builds, and diff checks passed.** Readiness returned `ok: true`, no warnings and zero blockers; its explicit reviews still include CRE review mode and absent gas sponsorship.

The [public verification proof](./onchain-sepolia-persistent-delegation-2026-10-17.json) records owner-flow checks, permission denials, returning login, transaction receipts, manual indexer ranges/replay, final portfolio, ledger and branch boundaries. Manual indexer authentication was rotated only for this preview. Pointbreak local/tracking/remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`; production remains READY `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` with unchanged aliases. All **100** environment records outside `onchain-sepolia` remain unchanged.

Next roadmap work: configure automatic preview indexing; correct sell-quote fee presentation (net collateral is correct, displayed fee is zero); define a stable trading scope for future pools; provide normal-user gas funding/sponsorship; run isolated tournament reset/funding dry runs with issuance limits; implement registration/scoring/rewards; and rehearse V2, cancellation/refunds and resolution corrections before activation.

### Automatic Preview Indexing — Verified, 2026-10-17

Automatic indexing is running every minute for `onchain-sepolia`. Vercel Cron targets production deployments, so a separate scheduler project, `pronos-onchain-sepolia-indexer` (`prj_2bv4NAl9EBvRdkOVw1RpAIzbDJNA`), indexes only the isolated Sepolia database and the two configured Sepolia factories. Its production deployment is not the Pronos production application. Both the scheduler (`dpl_2Cb8HSwGG9XkrHouHMn7U4rsKBds`) and application preview (`dpl_FAx5oMx5247Bbbx3z1RbktRm37o3`) are READY at runtime source `e9e4f8a76262495ee1ed2d33822be7d7f235a07c`.

The shared protocol event reader was extracted without enabling the main application's Points/generator/resolver multiplex in the worker. The dedicated `sepolia_indexer` database login can read/insert/update protocol and indexer records, but cannot access Points users/balances/trades, delete protocol rows, alter the schema or administer roles. The worker has no wallet-signing credentials. Before writes it validates project identity, embedded source branch, the actual RPC chain `421614`, exact factories and the isolated database endpoint/role. A dedicated cron secret protects the route; request query parameters cannot override its scan. A 330-second database lease prevents overlapping 300-second invocations. Each run persists its trigger, source SHA, block ranges, counts and timing in `preview_indexer_runs`.

Nine consecutive real cron runs succeeded from **15:37–15:45 UTC**, first catching up both factory checkpoints and then ingesting fresh events. No manual `/api/indexer` or authenticated `/api/tick` trigger was used. Approved one 100-MXNP technical market: pending `37696`, Points `360638`, protocol database `5`, contract ID `2`, pool `0x80aa1a6722eb6f72647c0964b64d185c01a39433`. The normal owner-approved delegation flow extended the test user's persistent scope to the new pool while preserving the human root quorum.

- The 15:39 cron indexed market creation and its 100-MXNP seed liquidity.
- Buy **5 MXNP → 9.52339 Yes shares** was indexed at 15:40; sell **1 share → 0.508851 MXNP** was indexed at 15:41.
- The deployed admin endpoint resolved to Yes; the 15:42 cron indexed contract outcome `1`, and the adapter showed app outcome `0` with **8.52339 claimable shares**.
- Only after observing that indexed resolution, redeemed **8.52339 shares → 8.52339 MXNP**. The 15:44 cron picked up that later event from the already resolved pool.
- The 15:45 idle scan inserted no new events. Immutable counts remain **two trades and one redemption**, and the adapter shows zero remaining positions.

The operations wallet needed a gas preflight top-up: transferred **0.000658033817046 Sepolia ETH** from the configured local testnet deployer to bring operations to `0.001 ETH` before creation. No token mint or additional user funding was required. Final chain reads show `pronos` at **536.960738 MXNP / 0.000471538780598 ETH**, operations at **49,998,800 MXNP / 0.000923965173936 ETH**, zero remaining test shares, and total supply still **50 million MXNP**. The separate user ledger remains **500 Points and zero Points trades**. Legacy factory checkpoints are unchanged.

Validation: **25 focused tests passed**, worker build/deployment succeeded, receipt blocks match the persisted cron ranges, and deployed adapter/catalog/balance/portfolio/served-asset checks passed. Readiness returned `ok: true`, no warnings and zero blockers; CRE review mode and missing user gas sponsorship remain explicit reviews. This verifies live API/adapter flows with real owner authorization and transactions, not browser click-through. The [public proof](./onchain-sepolia-automatic-indexing-2026-10-17.json) records each receipt, scheduled run and final ledger check. Pointbreak local/tracking/remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`; Pronos production remains `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` with unchanged aliases and all 100 environment records outside `onchain-sepolia` unchanged.

Operational instructions are in [`ops/onchain-sepolia-indexer/README.md`](../ops/onchain-sepolia-indexer/README.md). App and scheduler deployments are independent: redeploy the scheduler when its shared event reader changes, and remove its cron or pause the dedicated project when retiring this preview. This worker indexes resolution events; it does not choose or submit outcomes. V2 trading, cancellation/refund and resolution-correction rehearsals remain outstanding.

Next roadmap work: correct sell-quote fee presentation; define a stable trading scope for future pools; provide normal-user gas funding/sponsorship; run isolated tournament reset/funding dry runs with issuance limits; implement registration/scoring/rewards; and complete the remaining lifecycle rehearsals before activation.

### Sell Quote Fee Presentation — Deployed and Verified, 2026-10-17

Binary sell quotes now separate gross collateral, the contract's actual dynamic fee, and net collateral. Gross uses the same integer quadratic/ceiling-square-root rounding as `PronosAMM`; the fee is read with the opposite buy side, including its minimum-unit fee. All sell quote reads use one block, and an inconsistent net estimate fails rather than returning a fabricated fee. Multi-outcome pools retain their existing zero sell fee. No contract changes are required.

The on-chain Points sell confirmation now shows gross and commission (amount and effective percentage), preserves the six-decimal net payout, and explains that the fee is already deducted. PnL and the existing 1% minimum-output guard continue to use net collateral once. Points-mode payouts and confirmation remain unchanged.

Read-only historical RPC verification reproduced the real sell at block `320119066`: **0.522535 MXNP gross − 0.013684 MXNP fee = 0.508851 MXNP net** (effective fee `2.6187719483%`), with the same `0.503762` minimum output. Fourteen additional quotes across both sides and 0.000003–50 million shares agreed with the deployed contract's estimates and exact fee reads, including rounding/minimum-fee cases. No transaction was submitted. Evidence: [`onchain-sepolia-sell-quote-2026-10-17.json`](./onchain-sepolia-sell-quote-2026-10-17.json).

Validation: **43 focused tests passed**, including actual modal rendering, both binary directions, multi-outcome zero fees, same-block reads, error propagation, net-based PnL/slippage and execution-adapter isolation. Both Points and MVP builds passed. The broader portfolio source-assertion suite passed 13 checks and failed two existing checks (`portfolio separates open PnL from total account PnL` and `portfolio PnL and history can switch between current and previous cycles`); the same two failures reproduced from untouched HEAD files in an isolated baseline. These stale assertions do not account for the already-shipped on-chain portfolio conditionals. Generated build output was restored.

Committed and pushed the fee fix in `c9f755d21946644cfb8a966b9eec85b3f421295b`. Its exact-source preview, `dpl_GTXyqtpMygAwsPcK8peg7EH18n5Q`, is READY. Both its unique deployment URL and the `onchain-sepolia` branch alias serve the corrected lazy sell-confirmation chunk and the corrected API response. These checks verify real deployed API execution and served JavaScript, not browser click-through.

All previous current-factory test pools were settled. Created one clearly labeled technical V1 pool, contract ID `3`, protocol database ID `6`, pool `0x299d5788CD5fc0F10c00fb1D6832C0923A83ffDD`, using **100 existing test MXNP** from operations. Creation transaction `0x62463bedfa071ad194fbeff5d627df3f91ab7302d7c1dfbfdb762dbe3c5ecd80` succeeded at block `320126692`; the automatic indexer discovered it without a manual trigger. Six deployed quotes (both outcomes, 0.000003/1/10 shares) matched exact RPC amounts. A one-share sell reports **0.498750 gross − 0.012468 fee = 0.486282 MXNP net**, with minimum output **0.481419 MXNP**. Invalid outcomes and closed markets remain rejected. No user trade or delegation was submitted. The pool remains available for technical quotes until its configured close; it is not a tournament market.

Operations now hold **49,998,700 MXNP / 0.000848293373936 Sepolia ETH**; total supply remains **50 million MXNP**. No mint, user funding, Vercel setting or scheduler change was needed. Pointbreak local/tracking/remote refs remain `47aa9e19115d64bc36a2684e5eeb685caef117ba`; Pronos production remains READY `dpl_C4bVYurgBRwVYqZAJJChri7uQpzz` with unchanged aliases, and all **100** environment records outside `onchain-sepolia` are unchanged. The proof above includes the live release verification and boundary checks. This documentation checkpoint follows the verified runtime commit.

Next: stable trading scope, normal-user gas support, isolated tournament reset/funding dry runs, registration/scoring/rewards and remaining lifecycle rehearsals before activation.

### Stable Future-Market Authorization — Deployed and Verified, 2026-10-17

Added a fixed Sepolia trading router and compatible factory/pool entry points. One owner-approved, persistent grant can now cover future binary and multi-outcome pools from the same immutable factories without a new policy or per-pool token approval. The router validates factory registration on chain, retains guarded execution, pays the owner directly and preserves user-attributed events/cost basis. Backend verification pins its runtime code and all bindings; frontend coverage and readiness use the verified scope. Explicit historical factory/share-token configuration retains exact permissions and indexing for existing pools.

Implementation `1fe6cb1` and deployed configuration `0c9e272` are pushed to `onchain-sepolia`. New compatible V1/V2 factories/share tokens and router `0x25bc3c0f0c41516167f096ac4bf785f60bbbe843` are live using the **existing MXNP**, with no mint. Creation/runtime bytecode, immutable bindings, operations permissions and ownership were verified. The old factories and tokens remain configured for historical markets. Application `dpl_BKSvNUTdsCW1usv1eFR5xB492ZzT` and dedicated worker `dpl_Gm2KenMHSnwPxMRTpHGwsJckNcG7` are READY at exact runtime SHA `0c9e27210b451e29b484fe795c6fc8da26e5993f`.

The real `pronos` owner approved once at **17:01:46 UTC**, while both new factory market counts were zero. Policy `307adccf-2e00-449e-9ec7-4c6cc7fb5437` and its scope hash stayed unchanged after creating and trading two future pools. Both completed guarded 5-MXNP buy, one-share sell, outcome-0 resolution and full winning-share redemption through the actual frontend adapter and deployed APIs. All six receipts target the router from the user's wallet; no additional owner authorization was needed. One collateral allowance serves both pools. Each share token received one operator approval. Actual trading gas ranges **126,180–273,571**, below the existing 600,000 limit.

The technical fixtures went pending first (37697/37698), then used the operations deployment helper and explicit hidden preview catalog approval through Neon after automatic protocol indexing; this does not claim an admin UI/auto-deploy test. Points IDs are **360639/360640**, protocol database IDs **7/8**, and each factory's contract ID is **0**. Nine real minute-cron runs ingested two creations, four trades, two resolutions and two redemptions without a manual trigger. Current and legacy factory checkpoints cover the final receipt. The served frontend entry and lazy buy module match on the unique preview and branch alias.

Final wallet is **549.381753 MXNP / 0.000445142809610 ETH**, with no shares or open positions. Its balance reconciles exactly from 536.960738 MXNP using the six receipts. Operations hold **49,998,500 MXNP / 0.000666266156742 ETH**; supply remains **50 million** and the router holds no collateral/shares. The separate ledger remains **500 Points / zero Points trades**. Eight actual no-broadcast Turnkey probes rejected native value, another chain, excessive gas/fees, unapproved targets, transfers, arbitrary approval spenders and factory administration; a positive signing control passed. The backend is non-root and the human root quorum is unchanged.

Pointbreak local/tracking/remote refs and Pronos production deployment are unchanged; all **100** environment records outside this preview branch are identical. The [deployment manifest](./onchain-sepolia-router-deployment-2026-10-17.json), [live verification proof](./onchain-sepolia-stable-authorization-verification-2026-10-17.json) and [implementation guide](./onchain-sepolia-stable-authorization-2026-10-17.md) record the evidence. Verification used real owner credentials with SDK server transport, authenticated APIs and receipts; no browser click-through or current admin-readiness endpoint check is claimed. A fresh router-specific revoke/relogin cycle remains separate from this future-market proof.

Validation: **135 contract tests, 110 focused JavaScript tests, both frontend builds, the dedicated indexer bundle and diff checks passed.** This includes cold-storage eight-outcome gas checks, unchanged scope after future pool creation, real dispatcher approval reuse, explicit owner migration and invalid-router readiness blockers.

Next: normal-user gas funding/sponsorship, isolated tournament reset/funding dry runs with issuance limits, registration/scoring/rewards, and cancellation/refund and resolution-correction rehearsals. Users must still approve their initial grant; no accounts were silently authorized.

# PRONOS MVP — ROADMAP
### Target: Mainnet Live before FIFA World Cup (June 14, 2026)
### Budget saved: $30,000

> Legend: ~~Crossed out~~ = Done | **Bold** = In Progress | Normal = Pending

---

## PHASE 1: FOUNDATION & CORE CONTRACTS
**Target: April 14, 2026**

### 1.1 Architecture & Setup
- [x] ~~Define final architecture: hybrid (Polymarket aggregator + own protocol with admin switch)~~
- [x] ~~Decided: hybrid — start with Polymarket, admin switch to enable own contracts when ready~~
- [x] ~~Set up Foundry project structure + OpenZeppelin v5.6.1 + Solidity 0.8.24~~
- [ ] Configure CI/CD for contract compilation + tests

### 1.2 Core Smart Contracts
- [x] ~~`MarketFactory.sol` — Factory to create binary markets, manage lifecycle, fee distribution~~
- [x] ~~`PronosToken.sol` — ERC-1155 outcome tokens (YES/NO shares per market)~~
- [x] ~~`PronosAMM.sol` — CPMM (x*y=k) with dynamic fees: fee% = 5*(1-P)~~
- [x] ~~Dynamic fee formula: 2.5% at 50/50, 0.5% at 90/10, 0.05% at 99/1~~
- [x] ~~Fees deducted upfront, sent to separate feeCollector wallet (never enter pool)~~
- [x] ~~Fee distribution: 70% treasury, 20% liquidity, 10% emergency reserve~~
- [x] ~~Resolution via factory (multisig-compatible), pause/unpause markets~~

### 1.3 Contract Testing
- [x] ~~Unit tests for Factory (create market, validate params, multiple markets)~~
- [x] ~~Unit tests for AMM (buy/sell, price movement, slippage, estimates)~~
- [x] ~~Unit tests for ERC-1155 (token IDs, minter auth, ownership)~~
- [x] ~~Unit tests for dynamic fees (collector receives fees, fees decrease with probability)~~
- [x] ~~Unit tests for resolution + redemption (YES wins, NO wins, losers can't redeem)~~
- [x] ~~Integration test: full cycle (create → fund → trade → resolve → redeem)~~
- [x] ~~43 tests passing, >75% coverage (Token:100%, Factory:87%, AMM:82%)~~

### 1.4 Deployment (Testnet)
- [x] ~~Reproducible deploy script (`DeployProtocol.s.sol`)~~
- [ ] Deploy all contracts to Base Sepolia
- [ ] Create 1 test market via Factory
- [ ] Verify AMM receives liquidity and calculates prices correctly
- [ ] Document deployed addresses in `deployments.json`

### 1.5 Safe Multisig
- [x] ~~Setup guide created (`scripts/setup-safe.md`) with step-by-step instructions~~
- [x] ~~Safe SDK integrated in admin panel (`lib/safe.js` — protocol-kit + api-kit)~~
- [x] ~~Admin UI: create Safe, connect existing, propose/sign/execute transactions~~
- [x] ~~Supports Base Sepolia + Base Mainnet (chain selector in UI)~~
- [ ] Create Safe multisig on Base Sepolia (3/5 admin, 2/3 resolution)
- [ ] Transfer contract ownership to Safe
- [ ] Test resolution flow through multisig

---

## PHASE 2: FEATURES & UI
**Target: May 5, 2026**

### 2.1 Frontend — Connect to Own Contracts
- [x] ~~Create protocol switch library (`lib/protocol.js`) — toggle Polymarket vs own protocol~~
- [ ] Create contract interaction library (`lib/contracts.js`) for own AMM
- [ ] Dual-mode: support both Polymarket markets AND own protocol markets
- [ ] Market detail page — detect source (Polymarket vs own) and render accordingly
- [ ] Buy/sell panel — route to own AMM for protocol markets
- [ ] Show real-time price from AMM pool (x·y=k calculation)
- [ ] Slippage preview + simulation before trade
- [ ] Portfolio — merge positions from both Polymarket and own protocol

### 2.2 Market Management (Admin)
- [x] ~~Admin panel web UI (`/mvp/admin`) — restricted to usernames Mezcal & frmm~~
- [x] ~~Protocol switch toggle (Polymarket vs own contracts) in admin panel~~
- [x] ~~Create market form (question, category, end date, resolution source, seed liquidity)~~
- [x] ~~Markets list with pause/resolve actions (wired for own protocol mode)~~
- [x] ~~Fee formula display + distribution breakdown (70/20/10)~~
- [x] ~~Contract deployment status panel (shows deployed addresses)~~
- [x] ~~Non-admins see 404 page — admin route is undiscoverable~~
- [ ] Wire create market form to MarketFactory contract
- [ ] Wire pause/resolve buttons to contract calls via Safe
- [ ] Load 5-10 curated LATAM markets (Liga MX, elections, inflation, World Cup)

### 2.3 Wallet & Onboarding
- [ ] Gasless transactions on Base (Privy paymaster or Biconomy)
- [ ] Onboarding flow < 3 minutes (email → wallet → first trade)
- [ ] USDC balance display + deposit flow on Base
- [ ] Network switching (Polygon for Polymarket, Base for own markets)

### 2.4 Backend & Indexing
- [ ] Index on-chain events (MarketCreated, SharesBought, SharesSold, MarketResolved)
- [ ] Cache market state (prices, volume, liquidity) in Neon PostgreSQL
- [ ] API endpoint: `/api/markets` — list all own protocol markets
- [ ] API endpoint: `/api/market/:id` — market detail + price history
- [ ] API endpoint: `/api/positions/:address` — user positions on own protocol

### 2.5 Monitoring & Quality
- [ ] Sentry integration (frontend errors)
- [ ] API error logging
- [ ] Bitso stub endpoint (mock MXN↔USDC for future integration)

### 2.6 E2E Testing (Testnet)
- [ ] Full flow: register → buy shares → sell shares → resolution → redemption
- [ ] Embedded wallet transactions work without errors
- [ ] Prices and slippage calculate correctly
- [ ] Admin can resolve a market manually via multisig

---

## PHASE 3: HARDENING & MAINNET
**Target: May 31, 2026**

### 3.1 Mainnet Deployment
- [ ] Deploy all contracts to Base mainnet
- [ ] Transfer ownership to production Safe multisig
- [ ] Verify all contracts on BaseScan
- [ ] Frontend points to mainnet contracts
- [ ] Seed liquidity for 5-10 launch markets (USDC)

### 3.2 Security Hardening
- [ ] Manual security review of all contracts (reentrancy, overflow, access control)
- [ ] Fuzz testing on AMM edge cases
- [ ] Emergency pause mechanism tested
- [ ] Rate limiting on API routes
- [ ] Input validation on all user-facing endpoints

### 3.3 Operations
- [ ] Fee system operational (2% collected, distributed 70/20/10)
- [ ] Multisig resolution tested on mainnet
- [ ] Automatic redemption for winning positions
- [ ] Market lifecycle: create → fund → trade → resolve → redeem — works end-to-end
- [ ] 48h stability test (no manual intervention needed)

### 3.4 Documentation
- [ ] Technical architecture document
- [ ] Smart contract API reference (function by function)
- [ ] Deployment runbook (step-by-step testnet + mainnet)
- [ ] Operations manual (create markets, resolve, monitor)
- [ ] Incident response playbook (pause, diagnose, resume)
- [ ] Environment variables documentation
- [ ] UMA preparation (interfaces + comments in code, no integration)

### 3.5 Launch Prep
- [ ] 5-10 curated markets live and tradeable
- [ ] World Cup 2026 markets ready (Mexico, Argentina, Brazil, Colombia)
- [ ] Landing page (pronos.io) updated to point to live product
- [ ] Mobile responsiveness final check

---

## POST-MVP (After World Cup Launch)
> Not in scope now, but planned for later

- [ ] Bitso real integration (MXN on/off ramp) — est. $10-15K if outsourced
- [ ] UMA oracle integration (decentralized resolution) — est. $15-20K
- [ ] Security audit by external firm — est. $25-50K
- [ ] Push notifications
- [ ] User-created markets
- [ ] Market making bot / algorithmic liquidity
- [ ] iOS/Android native apps

---

## PROGRESS LOG

| Date | What we did |
|------|-------------|
| 2026-03-29 | Analyzed codebase vs $30K proposal. Created roadmap. |
| 2026-03-29 | Built core contracts: PronosToken (ERC-1155), PronosAMM (CPMM + dynamic fees), MarketFactory. 43 tests passing. Deploy script ready. |
| 2026-03-30 | Admin panel at /mvp/admin — protocol switch, market CRUD, fee display. Access restricted to Mezcal & frmm usernames. Safe multisig setup guide. |
| 2026-03-31 | Fixed Vercel deploy (submodule broke site). Dynamic fee display in bet slip. Safe SDK integration in admin panel (create/connect/propose/sign/execute). Fixed admin auth race condition. |

---

*Last updated: 2026-03-31*

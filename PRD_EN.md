# PRONOS

## Web3 Prediction Markets Platform

**Product Requirements Document (PRD)**
Version 2.0 — April 2026
Confidential

---

> **About this document**
>
> This PRD describes the full vision for PRONOS, what has been built internally, and what we need from an external development team to reach mainnet. Sections clearly label what already exists (✅ BUILT) vs. what is needed (🔨 TO BUILD).

---

## 01  Overview and Scope

### Project Name

**PRONOS** — The first on-chain prediction market focused on Latin America.

### Vision

Build the most accessible prediction platform for the Latin American market, where anyone can bet on sports, politics, and culture — with no crypto knowledge, complex wallets, or currency conversions required.

### Launch Target

**Mainnet live before the FIFA World Cup 2026 (June 14, 2026).**
Allocated budget: $30,000 USD.

### Current Product URL

**https://pronos.io/mvp/** — password-protected (staging environment).

---

### Blockchain Network: Arbitrum (Ethereum Layer 2)

The selected deployment network is **Arbitrum**, an Ethereum Layer 2 optimistic rollup.

| Criteria | Details |
|----------|---------|
| **Gas** | ~$0.01 USD per transaction — viable for micro-bets |
| **Speed** | ~250ms confirmation |
| **Compatibility** | Full EVM — OpenZeppelin contracts deploy without rewriting |
| **Ecosystem** | Native USDC (Circle), full Privy support, Safe multisig available |
| **Liquidity** | Second largest L2 by TVL (~$20B+), deep USDC availability |

**Note:** The original draft proposed Base (Coinbase L2) due to MXNB (Bitso) availability. We migrated to Arbitrum for a more mature ecosystem, better tooling support (Safe SDK, Privy), and native USDC as collateral.

### Collateral Asset

| Parameter | Specification |
|-----------|---------------|
| **Primary asset** | USDC — Circle stablecoin, natively deployed on Arbitrum |
| **Multi-asset support** | Not required in v1. Architecture allows adding assets (MXNB, DAI) without redeployment |

### On-ramps (Fund Deposits)

Multiple deposit methods are planned so users can fund their accounts:

| Method | Payment Type | Status | Priority |
|--------|-------------|--------|----------|
| **MoonPay** | Apple Pay, Google Pay, credit/debit card | 🔨 To integrate | High — MVP |
| **SPEI** | Mexican bank transfer (via Bitso or similar) | 🔨 To integrate | High — MVP |
| **Native Bridge** | Arbitrum Bridge (for crypto-native users) | ✅ Link implemented | Medium |
| **Bitso direct** | Buy USDC on Bitso → send to wallet | 🔨 Evaluating | Post-MVP |

**Target flow for non-crypto users:**
Open app → login with email → deposit via card/Apple Pay/SPEI → place bet. Target time: < 3 minutes.

MoonPay handles all KYC (identity verification with national ID/passport), payment processing, and USDC delivery directly to the user's wallet on Arbitrum. The user never needs to understand blockchain.

---

## 02  Smart Contract Architecture

### ✅ BUILT — Contract System

Custom contracts built from scratch using **Solidity 0.8.24**, **Foundry**, and **OpenZeppelin v5.6.1**. This is an original architecture optimized for binary markets with dynamic fees.

#### PronosToken.sol — Conditional Tokens (ERC-1155)

Each market generates two tokens: **YES** (`marketId * 2`) and **NO** (`marketId * 2 + 1`).

- ERC-1155 standard (multiple markets in a single contract, gas-efficient)
- Only authorized pools (minters) can mint/burn tokens
- `mintPair()`: deposit collateral → receive YES + NO in 1:1 ratio
- `burnPair()`: return YES + NO → recover collateral
- `burn()`: burn winning tokens during redemption
- Ownership transferred to MarketFactory after deployment

#### MarketFactory.sol — Market Factory

Central hub for creating and managing prediction markets.

- `createMarket()`: deploys a new AMM pool with seed liquidity
- `resolveMarket()`: declares the outcome (YES=1, NO=2)
- `pauseMarket()`: suspend/resume operations
- `distributeFees()`: distributes accumulated fees (70/20/10)
- Access control: **owner** (Safe multisig) and **resolver** (can be a separate multisig)
- Configurable addresses: treasury, liquidity reserve, emergency reserve, fee collector

#### PronosAMM.sol — Automated Market Maker (CPMM)

AMM with **Constant Product (x · y = k)** formula and dynamic fees.

- **Base formula:** `x · y = k` where x, y are the YES/NO pool reserves
- **Buying:** user deposits USDC → pool mints YES/NO pairs → CPMM calculates output tokens
- **Selling:** user returns tokens → quadratic formula calculates collateral output → pool burns pairs
- **Redemption:** after resolution, winning tokens redeem 1:1 for USDC
- On-chain estimation functions: `estimateBuy()`, `estimateSell()`, `priceYes()`, `priceNo()`
- All logic lives on-chain — no off-chain infrastructure required

#### Testing

| Metric | Status |
|--------|--------|
| Total tests | **43 passing** |
| PronosToken coverage | 100% |
| MarketFactory coverage | 87% |
| PronosAMM coverage | 82% |
| Full lifecycle test | ✅ create → fund → trade → resolve → redeem |
| Framework | Foundry (forge test) |

### Dynamic Fee

The fee formula automatically adjusts the commission based on market probability:

```
fee% = 5 × (1 - P)
```

Where P is the implied probability of the side being purchased.

| Market Probability | Fee per Trade |
|--------------------|---------------|
| 50/50 (maximum uncertainty) | 2.5% |
| 70/30 | 1.5% |
| 90/10 | 0.5% |
| 99/1 (nearly decided) | 0.05% |

**Principle:** charge more when there's more risk/uncertainty, less when the market has strong consensus. Fees are deducted **before** entering the pool and sent directly to the `feeCollector` — they never touch the AMM reserves.

### Revenue Distribution

| Destination | Percentage |
|-------------|-----------|
| Treasury (operations and development) | 70% |
| Liquidity fund (LP incentives) | 20% |
| Reserve fund (security/emergencies) | 10% |

### Market Types

| Type | Status | Description |
|------|--------|-------------|
| **Binary (Yes/No)** | ✅ Implemented | Covers sports, politics, culture. E.g.: "Will Mexico beat Argentina?" |
| **Categorical (multiple options)** | 🔜 v2 | For "Who wins La Casa de los Famosos?" with 5+ candidates. Requires AMM extension |
| **Scalar (numeric range)** | 🔜 v2 | Economic markets: exchange rate, inflation, etc. |

### 🔨 TO BUILD — Contracts

| Item | Details |
|------|---------|
| **Deploy to Arbitrum Sepolia** | Script ready (`DeployProtocol.s.sol`), needs execution with RPC + deployer wallet |
| **Deploy to Arbitrum One (mainnet)** | Same script, change RPC and verify on Arbiscan |
| **Fuzz testing** | AMM edge cases (extreme amounts, reentrancy, overflow) |
| **UMA integration** | Connect resolution to UMA Optimistic Oracle (see section 03) |
| **Categorical markets** | Extend AMM to support 3+ outcomes (v2) |

---

## 03  Resolution and Oracles

### Dual Resolution Mechanism

The platform will implement **two resolution mechanisms** depending on market category:

| Category | Mechanism | Justification |
|----------|-----------|---------------|
| **Sports / Reality TV** (La Casa de los Famosos, Liga MX, FIFA) | Multi-Sig custodial oracle 2-of-3 | Public, verifiable results (TV + official sources). No decentralized oracle needed |
| **Politics / Economics** (elections, legislation, economic indicators) | UMA Optimistic Oracle | Handles arbitrary real-world events with on-chain dispute system. Industry standard |
| **Special markets** (international events, culture) | Case by case | Multi-Sig or UMA depending on complexity |

### ✅ BUILT — Multi-Sig Resolution

| Component | Specification |
|-----------|---------------|
| **Type** | Gnosis Safe multisig (2-of-3 or 3-of-5) |
| **Signers** | Founder, co-founder, trusted third party |
| **Process** | Resolver proposes outcome → N signatures required → transaction executes `resolveMarket()` |
| **Tooling** | Safe SDK integrated in admin panel (protocol-kit + api-kit) |
| **Chains supported** | Arbitrum Sepolia + Arbitrum One |
| **Admin UI** | Create Safe, connect existing, propose/sign/execute — all from `/mvp/admin` |

### 🔨 TO BUILD — UMA Optimistic Oracle

Integrate UMA for political and complex markets where resolution isn't obvious:

| Component | Requirement |
|-----------|-------------|
| **UMA interface** | Adapter contract connecting MarketFactory to UMA's OptimisticOracleV3 |
| **Outcome proposal** | Anyone can propose a resolution with a USDC bond |
| **Dispute period** | 48 hours — if no one disputes, the result is accepted |
| **Escalation** | If disputed, escalates to UMA's DVM (Data Verification Mechanism): UMA token holders vote on-chain |
| **Auto-resolution** | After dispute period without objections, `resolveMarket()` executes automatically |
| **Resolution rules** | Specified in market description at creation time (UMA ancillary data) |

**Note:** Interfaces and comments for UMA are already prepared in the contract code. Integration requires writing an adapter contract and connecting the callbacks.

### Dispute Process

| Oracle | Process |
|--------|---------|
| **Multi-Sig (sports/TV)** | If an error is detected, signers deliberate and correct by majority (2/3). Curation committee is final arbiter |
| **UMA (politics)** | Any token holder can dispute during the dispute period. Dispute escalates to DVM: UMA token holders vote on-chain. Majority determines the outcome |

**Ambiguous cases** (show cancelled, technical tie, postponed event): resolution rules are specified in the market description at creation — the committee/oracle applies the pre-established rule without discretion.

### Execution Timelines

| Phase | Multi-Sig | UMA |
|-------|-----------|-----|
| Reporting period | 24h after event | 24h after event |
| Dispute period | N/A (direct resolution) | 48h after proposal |
| Resolution without dispute | 24-48h | Automatic at period close |
| Resolution with dispute | 24-48h (2-of-3 deliberation) | 5-7 business days (DVM vote) |
| Fund release | Immediate after resolution | Immediate after resolution |
| UMA oracle fee | N/A | ~1.5% of market value (absorbed by protocol, not the user) |

---

## 04  Frontend and User Experience

### ✅ BUILT — Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18 + Vite 5 (SPA, mobile-first) |
| **Routing** | React Router v6 (basename `/mvp`) |
| **Auth/Wallet** | Privy (`@privy-io/react-auth`) — email, Google, wallet |
| **Blockchain** | ethers.js v5.7.2 |
| **Styles** | Custom CSS (proprietary design system, dark theme, responsive) |
| **Monitoring** | Sentry (`@sentry/react`, ErrorBoundary, privacy-safe) |
| **Hosting** | Vercel (static + serverless functions) |
| **Language** | Spanish only |

### ✅ BUILT — Pages and Components

#### Home Page (`/mvp/`)
- Hero carousel with featured markets
- Market grid with live data (Polymarket Gamma API + own protocol markets)
- "How it works" section — visual flow explanation
- Animated market ticker
- Search bar with market filter
- Footer with links
- Responsive: tablet (≤1024px) and mobile

#### Market Page (`/mvp/market?id=`)
- Probability ring chart (SVG)
- Bet panel with outcome and amount selection
- Payout preview with real-time dynamic fee calculation
- Tabs: Rules, Market Context, Comments, Top Holders, Positions, Activity
- Sticky sidebar with quick bet panel
- Support for resolved markets (final result view with winner)

#### Portfolio (`/mvp/portfolio`)
- User's USDC balance (chain-aware)
- Open positions list with individual P&L
- Summary: total invested, current value, profit/loss

#### Admin Panel (`/mvp/admin`)
- Restricted access (server-side auth via `/api/user`)
- Protocol mode toggle (Polymarket ↔ Own Protocol)
- Market creation form (question, category, date, oracle, liquidity)
- Market list with actions: pause, resolve
- Fee formula and distribution display (70/20/10)
- Deployed contract status panel
- Full Safe SDK integration: create Safe, connect existing, propose/sign/execute
- Non-admin users see 404 page (undiscoverable route)

#### Bet Slip (Betting Modal)
- Quick amount selection ($5, $10, $25, $50) or manual entry
- Dynamic calculation: commission, estimated payout, potential profit, implied probability
- Auto chain switch (detects wrong network and switches)
- Full flow: check balance → approve USDC → sign → submit order
- Unauthenticated users see "Join the waitlist" button (Tally form)

### ✅ BUILT — Authentication and Onboarding

| Feature | Status |
|---------|--------|
| Email login | ✅ Privy |
| Google login | ✅ Privy |
| Wallet login (MetaMask, Coinbase Wallet, etc.) | ✅ Privy |
| Automatic embedded wallet (ERC-4337) | ✅ Invisible to user |
| Username registration | ✅ With "Skip" option (auto-generates) |
| Persistent sessions | ✅ Privy embedded wallets |
| Multi-chain | ✅ Polygon + Arbitrum + Arbitrum Sepolia |
| Auto chain switch | ✅ Detects wrong network, switches automatically |
| Chain-aware USDC balance | ✅ Shows balance for active network |
| Deposit link | ✅ Bridge based on active protocol |

### ✅ BUILT — Dual Mode: Polymarket + Own Protocol

The platform operates in two modes, configurable from the admin panel:

| Mode | Description |
|------|-------------|
| **Polymarket** | Shows Polymarket markets (Gamma API), trades via CLOB on Polygon |
| **Own Protocol** | Admin-created markets, trades on PronosAMM on Arbitrum |

The switch is reactive across the entire app (custom event). In the current phase, Polymarket mode validates the UX with live markets while own contracts are deployed.

### 🔨 TO BUILD — Frontend

| Item | Details | Priority |
|------|---------|----------|
| **Connect frontend to own contracts** | `contracts.js` library to interact with PronosAMM (buy/sell/redeem) | High |
| **Buy/sell panel for own protocol** | Detect if market is Polymarket or own, route to correct AMM | High |
| **Real-time AMM price** | Read `priceYes()`/`priceNo()` from contract, display in UI | High |
| **Slippage preview** | Use `estimateBuy()`/`estimateSell()` before confirming trade | High |
| **Unified portfolio** | Merge Polymarket + own protocol positions in single view | Medium |
| **Historical price chart** | Line/OHLC chart using price_snapshots from DB | Medium |
| **MoonPay widget** | Embed widget for card/Apple Pay/Google Pay deposits | High |
| **Push notifications** | Market open/resolve alerts (WhatsApp/SMS/push) | Low — post-MVP |
| **Gas sponsoring** | Activate Privy paymaster so user pays no gas | Medium |
| **Final responsive** | Final mobile and tablet review | Medium |
| **PWA** | Service worker for app-like mobile experience | Low |

### UI Components — Full Vision

All UI components the platform should have in its complete version:

| Component | Status | Description |
|-----------|--------|-------------|
| Real-time probability chart | ✅ Ring chart | Line chart showing YES/NO price movement since market open |
| Price history | 🔨 To build | OHLC view by hour/day for trend analysis |
| Positions panel (P&L) | ✅ Basic | Dashboard: active markets, invested, current value, floating P&L |
| Active markets feed | ✅ Implemented | List with filters by category, volume, and close date |
| Individual market view | ✅ Implemented | Detail: rules, oracle, activity, comments |
| Push notifications | 🔨 To build | Alerts: market open, upcoming resolution, final result |
| Leaderboard | 🔨 To build | User ranking by P&L / volume |

---

## 05  Backend and Infrastructure

### ✅ BUILT — Serverless API (Vercel Functions)

| Endpoint | Function |
|----------|---------|
| `GET /api/markets` | List own protocol markets with current price |
| `GET /api/market?id=` | Market detail + 50 price snapshots + 20 recent trades + total volume |
| `GET /api/positions?address=` | User positions with P&L calculation (distinguishes active vs. resolved markets) |
| `GET /api/user?privyId=` | User data + admin flag (server-side, not exposed in frontend) |
| `GET /api/indexer` | On-chain event indexer (Vercel Cron, every minute) |
| `GET /api/migrate?key=` | Database migration (key-authenticated) |
| `GET /api/bitso?action=` | MXN↔USDC quote stub (mock, ready for real integration) |

### ✅ BUILT — Database (Neon PostgreSQL)

| Table | Purpose |
|-------|---------|
| `users` | Registered users (privyId, username, admin flag) |
| `protocol_markets` | Own protocol markets (chain_id, pool_address, question, status, outcome) |
| `trades` | On-chain indexed buy/sell history (deduplicated by tx_hash + log_index) |
| `positions` | Materialized positions per user/market (yes_shares, no_shares, total_cost) |
| `price_snapshots` | AMM price snapshots for charts (yes_price, no_price, liquidity) |
| `indexer_state` | Last processed block per chain |

6 indexes for fast queries. Automated migration via protected endpoint.

### ✅ BUILT — On-Chain Indexer

Reads blockchain events and writes to PostgreSQL:

- **MarketCreated** → registers new market
- **SharesBought / SharesSold** → records trade + updates user position
- **MarketResolved** → updates market status
- **Price snapshots** → reads `reserveYes()` / `reserveNo()` from AMM, calculates CPMM price

Executed via Vercel Cron (every minute) or manual trigger with authentication key.

### ✅ BUILT — Monitoring

| Tool | Use |
|------|-----|
| **Sentry** | Frontend error tracking (React ErrorBoundary, privacy-safe, production only) |
| **Structured logger** | JSON logging in API routes with duration, automatic CORS, stack traces |

### 🔨 TO BUILD — Backend

| Item | Details | Priority |
|------|---------|----------|
| **Real Bitso API** | Replace stub with real MXN↔USDC quotes and SPEI on-ramp | Medium |
| **MoonPay webhook** | Receive deposit confirmations and update DB state | High |
| **Rate limiting** | Protection against abuse on public endpoints | High |
| **Input validation** | Sanitize all user inputs in API | High |
| **CSRF protection** | CSRF tokens on POST endpoints | Medium |
| **Leaderboard API** | Endpoint for user ranking by P&L/volume | Low |

---

## 06  Security

### ✅ BUILT — Security Headers

| Header | Value | Status |
|--------|-------|--------|
| X-Frame-Options | DENY | ✅ |
| X-Content-Type-Options | nosniff | ✅ |
| Referrer-Policy | strict-origin-when-cross-origin | ✅ |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=(), usb=() | ✅ |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload | ✅ |
| CORS | Restricted to pronos.io + localhost | ✅ |
| X-XSS-Protection | 0 (disabled, replaced by CSP) | ✅ |

### Internal Security Audit — Findings

A comprehensive code audit was performed. Finding status:

#### Resolved ✅
- C1: Admin auth moved to server-side
- C4: Admin list removed from frontend bundle
- H2: X-Frame-Options: DENY
- M1-M5: Full security headers + restrictive CORS

#### 🔨 To Resolve (Pending)

| ID | Severity | Description |
|----|----------|-------------|
| C2 | Critical | CLOB credentials in POST body — derive server-side |
| C3 | Critical | DATABASE_URL accessible from frontend API — separate tiers |
| H1 | High | No Content-Security-Policy (CSP) |
| H3 | High | `/mvp/admin` without complete server-side auth |
| H4 | High | `/api/user` enumerable without authentication |
| M6 | Medium | No SRI (Subresource Integrity) on external scripts |
| M7 | Medium | No CSRF protection on POST requests |
| M8 | Medium | `localStorage` as source of truth for protocol mode |
| M9 | Medium | Vite dev proxy pointing to production |
| M10 | Medium | ethers.js v5.7.2 outdated — upgrade to v6 |

### Administrator Roles and Multisig

| Role | Control | Implementation |
|------|---------|---------------|
| **Owner** (Safe 3/5) | Pause contracts, create markets, distribute fees, update addresses | Gnosis Safe on Arbitrum |
| **Resolver** (Safe 2/3) | Resolve markets (declare winning outcome) | Can be the same Safe or another |
| **Admin UI** | Management via web panel `/mvp/admin` | Server-side auth (username-based) |

**No arbitrary upgradability:** any contract logic change requires multisig signatures. Contracts are immutable — a logic change requires a new deployment and migration.

### 🔨 TO BUILD — Security

| Item | Details | Priority |
|------|---------|----------|
| **Resolve C2, C3** | Separate CLOB credentials and DB from frontend | Critical |
| **CSP headers** | Restrictive Content-Security-Policy | High |
| **Complete admin auth** | Server-side middleware, not just username check | High |
| **Rate limiting** | On all API endpoints | High |
| **Contract fuzz testing** | AMM edge cases (reentrancy, overflow, extreme amounts) | High |
| **External audit** | By specialized firm before mainnet with significant volume | Post-launch |
| **Bug bounty** | Rewards program post-launch | Post-launch |

---

## 07  Market Curation

### v1 — Admin-Managed Markets

In v1, market creation is restricted to administrators with access to the control panel. No user-created markets until v2.

#### ✅ BUILT — Admin Panel

- Create market: question, options, close date, oracle, initial liquidity, resolution rules
- Pause / resume market for unexpected events
- Resolve market: select winning outcome
- Metrics display: fees, distribution, contract status
- Safe integration: propose/sign/execute transactions from the UI

#### 🔨 TO BUILD

| Item | Details | Priority |
|------|---------|----------|
| **Wire forms to contracts** | Connect market creation form to `MarketFactory.createMarket()` via Safe | High |
| **Wire resolve/pause** | Resolve/pause buttons execute transactions via Safe multisig | High |
| **Metrics dashboard** | Volume per market, participants, accumulated fees, liquidity | Medium |
| **User management** | Suspend accounts for suspicious activity | Low |
| **User-generated markets** | Allow users to propose markets (v2, with moderation) | Post-MVP |

### Launch Markets (Target: FIFA World Cup 2026)

| Category | Examples |
|----------|----------|
| **FIFA World Cup** | Will Mexico advance to round of 16? Group winner? Argentina repeat? |
| **Liga MX** | Who wins Clausura 2026? Relegation? |
| **Mexican Politics** | Midterm elections, reforms, appointments |
| **Reality TV** | La Casa de los Famosos, Exatlon, La Academia |
| **Crypto/Economics** | Bitcoin price, exchange rate, inflation |

**5-10 curated markets** are planned for launch, with USDC seed liquidity.

---

## 08  Roadmap and Current Status

### Phase 1: Foundation and Contracts — ~85% Complete

| Item | Status |
|------|--------|
| Architecture defined (hybrid: Polymarket + own protocol) | ✅ |
| Core contracts: PronosToken, PronosAMM, MarketFactory | ✅ |
| 43 tests passing (Foundry) | ✅ |
| Reproducible deploy script (`DeployProtocol.s.sol`) | ✅ |
| Safe SDK integrated in admin panel | ✅ |
| Arbitrum Sepolia config in foundry.toml | ✅ |
| **Deploy to Arbitrum Sepolia** | 🔨 To do |
| **Create Safe multisig on testnet** | 🔨 To do |
| **Transfer ownership to Safe** | 🔨 To do |

### Phase 2: Features and UI — ~75% Complete

| Item | Status |
|------|--------|
| Complete frontend (Home, Market, Portfolio, Admin) | ✅ |
| Polymarket integration (Gamma API, CLOB trading) | ✅ |
| Admin panel with market CRUD + Safe SDK | ✅ |
| Wallet & onboarding (Privy, multi-chain, auto-switch) | ✅ |
| Backend: DB schema, indexer, APIs, price snapshots | ✅ |
| Monitoring: Sentry, structured logging | ✅ |
| Bet slip with dynamic fee and preview | ✅ |
| Responsive (tablet + mobile) | ✅ |
| OG metadata, Twitter cards, favicon | ✅ |
| Waitlist gate (Tally form) | ✅ |
| **Connect frontend to own contracts** | 🔨 To do |
| **Wire admin forms to contracts via Safe** | 🔨 To do |
| **Integrate MoonPay (on-ramp)** | 🔨 To do |
| **Integrate UMA Oracle** | 🔨 To do |
| **Load 5-10 curated markets** | 🔨 To do |
| **E2E testing on testnet** | 🔨 Blocked by deploy |

### Phase 3: Hardening and Mainnet — Target: May 31, 2026

| Item | Priority |
|------|----------|
| Deploy to Arbitrum One (mainnet) | Critical |
| Verify contracts on Arbiscan | Critical |
| Resolve security findings (C2, C3, H1, H3, H4) | Critical |
| Seed liquidity for launch markets | Critical |
| World Cup 2026 markets ready | Critical |
| 48h stability test without intervention | High |
| Technical documentation and runbook | High |
| Rate limiting + input validation | High |
| Final mobile responsiveness check | Medium |

### Post-MVP — Full Vision

Features planned after the World Cup launch:

| Item | Description | Estimate |
|------|-------------|----------|
| **Direct Bitso** | MXN on/off ramp via SPEI, buy/sell USDC within the app | $10-15K |
| **Categorical markets** | Support for 3+ outcomes (extended AMM) | $10-15K |
| **Scalar markets** | Numeric ranges (exchange rate, inflation) | $10-15K |
| **External audit** | By specialized firm (Trail of Bits, OpenZeppelin, etc.) | $25-50K |
| **Market making bot** | Algorithmic liquidity to maintain tight spreads | $5-10K |
| **Push notifications** | Alerts via WhatsApp/SMS/push (open, resolve, result) | $3-5K |
| **User-generated markets** | Allow users to propose markets with moderation | $10-15K |
| **Leaderboard** | Public trader ranking by P&L and volume | $3-5K |
| **Native apps** | iOS/Android (React Native or advanced PWA) | $15-25K |
| **Referral program** | Incentives for inviting new users | $5-8K |
| **Analytics dashboard** | Public protocol metrics panel (TVL, volume, users) | $5-8K |

---

## 09  Tech Stack Summary

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Blockchain** | Arbitrum (Ethereum L2) | Low gas, EVM-compatible, native USDC, mature ecosystem |
| **Contracts** | Solidity 0.8.24 + OpenZeppelin + Foundry | Custom architecture, ERC-1155, CPMM AMM with dynamic fees |
| **Tokens** | PronosToken (ERC-1155) | Single contract for all markets, gas-efficient |
| **AMM** | PronosAMM (x·y=k) | No off-chain engine, automatic liquidity, dynamic fees |
| **Oracle (sports)** | Multi-sig custodial (Safe 2-of-3) | Public results, direct control, fast resolution |
| **Oracle (politics)** | UMA Optimistic Oracle | Industry standard, on-chain dispute system |
| **Collateral** | USDC (Circle) | Most liquid stablecoin on Arbitrum |
| **On-ramp** | MoonPay + SPEI | Apple Pay, Google Pay, cards, Mexican bank transfer |
| **Wallet/Auth** | Privy (Account Abstraction EIP-4337) | Email/Google/wallet, no seed phrases, gas sponsoring |
| **Frontend** | React 18 + Vite 5 (SPA, mobile-first) | Fast iteration, Spanish only |
| **Backend** | Vercel Serverless Functions | Zero-config, auto-scaling, built-in cron jobs |
| **Database** | Neon PostgreSQL (serverless) | Vercel-compatible, no server to maintain |
| **Monitoring** | Sentry + structured logging | Privacy-safe error tracking |
| **Multisig** | Gnosis Safe (2-of-3 / 3-of-5) | Industry standard, SDK integrated |
| **Testing** | Foundry (forge test) | 43 tests, >75% coverage |

---

## 10  Differentiators vs. Competition

| Feature | Polymarket | Myriad Markets | Pronos |
|---------|-----------|---------------|--------|
| Curated LATAM markets | ❌ Global/US focus | ❌ Global focus | ✅ Liga MX, Mexican politics, culture, FIFA |
| Language | English | English | Native Spanish |
| Non-crypto onboarding | ❌ Requires wallet + bridging | Partial | ✅ Email/Google → embedded wallet |
| MXN on-ramp | ❌ | ❌ | ✅ MoonPay + SPEI |
| Transparent fees | 0% (hidden spread) | Variable | Explicit dynamic fee (0.05-2.5%) |
| Resolution | UMA (slow) | Centralized | Fast multisig (24-48h) + UMA for politics |
| Target market | Global, crypto traders | Global | LATAM, non-crypto users |

---

## 11  What We Need from the Dev Shop

### Executive Summary

We have ~75% of the product built. Smart contracts are written and tested. The frontend is functional with Polymarket mode active. The backend with indexer, APIs, and database is operational.

**What's missing to reach mainnet:**

#### Critical Priority (before June 14)
1. Deploy contracts to Arbitrum Sepolia → test → deploy to Arbitrum One
2. Connect the frontend to own contracts (buy/sell/redeem via PronosAMM)
3. Wire admin panel to contracts via Safe multisig
4. Integrate MoonPay for deposits (Apple Pay, Google Pay, cards)
5. Integrate UMA Optimistic Oracle for political markets
6. Resolve critical/high security vulnerabilities (C2, C3, H1, H3, H4)
7. E2E testing of full flow on testnet
8. Load 5-10 curated markets (World Cup + Liga MX + politics)

#### Medium Priority (can be post-launch)
- Gas sponsoring (activate Privy paymaster)
- Historical price chart (OHLC)
- Unified portfolio (Polymarket + own)
- Rate limiting and input validation on APIs
- Final responsive check
- SPEI on-ramp

#### Nice to Have (post-MVP)
- Categorical markets (3+ outcomes)
- Push notifications
- Leaderboard
- Market making bot
- User-generated markets
- Native apps

### Repository and Access

| Resource | URL/Location |
|----------|-------------|
| GitHub repo | `github.com/mezcalpapieth-jpg/pronos` (private) |
| Frontend (staging) | `pronos.io/mvp/` |
| Contracts | `contracts/src/` (Solidity 0.8.24, Foundry) |
| Deploy scripts | `contracts/script/DeployProtocol.s.sol` |
| Serverless API | `frontend/api/` |
| Database | Neon PostgreSQL (connection string in Vercel env vars) |
| Tests | `contracts/test/` — 43 tests, run with `forge test` |

---

*Document prepared by Simon Lacy — Founder, PRONOS*
*Last updated: April 2026*
*Confidential — For exclusive use in development evaluation context. Do not distribute.*

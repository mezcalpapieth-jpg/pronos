# PRONOS MVP — ROADMAP
### Target: Mainnet Live before FIFA World Cup (June 14, 2026)
### Budget saved: $30,000

> Legend: ~~Crossed out~~ = Done | **Bold** = In Progress | Normal = Pending

---

## 🚧 WHAT'S STILL MISSING (as of 2026-04-11)

**T-minus 64 days to World Cup kickoff.**

### 🔴 BLOCKED (waiting on external input)
- **Resend domain verification** — needs Mezcal/GoDaddy DNS access to finish SPF/DKIM. Blocks waitlist emails and any transactional mail.
- **Chain decision** — Arbitrum Sepolia contracts are ready but we haven't pulled the trigger on mainnet. Blocks everything in Phase 3.
- **Anthropic API key** — the daily AI market generation cron is built and live at `/api/cron/generate-markets` but no-ops until the key is activated in Vercel env vars.

### 🔴 VERCEL ENV VARS NEEDED BEFORE DEPLOY
These must be set in Vercel project settings → Environment Variables:

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PRIVY_JWT_VERIFICATION_KEY` | ES256 public key (PEM) from Privy dashboard → Settings → Verification keys. Enables server-side JWT auth on all API endpoints. Without it, auth is **bypassed** in dev but **blocks requests** in production. | **Yes for prod** |
| `CLOB_SESSION_SECRET` | HMAC secret for signing Polymarket CLOB session cookies. Used by `/api/clob` for order placement. | **Yes for trading** |
| `MVP_ACCESS_PASSWORD` | Password for the MVP access gate (`/api/mvp-access`). Falls back to `mezcal` in dev; **no fallback in production** — gate returns 500 without it. | **Yes for prod** |
| `MVP_ACCESS_SECRET` | Separate HMAC key for signing access cookies. Falls back to `CLOB_SESSION_SECRET` → `MVP_ACCESS_PASSWORD` if absent. Better security to set a dedicated one. | Recommended |
| `VITE_PRONOS_ARB_SEPOLIA_FACTORY` | MarketFactory contract address on Arbitrum Sepolia. Needed for own-protocol market creation. | For Phase 3 |
| `VITE_PRONOS_ARB_SEPOLIA_TOKEN` | PronosToken (ERC-1155) contract address on Arbitrum Sepolia. Needed for own-protocol trading. | For Phase 3 |
| `VITE_PRONOS_ARB_SEPOLIA_AMM` | PronosAMM contract address on Arbitrum Sepolia. Needed for own-protocol trading. | For Phase 3 |

Already set (verify): `DATABASE_URL`, `PRIVY_APP_ID`, `ADMIN_USERNAMES`, `ANTHROPIC_API_KEY`, `MIGRATE_KEY`

### 🟠 HIGH PRIORITY — PRODUCT POLISH (unblocked, can ship now)
- **World Cup hub page** — `/mundial` with all FIFA 2026 markets, bracket viz, custom hero. Launch-defining.
- **Portfolio / "Mis Apuestas" page** — users currently have no way to see their own bets. Critical for retention.
- **Search bar with fuzzy matching** — 60+ markets and growing, no search. Quick win.
- **Per-market OG / share cards** — dynamic preview images with title, odds, sparkline. Huge for WhatsApp-driven LATAM virality.
- **Leaderboard** — top predictors by volume / win rate / P&L. Social proof + gamification.

### 🟡 MEDIUM PRIORITY — PROTOCOL WIRING (unblocked but needs testnet testing)
- **Wire create-market admin form** → `MarketFactory` contract calls
- **Wire pause/resolve admin buttons** → contract calls via Safe
- **Contract interaction library** (`lib/contracts.js`) for own AMM
- **Dual-mode market detail page** — detect Polymarket vs own protocol, render accordingly
- **Buy/sell panel routing** → own AMM for protocol markets
- **Real-time AMM price display** (x·y=k calculation) + slippage preview
- **Portfolio merge** — positions from both Polymarket and own protocol

### 🟢 SECURITY REMEDIATION (remaining from 2026-03-31 audit)
- **C2** CLOB credentials in POST body — derive server-side
- **C3** DATABASE_URL exposed from frontend API — separate tier or edge functions with secrets
- **H1** No CSP (Content-Security-Policy)
- **H3** `/mvp/admin` has no server-side auth (only client-side check)
- **H4** `/api/user` enumerable without authentication
- **M6** No SRI on Tally.so script
- **M7** No CSRF protection on POST requests
- **M8** `localStorage` as source of truth for protocol mode
- **M9** Vite dev proxy pointing to production
- **M10** ethers.js v5.7.2 → upgrade to v6
- Manual security review of all contracts (reentrancy, overflow, access control)
- Fuzz testing on AMM edge cases
- Rate limiting on API routes
- Input validation on all user-facing endpoints

### 🔵 MAINNET LAUNCH SEQUENCE (blocked by chain decision above)
- Deploy all contracts to Arbitrum One
- Transfer ownership to production Safe multisig
- Verify contracts on Arbiscan
- Seed liquidity for 5–10 launch markets (USDC)
- Create Safe multisig on Arbitrum Sepolia (3/5 admin, 2/3 resolution)
- Transfer contract ownership to Safe
- Test resolution flow through multisig
- 48h stability test
- E2E testnet flow: register → buy → sell → resolve → redeem
- Full mobile responsiveness pass
- Operations runbook + incident response playbook

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
- [ ] Deploy all contracts to Arbitrum Sepolia
- [ ] Create 1 test market via Factory
- [ ] Verify AMM receives liquidity and calculates prices correctly
- [ ] Document deployed addresses in `deployments.json`

### 1.5 Safe Multisig
- [x] ~~Setup guide created (`scripts/setup-safe.md`) with step-by-step instructions~~
- [x] ~~Safe SDK integrated in admin panel (`lib/safe.js` — protocol-kit + api-kit)~~
- [x] ~~Admin UI: create Safe, connect existing, propose/sign/execute transactions~~
- [x] ~~Supports Arbitrum Sepolia + Arbitrum One (chain selector in UI)~~
- [ ] Create Safe multisig on Arbitrum Sepolia (3/5 admin, 2/3 resolution)
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
- [x] ~~MXNB balance display in nav bar and bet slip~~
- [x] ~~Multi-chain Privy config (Polygon + Arbitrum + Arbitrum Sepolia)~~
- [x] ~~Network switching utilities (`getRequiredChainId`, `switchToRequiredChain`)~~
- [x] ~~Chain indicator in user dropdown (Polygon / Arbitrum / Arb Sepolia)~~
- [x] ~~Auto network switch when user trades on wrong chain (BetModal + Nav dropdown)~~
- [x] ~~USDC balance display (chain-aware) + deposit link (Polygon bridge / Arbitrum bridge)~~
- [x] ~~Gasless transaction helper (`lib/gasless.js`) — ready for Privy paymaster activation~~
- [x] ~~Onboarding: skip username button (auto-generate), showWalletUIs enabled~~

### 2.4 Backend & Indexing
- [x] ~~Database schema: protocol_markets, trades, positions, price_snapshots, indexer_state~~
- [x] ~~Migration endpoint (`/api/migrate`) — creates all tables + indexes~~
- [x] ~~Event indexer (`/api/indexer`) — MarketCreated, SharesBought, SharesSold, MarketResolved~~
- [x] ~~Price snapshots from AMM reserves (CPMM: price = opposite_reserve / total)~~
- [x] ~~Vercel Cron: indexer runs every minute~~
- [x] ~~API endpoint: `/api/markets` — list own protocol markets with latest price~~
- [x] ~~API endpoint: `/api/market?id=` — market detail + 50 price snapshots + 20 recent trades~~
- [x] ~~API endpoint: `/api/positions?address=` — user positions with P&L calculation~~

### 2.5 Monitoring & Quality
- [x] ~~Sentry integration (`@sentry/react` + ErrorBoundary, privacy-safe, prod-only)~~
- [x] ~~API error logging (structured JSON logger + `withLogging` wrapper)~~
- [x] ~~Bitso stub endpoint (`/api/bitso` — mock ticker + quote for MXN↔USDC)~~

### 2.7 Market Content & Resolution (new since 2026-04-01)
- [x] ~~`market_resolutions` table + `/api/resolutions` endpoint (admin-driven, works pre-contracts)~~
- [x] ~~Admin "Resolver" UI in `/mvp/admin` to set winners manually~~
- [x] ~~"Resueltos" tab on main grid + "RESUELTO" badge on resolved cards~~
- [x] ~~Resolved-state detail page: banner, winner card, greyed-out losers~~
- [x] ~~Resolved markets show 100/0 instead of pre-cierre percentages (card + detail)~~
- [x] ~~Auto-resolve cron (`/api/cron/auto-resolve`, every 30 min) — queries Polymarket Gamma for closed markets and writes winners automatically; falls back to "Pendiente de resolución" placeholder for local/AI markets without an oracle~~
- [x] ~~Client-side expiration filter — markets past their deadline disappear from active tabs instantly via `lib/deadline.js` (`isExpired()`)~~
- [x] ~~Expired-but-unresolved markets lock the detail page: `🔒 POR RESOLVER` banner, disabled Comprar buttons, closed-state sidebar~~
- [x] ~~Daily AI market generation pipeline: `/api/cron/generate-markets` (Claude Sonnet 4.5, Google News RSS, no-op without API key)~~
- [x] ~~`generated_markets` table + `/api/generated-markets` admin review endpoint~~
- [x] ~~Admin review UI with Pendientes / Aprobados / Rechazados tabs~~
- [x] ~~Approved AI markets mix into the main grid alongside live Polymarket markets~~

### 2.8 Graphs & Price History (new since 2026-04-01)
- [x] ~~`/api/price-history` batch proxy for Polymarket CLOB `prices-history` (edge-cached 5 min)~~
- [x] ~~`lib/priceHistory.js` frontend client: `fetchPriceHistory`, `extractSeries`, `collectTokenIds`~~
- [x] ~~Sparkline component rewrite: left label / middle SVG / right value, Catmull-Rom smoothing, glow filter, hover tooltip, HTML overlay end-dot~~
- [x] ~~Real CLOB price history wired into MarketsGrid (batched), MarketDetail, and Hero carousel~~
- [x] ~~Sparklines reflect real pct targets when no history is available (seeded deterministic mock)~~
- [x] ~~Single chart for yes/no markets, multi-line for 3+ options~~
- [x] ~~Hero carousel: single featured card with 6s auto-rotation, prev/next arrows, dot indicators, progress bar, click-to-navigate~~

### 2.9 Accounts & Admin (new since 2026-04-01)
- [x] ~~Case-insensitive usernames (normalized at insert, `CREATE UNIQUE INDEX ON users (LOWER(username))`)~~
- [x] ~~Added "alex" to admin usernames~~
- [x] ~~Admin fallback list centralized (`ADMIN_USERNAMES || 'mezcal,frmm,alex'`) across `/api/user`, `/api/resolutions`, `/api/generated-markets`~~

### 2.6 E2E Testing (Testnet)
- [ ] Full flow: register → buy shares → sell shares → resolution → redemption
- [ ] Embedded wallet transactions work without errors
- [ ] Prices and slippage calculate correctly
- [ ] Admin can resolve a market manually via multisig

---

## PHASE 3: HARDENING & MAINNET
**Target: May 31, 2026**

### 3.1 Mainnet Deployment
- [ ] Deploy all contracts to Arbitrum One
- [ ] Transfer ownership to production Safe multisig
- [ ] Verify all contracts on Arbiscan
- [ ] Frontend points to mainnet contracts
- [ ] Seed liquidity for 5-10 launch markets (USDC)

### 3.2 Security Hardening (Audit 2026-03-31)

#### CRITICAL — Must fix before mainnet
- [x] ~~**C1** Admin auth moved to server-side (`/api/user` returns `isAdmin` flag)~~
- [ ] **C2** CLOB credentials in POST body (visible in Network tab) — only send signature, derive credentials server-side
- [ ] **C3** DATABASE_URL exposed from frontend API — separate database tier / use edge functions with secrets
- [x] ~~**C4** Admin usernames removed from frontend bundle, checked server-side only~~

#### HIGH — Fix before launch
- [ ] **H1** No CSP (Content-Security-Policy) — Tally/ethers/Privy scripts unrestricted
- [x] ~~**H2** X-Frame-Options: DENY added via vercel.json~~
- [x] ~~**H3** `/mvp/admin` server-side auth — Privy JWT verification on all admin API calls~~
- [x] ~~**H4** `/api/user` requires Privy JWT Bearer token in production~~

#### MEDIUM — Fix during hardening
- [x] ~~**M1** HSTS with `includeSubDomains` and `preload` added~~
- [x] ~~**M2** `Permissions-Policy` header added~~
- [x] ~~**M3** `Referrer-Policy: strict-origin-when-cross-origin` added~~
- [x] ~~**M4** `X-Content-Type-Options: nosniff` added~~
- [x] ~~**M5** CORS restricted to pronos.io + localhost on API endpoints~~
- [ ] **M6** No SRI (Subresource Integrity) on Tally.so script
- [ ] **M7** No CSRF protection on POST requests
- [ ] **M8** `localStorage` as source of truth for protocol mode
- [ ] **M9** Vite dev proxy pointing to production
- [ ] **M10** ethers.js v5.7.2 outdated — upgrade to v6

#### Passed
- ~~No XSS~~ ~~No eval()~~ ~~HTTPS forced (308)~~ ~~No mixed content~~ ~~No X-Powered-By~~ ~~Privy handles sessions correctly~~

#### Legacy items
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
- [x] ~~OG metadata, Twitter cards, favicon added~~
- [x] ~~Nav responsive on tablet (≤1024px) and mobile~~
- [x] ~~Waitlist button on public-facing bet slip (Tally form)~~
- [x] ~~Polymarket/Polygon branding removed from MVP~~
- [ ] Mobile responsiveness final check

---

## POST-MVP (After World Cup Launch)
> Not in scope now, but planned for later

- [ ] MoonPay integration (USDC on-ramp: Apple Pay, Google Pay, cards + KYC) — partner account needed
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
| 2026-03-31 | Wallet & onboarding: MXNB balance in nav, multi-chain Privy (Polygon+Base), network switching util. Security audit: 4 critical, 4 high, 10 medium findings added to roadmap. |
| 2026-03-31 | Fixed security: C1 (server-side admin auth), C4 (removed admin list from bundle), H2 (X-Frame-Options), M1-M5 (headers + CORS). Switched chain from Base to Arbitrum across codebase. |
| 2026-04-01 | (Mezcal) OG metadata + Twitter cards, favicon, nav responsiveness, search bar styling, removed Polymarket branding, waitlist gate on bet button, removed landing page portfolio section. |
| 2026-04-01 | Updated roadmap: checked off completed items, fixed Base→Arbitrum references. Continuing 2.3 wallet & onboarding. |
| 2026-04-01 | Completed 2.3: auto chain switch (BetModal + Nav), chain-aware USDC balance, deposit links, gasless helper, onboarding skip-username. Protocol mode reactive across components via custom event. |
| 2026-04-01 | Completed 2.4: DB schema (5 tables), migration endpoint, event indexer (Vercel Cron), /api/markets + /api/market + /api/positions endpoints with P&L. |
| 2026-04-01 | Completed 2.5: Sentry integration (ErrorBoundary, privacy-safe), structured API logger, Bitso mock endpoint (ticker + quotes). |
| 2026-04-05 | Market resolutions v1: `market_resolutions` table, admin "Resolver" UI, "Resueltos" tab, resolved-state card and detail page with winner banner. |
| 2026-04-07 | Hero carousel v2: single featured card with 6s auto-rotate, prev/next, dots, progress bar. Sparkline rewrite: right-side value, hover tooltip, glow, smooth Catmull-Rom curves. Single vs multi chart based on option count. |
| 2026-04-08 | Daily AI market generation pipeline: `/api/cron/generate-markets` (Claude Sonnet 4.5 + Google News RSS), `generated_markets` table, admin review UI. No-op until `ANTHROPIC_API_KEY` is activated. |
| 2026-04-09 | Case-insensitive usernames (`LOWER(username)` unique index, normalized inserts, lowercase input). Added "alex" admin. |
| 2026-04-10 | Real Polymarket CLOB price history for all sparklines: `/api/price-history` batch proxy (edge-cached 5 min), `lib/priceHistory.js`, wired into MarketsGrid, MarketDetail, and Hero. |
| 2026-04-11 | Auto-resolve cron `/api/cron/auto-resolve` (every 30 min): queries Gamma for expired Polymarket markets and writes winners automatically. Client-side `isExpired()` hides dead markets instantly. |
| 2026-04-11 | Closed markets lock the detail page (`🔒 POR RESOLVER` banner, disabled Comprar). Resolved markets show 100/0 instead of stale pre-cierre percentages on cards and detail page. |
| 2026-04-12 | Admin: open/closed/resolved tabs, Polymarket approval gate (approve/reject/revoke), auto-translate via Anthropic Haiku (bulk on load), EN+ES side-by-side in admin table. |
| 2026-04-12 | EN/ES language toggle works across ALL market sources: hardcoded markets got `title_en`/`options_en`, Polymarket markets get `title_en` from Gamma + `title_es` from approval cache, `localizedTitle()`/`localizedOptions()` helpers in i18n.js. |
| 2026-04-12 | Interactive sparkline hover: `extractSeries` returns `{t,p}` tuples, mouse-anywhere crosshair + dot + timestamp tooltip ("12 abr, 14:00 · 65%"). |
| 2026-04-12 | Admin market creation form actually saves to DB (POST `/api/generated-markets` with `action=create`), supports 2-6 dynamic options, auto-approved. |
| 2026-04-12 | Admin fully translated to English (50+ `admin.*` i18n keys), quiz link added to HowItWorks section. |
| 2026-04-12 | Security hardening: Privy JWT auth (`_lib/auth.js`), shared admin/CORS helpers, cookie-based MVP access gate (`/api/mvp-access`), lazy route loading, authFetch wrapper. Closes H3, H4 from audit. |

---

*Last updated: 2026-04-12*

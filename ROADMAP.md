# PRONOS MVP — ROADMAP
### Target: Mainnet Live before FIFA World Cup (June 14, 2026)
### Budget saved: $30,000

> Legend: ~~Crossed out~~ = Done | **Bold** = In Progress | Normal = Pending

---

## 🔄 MVP CONSOLIDATION ONTO POINTS-APP (current focus, 2026-04-23)

Decision: rather than branch a separate `mvp-v2` from `main`, we'll
evolve the `points-app` branch into the production MVP. The points-app
already carries the final UI (sticky category bar, market cards with
team logos + buy drawer, per-category routes, World Cup tab with
bracket, 14 generators, auto-resolvers, admin tooling, stats
endpoint, OAuth social linking). The on-chain trading engine that
lives on `main` will be PORTED INTO `points-app`, not the other way
around — when we're ready to launch production, `points-app`
replaces `main`.

Features the points-app ALREADY has that the MVP needed:
- World Cup 2026 hub (72 fixtures, bracket tree, Mexico Path)
- Shared CategoryBar on every page + Finanzas tab
- Buy drawer opened from any outcome pill (createPortal + slippage
  guards minSharesOut / maxAvgPrice / minCollateralOut)
- Admin tooling: 🔄 Generar ahora · 🔧 Retrofit resolvers ·
  ⚡ Resolver ahora · 🩺 Diagnóstico resolver · 🏆 Progresar Mundial
- 🔥 Featured toggle on each market (replaces trending-by-recency)
- 14 generators + auto-resolvers (Chainlink, API price, weather,
  charts, sports API, Jolpica F1)
- Portfolio OK-button for losing resolved positions
- Stats endpoint for true active-market count

What we still need to add (the on-chain layer):
- [x] **M1 — Roadmap + plan (this commit).** Lock strategy on
      `points-app`. Un-sideline hybrid oracle + news feed. Delete
      the throwaway `mvp-v2` branch I cut earlier today.
- [ ] **M2 — Turnkey delegated-signing policy.** No Privy. The
      existing Turnkey setup (email OTP + sub-org per user +
      `turnkey_sub_org_id` on points_users) stays as is — we add a
      policy layer ON TOP. First time a user does an on-chain-mode
      action, they authorize a one-time policy: the Pronos backend
      API key can sign `buy / sell / redeem / MXNB.approve` up to
      200k MXNB/day for 180 days against whitelisted contracts.
      After that, zero popups on trades. Withdrawals still require
      fresh user signature. Privy is not in the picture on this
      branch — dropped when we decided to consolidate on points-app.
- [ ] **M3 — Port on-chain libs into points-app.** Bring
      `lib/contracts.js` + `lib/protocolPricing.js` + the BetModal
      trade path into `frontend/app/points/src/lib/onchain/`.
      Add `market.chain_market_id` + `market.mode` columns
      (`points` | `onchain`). Off-chain markets keep working as is.
- [ ] **M4 — Dual-mode trade endpoints.** `/api/points/buy` +
      `/api/points/sell` dispatch: `mode='points'` → existing DB
      path; `mode='onchain'` → Turnkey signs, paymaster relays,
      indexer writes the trade back. Same drawer UI, same slippage
      guards, same UX.
- [ ] **M5 — On-chain indexer + resolver.** Port the
      `/api/indexer` event reader to write on-chain trades into
      `points_trades` (so portfolio / leaderboards work across
      both modes). Resolver for `mode='onchain'` markets calls
      the factory's resolve() via Safe multisig.
- [ ] **M6 — Mainnet launch toggle.** Flip the default for new
      admin-created markets to `mode='onchain'` once contracts are
      audited + seeded on Arbitrum One. Existing off-chain markets
      resolve naturally on their own timelines.

### Un-sidelined tracks (resumed in parallel with M2–M6)

- [ ] **Hybrid oracle.** Chainlink Price Feeds for price-settled
      markets (already live off-chain as `chainlink_price`
      resolver_type; port the same dispatcher to on-chain resolve).
      UMA optimistic oracle for subjective/sports markets (new;
      $15–20k integration cost noted in POST-MVP).
- [ ] **News feed tab.** `/noticias`. Phase 1 admin-curated via a
      new `points_news` table. Phase 2 GDELT auto-pull with approval
      queue. Inline "related news" panel on market detail.
- [ ] **Social linking OAuth (verified).** X live. IG + TikTok via
      bio-code verification to skip Meta review (or OAuth once
      approved).

---

## 🚧 WHAT'S STILL MISSING (as of 2026-04-16)

**T-minus 60 days to World Cup kickoff.**

### 🔴 BLOCKED (waiting on external input)
- **Resend domain verification** — needs Mezcal/GoDaddy DNS access to finish SPF/DKIM. Blocks waitlist emails and any transactional mail.
- **Chain decision** — Arbitrum Sepolia contracts are ready but we haven't pulled the trigger on mainnet. Blocks everything in Phase 3.
- **Privy OAuth providers** — Twitter/Instagram/TikTok OAuth apps need to be configured in dashboard.privy.io for social connect buttons to work. Currently they fail with a toast error.
- **Safe on Arbitrum Sepolia** — Safe contracts exist, but hosted Safe UI/backend do not fully support this network. Current testnet path uses direct owner EOA, not multisig execution.

### 📊 READINESS SNAPSHOT (2026-04-16)
- **Testnet readiness: 78%** — good enough for a closed/internal pilot. Core flows exist: create markets, buy, early exit, portfolio, indexer, admin approval, and Privy auth. Biggest blockers before a broader testnet push: tighten auth/cron security, fix liquidity and portfolio accounting, clean stale deployment docs, and run end-to-end smoke tests.
- **Mainnet readiness: 42%** — architecture is taking shape, but hardening is not there yet. Missing: reentrancy + slippage protection, Safe-owned production flow, rate limiting/CSP/CSRF, external audit, mainnet deployment runbook, and launch operations/legal prep.

### 🔴 VERCEL ENV VARS NEEDED BEFORE DEPLOY
These must be set in Vercel project settings → Environment Variables:

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PRIVY_JWT_VERIFICATION_KEY` | ES256 public key (PEM) from Privy dashboard. Without it, auth is **bypassed** on non-production deploys. | **Yes for prod** |
| `CRON_SECRET` | Bearer token for cron endpoints. Without it, indexer/auto-resolve accept any `User-Agent: vercel-cron` request. | **Yes for prod** |
| `CLOB_SESSION_SECRET` | HMAC secret for Polymarket CLOB session cookies. | **Yes for trading** |
| `MVP_ACCESS_PASSWORD` | Password for beta access gate. No fallback in production. | **Yes for prod** |
| `MVP_ACCESS_SECRET` | HMAC key for access cookies. Falls back to CLOB_SESSION_SECRET. | Recommended |
| `VITE_PRONOS_ARB_SEPOLIA_FACTORY` | MarketFactory v1 address. | Set ✓ |
| `VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2` | MarketFactoryV2 address. | Set ✓ |
| `VITE_PRONOS_ARB_SEPOLIA_TOKEN` | PronosToken v1 (ERC-1155) address. | Set ✓ |
| `VITE_PRONOS_ARB_SEPOLIA_TOKEN_V2` | PronosTokenV2 (ERC-1155) address. | Set ✓ |
| `VITE_PRONOS_ARB_SEPOLIA_USDC` | USDC address on Arbitrum Sepolia. | Set ✓ |

Already set (verify): `DATABASE_URL`, `DATABASE_READ_URL`, `PRIVY_APP_ID`, `ADMIN_USERNAMES`, `ANTHROPIC_API_KEY`, `MIGRATE_KEY`

### 🟠 HIGH PRIORITY — PRODUCT POLISH
- ~~**World Cup hub page**~~ — Done on points-app at `/c/world-cup`.
  Tri-color hero + countdown, 4×3 group grid with flag badges, per-group
  matches with 1/X/2 buy pills, Group Winner parallel markets, symmetric
  bracket tree (R32 → Final), Mexico Path composite. Fixtures from the
  real FIFA 2026 draw (72 group matches).
- **Per-market OG / share cards** — dynamic preview images with title, odds, sparkline. Huge for WhatsApp-driven LATAM virality.
- **Search across all sources** — currently only searches hardcoded MARKETS. Need: protocol + generated + live Polymarket.
- **MXNP points backend** — leaderboard currently uses mock data; need real DB-backed points, referral tracking, social task verification queue.
- ~~**Portfolio / "Mis Apuestas" page**~~ — Done. Full positions, PnL, sell flow with exit preview modal.
- ~~**Leaderboard**~~ — Done (mock data, right sidebar in Portfolio). Needs backend.

### 🟡 MEDIUM PRIORITY — PROTOCOL WIRING
- ~~**Wire create-market admin form → MarketFactory contract calls**~~ — Done (v1 binary + v2 multi-outcome).
- ~~**Contract interaction library (`lib/contracts.js`) for own AMM**~~ — Done (buy/sell/redeem, v1+v2, pre-flight balance check).
- ~~**Dual-mode market detail page**~~ — Done. Detects Polymarket vs own protocol automatically.
- ~~**Buy/sell panel routing → own AMM**~~ — Done. BetModal routes to protocol buy, Portfolio has sell flow.
- ~~**Real-time AMM price display + slippage preview**~~ — Done. On-chain quote via `protocolPricing.js`.
- ~~**Portfolio merge — positions from both Polymarket and own protocol**~~ — Done. Aggregated from trades table.
- **Wire pause/resolve admin buttons → contract calls via Safe** — Pending (Safe disabled for testnet, direct EOA used).

### 🟢 SECURITY REMEDIATION

#### From 2026-03-31 audit
- **C2** CLOB credentials in POST body — partially fixed (secret/passphrase now sealed server-side); finish review so no credential material leaks back to client
- **C3** DATABASE_URL exposed from frontend API — separate tier or edge functions with secrets
- **H1** No CSP (Content-Security-Policy)
- ~~**H3** `/mvp/admin` server-side auth~~ — Fixed. Privy JWT on all admin API calls.
- ~~**H4** `/api/user` requires Privy JWT~~ — Fixed. Bearer token required in production.
- **M6** No SRI on Tally.so script
- **M7** No CSRF protection on POST requests
- **M8** `localStorage` as source of truth for protocol mode
- **M9** Vite dev proxy pointing to production
- **M10** ethers.js v5.7.2 → upgrade to v6
- **Rate limiting** on API routes — none on any endpoint
- **Input validation** on all user-facing endpoints
- **Fuzz testing** on AMM edge cases

#### From 2026-04-15 audit (new findings)
- **Gamma proxy SSRF** — `path` query param unsanitized to upstream URL. Needs allowlist.
- **Auth bypass on preview deploys** — `PRIVY_JWT_VERIFICATION_KEY` unset skips all auth.
- **Admin auth = username match only** — no crypto binding; default hardcoded names.
- **CRON_SECRET fallback** — accepts User-Agent spoofing when env var unset.
- **Migration key in query string** — appears in server logs. Should use Authorization header.
- **Error messages leak DB internals** — PostgreSQL details in 500 responses.
- **No reentrancy guards** on PronosAMM/PronosAMMMulti buy/sell/redeem.
- **PronoBet emergencyWithdraw** — instant drain, no timelock/multisig.
- **PronoBet collectFee** — repeatable call drains unclaimed winnings.
- **Floating-point financial math** — indexer uses parseFloat on chain values before DB storage.
- **ensureProtocolSchema** — full-table UPDATE on every serverless cold start.
- **price-history** — allows 120 concurrent upstream fetches per request.

#### From 2026-04-16 audit (new findings)
- **Indexer liquidity is overstated** — snapshots sum outcome token reserves instead of estimating redeemable collateral. This makes liquidity/TVL look too high.
- **Portfolio cost basis drifts after partial exits** — indexer subtracts collateral received, not acquisition basis, so PnL becomes unreliable after sells.
- **CRON_SECRET is optional on all cron endpoints** — `auto-resolve` and `generate-markets` also run without mandatory shared-secret auth.
- **Legacy deploy docs still point to Base Sepolia + PronoBet** — `README.md` and `deployments.json` can send operators down the wrong deployment path.
- **First-load performance is weak** — production build currently ships a ~2.7 MB main JS chunk and ~965 kB admin chunk; Safe SDK/admin code is still expensive for a testnet flow that now uses direct wallets.
- **MVP access gate has a non-prod fallback password** — preview/dev deploys default to `mezcal` when env vars are missing.

### 🔵 MAINNET LAUNCH SEQUENCE (blocked by chain decision)
- Deploy all contracts to Arbitrum One (with reentrancy guards added)
- Third-party contract audit
- Transfer ownership to production Safe multisig
- Verify contracts on Arbiscan
- Seed liquidity for 5-10 launch markets (USDC)
- Test resolution flow through multisig
- 48h stability test
- E2E flow: register → buy → sell → resolve → redeem
- Full mobile responsiveness pass
- Operations runbook + incident response playbook
- Terms of service + privacy policy
- KYC / phone verification for prize eligibility

---

## PHASE 1: FOUNDATION & CORE CONTRACTS
**Target: April 14, 2026** ✅ COMPLETE

### 1.1 Architecture & Setup
- [x] ~~Define final architecture: hybrid (Polymarket aggregator + own protocol with admin switch)~~
- [x] ~~Decided: hybrid — start with Polymarket, admin switch to enable own contracts when ready~~
- [x] ~~Set up Foundry project structure + OpenZeppelin v5.6.1 + Solidity 0.8.24~~
- [ ] Configure CI/CD for contract compilation + tests

### 1.2 Core Smart Contracts
- [x] ~~`MarketFactory.sol` — Factory to create binary markets, manage lifecycle, fee distribution~~
- [x] ~~`MarketFactoryV2.sol` — Factory for multi-outcome markets (N outcomes)~~
- [x] ~~`PronosToken.sol` — ERC-1155 outcome tokens (YES/NO shares per market)~~
- [x] ~~`PronosTokenV2.sol` — ERC-1155 for multi-outcome markets~~
- [x] ~~`PronosAMM.sol` — CPMM (x*y=k) with dynamic fees: fee% = 5*(1-P)~~
- [x] ~~`PronosAMMMulti.sol` — Multi-outcome CPMM with fixed 2% fee~~
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
- [x] ~~Reproducible deploy script (`DeployProtocol.s.sol` + `DeployProtocolV2.s.sol`)~~
- [x] ~~Deploy v1 contracts to Arbitrum Sepolia~~
- [x] ~~Deploy v2 contracts to Arbitrum Sepolia~~
- [x] ~~Create test markets via Factory (Bayern Munich, Atletico vs Barcelona, etc.)~~
- [x] ~~Verify AMM receives liquidity and calculates prices correctly~~
- [ ] Document deployed addresses in `deployments.json`
- [ ] Replace stale Base Sepolia entries in `deployments.json` with current Arbitrum Sepolia v1/v2 addresses

### 1.5 Safe Multisig
- [x] ~~Setup guide created (`scripts/setup-safe.md`) with step-by-step instructions~~
- [x] ~~Safe SDK integrated in admin panel (`lib/safe.js` — protocol-kit + api-kit)~~
- [x] ~~Admin UI: create Safe, connect existing, propose/sign/execute transactions~~
- [x] ~~Supports Arbitrum Sepolia + Arbitrum One (chain selector in UI)~~
- [x] ~~Decision: testnet uses direct owner EOA for now; Safe stays as a mainnet path~~
- [ ] If desired, self-host Safe infra for Arbitrum Sepolia multisig rehearsal
- [ ] Transfer mainnet contracts to Safe once Arbitrum One deploy exists
- [ ] Test resolution flow through multisig on a supported network

---

## PHASE 2: FEATURES & UI
**Target: May 5, 2026** — ~90% complete

### 2.1 Frontend — Connect to Own Contracts
- [x] ~~Create protocol switch library (`lib/protocol.js`) — toggle Polymarket vs own protocol~~
- [x] ~~Contract interaction library (`lib/contracts.js`) — buy/sell/redeem, v1+v2, ABI definitions~~
- [x] ~~Protocol pricing library (`lib/protocolPricing.js`) — on-chain buy/sell quotes with BigInt math~~
- [x] ~~Dual-mode: support both Polymarket markets AND own protocol markets~~
- [x] ~~Market detail page — detect source (Polymarket vs own) and render accordingly~~
- [x] ~~Buy panel — route to own AMM for protocol markets with on-chain slippage preview~~
- [x] ~~Sell panel — exit preview modal with spot value, fee, impact, price after trade~~
- [x] ~~Pre-flight share balance validation before sell (user-friendly Spanish error)~~
- [x] ~~Show real-time price from AMM pool (CPMM calculation) + slippage preview~~
- [x] ~~Portfolio — merge positions from both Polymarket and own protocol~~
- [x] ~~Positions aggregated from deduped trades table (not materialized views)~~

### 2.2 Market Management (Admin)
- [x] ~~Admin panel web UI (`/mvp/admin`) — restricted to admin usernames~~
- [x] ~~4 admin tabs: Pending → Open → Closed → Resolved~~
- [x] ~~Polymarket approval gate (approve/reject/revoke with auto-translate)~~
- [x] ~~Create market form: v1 binary (Sí/No) + v2 multi-outcome (2-6 options)~~
- [x] ~~Protocol markets created on-chain via MarketFactory/MarketFactoryV2~~
- [x] ~~Markets list with resolve actions~~
- [x] ~~Edit Spanish translations inline for approved markets~~
- [x] ~~Fee formula display + distribution breakdown (70/20/10)~~
- [x] ~~Contract deployment status panel (shows deployed addresses)~~
- [x] ~~Auto-resolve cron (Polymarket outcome sync + deadline enforcement)~~
- [x] ~~Missing env var error messages list exactly which vars are needed~~
- [ ] Wire pause/resolve buttons to contract calls via Safe
- [x] ~~Load curated LATAM markets (Liga MX, World Cup, crypto, politics)~~

### 2.3 Wallet & Onboarding
- [x] ~~USDC balance display in nav bar (chain-aware)~~
- [x] ~~Multi-chain Privy config (Polygon + Arbitrum + Arbitrum Sepolia)~~
- [x] ~~Network switching utilities (`getRequiredChainId`, `switchToRequiredChain`)~~
- [x] ~~Chain indicator in user dropdown (Polygon / Arbitrum / Arb Sepolia)~~
- [x] ~~Auto network switch when user trades on wrong chain~~
- [x] ~~Deposit links (Polygon bridge / Arbitrum bridge)~~
- [x] ~~Gasless transaction helper (`lib/gasless.js`) — ready for Privy paymaster activation~~
- [x] ~~Onboarding: skip username button (auto-generate), showWalletUIs enabled~~
- [x] ~~Wallet linking UI in nav dropdown (show address, linked status, link button)~~
- [x] ~~Username upsert on conflict (re-registering updates instead of crashing)~~

### 2.4 Backend & Indexing
- [x] ~~Database schema: users, protocol_markets, trades, positions, price_snapshots, indexer_factory_state~~
- [x] ~~Auto-schema: `ensureProtocolSchema()` + `ensureUserSchema()` self-heal on cold start~~
- [x] ~~Migration endpoint (`/api/migrate`) — creates all tables + indexes~~
- [x] ~~Event indexer (`/api/indexer`) — per-factory block state, v1+v2 event processing~~
- [x] ~~Indexer dedup: `insertTrade()` with RETURNING id skips duplicate events~~
- [x] ~~Batched indexing: 5×2000 blocks per cron run~~
- [x] ~~Price snapshots from AMM reserves~~
- [x] ~~Vercel Cron: indexer runs every minute~~
- [x] ~~API: `/api/markets` — list protocol markets with latest price + trade volume~~
- [x] ~~API: `/api/market?id=` — detail + 50 price snapshots + 20 recent trades~~
- [x] ~~API: `/api/positions?address=` — positions aggregated from trades with P&L~~
- [x] ~~API: `/api/user` — GET + POST with auto-schema, error logging~~
- [ ] Fix liquidity snapshot math so displayed liquidity matches redeemable collateral, not reserve sum
- [ ] Fix position cost basis / P&L after partial sells and early exits
- [ ] Move migration/indexer/waitlist manual auth away from query-string secrets

### 2.5 Monitoring & Quality
- [x] ~~Sentry integration (`@sentry/react` + ErrorBoundary, privacy-safe, prod-only)~~
- [x] ~~API error logging (structured JSON logger + `withLogging` wrapper)~~
- [x] ~~Bitso stub endpoint (`/api/bitso` — mock ticker + quote for MXN↔USDC)~~
- [ ] Build-size / cold-load pass: reduce initial JS, split Safe/admin dependencies, speed up first refresh

### 2.6 Onboarding Campaign (new since 2026-04-15)
- [x] ~~Leaderboard widget (mock top-10, medals, streak, prizes, cycle countdown)~~
- [x] ~~EarnMXNP section: daily claim + streak bonus (+20/day), signup bonus (250 MXNP)~~
- [x] ~~Social connect tasks via Privy useLinkAccount (Twitter/Instagram/TikTok OAuth)~~
- [x] ~~Follow tasks locked until account connected (verified via user.linkedAccounts)~~
- [x] ~~Referral link with copy button + functional WhatsApp/Twitter/Telegram share URLs~~
- [x] ~~Social handles: @pronos.latam (IG), @pronos.io (TikTok), @pronos_io (X)~~
- [x] ~~Toast notifications for MXNP credits~~
- [x] ~~All state persisted in localStorage (visual-only, no real money)~~
- [ ] Backend: real MXNP points DB, leaderboard API, referral tracking
- [ ] Admin: social task verification queue
- [ ] Prize distribution workflow

### 2.7 Market Content & Resolution
- [x] ~~`market_resolutions` table + `/api/resolutions` endpoint~~
- [x] ~~Admin "Resolver" UI to set winners~~
- [x] ~~"Resueltos" tab + badges on resolved cards~~
- [x] ~~Resolved-state detail page: banner, winner card, greyed-out losers~~
- [x] ~~Resolved markets show 100/0 instead of stale percentages~~
- [x] ~~Auto-resolve cron (every 30 min): Gamma query + auto-close expired~~
- [x] ~~Client-side `isExpired()` hides dead markets instantly~~
- [x] ~~Daily AI market generation pipeline (Claude Sonnet 4.5 + Google News RSS)~~
- [x] ~~Admin review UI: Pendientes / Aprobados / Rechazados tabs~~

### 2.8 Graphs & Price History
- [x] ~~`/api/price-history` batch proxy (edge-cached 5 min)~~
- [x] ~~Sparkline rewrite: Catmull-Rom smoothing, glow, hover tooltip with timestamp~~
- [x] ~~Real CLOB price history wired into MarketsGrid, MarketDetail, Hero~~
- [x] ~~Interactive hover: crosshair + dot + "12 abr, 14:00 · 65%" tooltip~~

### 2.9 i18n & Translation
- [x] ~~EN/ES toggle across entire UI (430+ i18n keys)~~
- [x] ~~`localizedTitle()` / `localizedOptions()` helpers~~
- [x] ~~Polymarket market translation via Anthropic Haiku + scraping fallback~~
- [x] ~~Admin inline translation editing~~
- [x] ~~Common label auto-translate (Yes/Sí, Draw/Empate, Other/Otro)~~

### 2.10 E2E Testing (Testnet)
- [ ] Full flow: register → buy shares → sell shares → resolution → redemption
- [ ] Embedded wallet transactions work without errors
- [ ] Prices and slippage calculate correctly
- [ ] Admin can resolve a market manually via multisig
- [ ] Liquidity / volume / P&L stay correct after buys plus partial exits

---

## PHASE 3: HARDENING & MAINNET
**Target: May 31, 2026**

### 3.1 Mainnet Deployment
- [ ] Add reentrancy guards to PronosAMM + PronosAMMMulti
- [ ] Add `minOut` / slippage protection to protocol buy + sell functions
- [ ] Deploy all contracts to Arbitrum One
- [ ] Transfer ownership to production Safe multisig
- [ ] Verify all contracts on Arbiscan
- [ ] Frontend points to mainnet contracts
- [ ] Seed liquidity for 5-10 launch markets (USDC)

### 3.2 Security Hardening

#### CRITICAL — Must fix before mainnet
- [x] ~~**C1** Admin auth moved to server-side (`/api/user` returns `isAdmin` flag)~~
- [ ] **C2** CLOB credentials review — finish server-side session flow and verify no credential material leaks to client
- [ ] **C3** DATABASE_URL exposed from frontend API — separate database tier
- [x] ~~**C4** Admin usernames removed from frontend bundle, checked server-side only~~
- [ ] **NEW** Gamma proxy SSRF — path allowlist
- [ ] **NEW** Auth bypass on preview deploys — enforce auth on all envs
- [ ] **NEW** Admin auth strengthening — crypto binding beyond username match
- [ ] **NEW** CRON_SECRET must be mandatory (no User-Agent fallback)
- [ ] **NEW** Remove fallback password from `/api/mvp-access` on preview/dev deploys

#### HIGH — Fix before launch
- [ ] **H1** No CSP (Content-Security-Policy)
- [x] ~~**H2** X-Frame-Options: DENY added via vercel.json~~
- [x] ~~**H3** `/mvp/admin` server-side auth — Privy JWT on all admin API calls~~
- [x] ~~**H4** `/api/user` requires Privy JWT Bearer token in production~~
- [ ] **NEW** Rate limiting on all API endpoints
- [ ] **NEW** Error message sanitization (remove DB details from 500s)
- [ ] **NEW** Migration key → Authorization header (not query string)
- [ ] **NEW** Waitlist export key → Authorization header (not query string)

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
- [ ] **NEW** Float → BigInt financial math in indexer
- [ ] **NEW** ensureProtocolSchema: conditional UPDATE (skip if already lowercase)
- [ ] **NEW** Reduce batch pressure in `/api/price-history` (120 concurrent upstream fetches is too high)
- [ ] **NEW** Replace stale Base Sepolia / PronoBet docs with current Arbitrum protocol docs

#### Passed
- ~~No XSS~~ ~~No eval()~~ ~~HTTPS forced (308)~~ ~~No mixed content~~ ~~No X-Powered-By~~ ~~Privy handles sessions correctly~~

#### Smart Contract
- [ ] Reentrancy guards on buy/sell/redeem (all contracts)
- [ ] Slippage-safe contract API (`minOut`) on buy/sell
- [ ] PronoBet: add timelock to emergencyWithdraw or deprecate
- [ ] PronoBet: fix collectFee repeatable-call drain
- [ ] Event emissions for feeCollector changes
- [ ] Third-party audit
- [ ] Fuzz testing on AMM edge cases

### 3.3 Operations
- [ ] Fee system operational (dynamic fees collected, distributed 70/20/10)
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
- [ ] Rewrite `README.md` / `deployments.json` so they describe Arbitrum v1/v2, not the old Base Sepolia `PronoBet` flow

### 3.5 Launch Prep
- [ ] 5-10 curated markets live and tradeable
- [ ] World Cup 2026 markets ready (Mexico, Argentina, Brazil, Colombia)
- [ ] Landing page (pronos.io) updated to point to live product
- [x] ~~OG metadata, Twitter cards, favicon added~~
- [x] ~~Nav responsive on tablet (≤1024px) and mobile~~
- [x] ~~Waitlist button on public-facing bet slip~~
- [x] ~~Polymarket/Polygon branding removed from MVP~~
- [ ] Mobile responsiveness final check
- [ ] Terms of service + privacy policy
- [ ] KYC / phone verification for prize eligibility

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
- [ ] Analytics (user funnel, trade volume, retention)

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
| 2026-04-15 | **Onboarding campaign UI:** Leaderboard widget (mock top-10, prizes, countdown) in Portfolio sidebar. EarnMXNP section with daily claim + streak, social connect via Privy OAuth (X/IG/TikTok), referral link + WhatsApp/Twitter/Telegram share. |
| 2026-04-15 | **Layout restructure:** Category bar sticky below nav (like pronos.io). Portfolio two-column layout (positions left, leaderboard right). Social handles fixed (@pronos.latam, @pronos.io, @pronos_io). |
| 2026-04-15 | **Protocol v2:** MarketFactoryV2 + PronosAMMMulti + PronosTokenV2 deployed to Arbitrum Sepolia. Admin creates v2 multi-outcome markets. |
| 2026-04-15 | **Indexer hardening:** Per-factory block state, insertTrade with RETURNING id (dedup), positions aggregated from trades table. |
| 2026-04-15 | **Sell flow:** Exit preview modal with spot value, fee, slippage, price impact. Pre-flight ERC-1155 balance validation. `protocolPricing.js` for on-chain buy/sell quotes. |
| 2026-04-15 | **User API:** Auto-schema for users table, upsert on conflict, error logging, null username handling. Wallet linking UI in nav dropdown. |
| 2026-04-15 | **BetModal fix:** Removed `t` from useEffect deps — was causing infinite loop that prevented slippage from ever loading. |
| 2026-04-15 | **Security audit:** Full codebase review — 3 critical, 10 high, 7 medium, 10 low findings documented. |
| 2026-04-16 | **Roadmap refresh + audit:** Build passes. Confirmed auth/cron hardening gaps, stale Base Sepolia docs, incorrect liquidity snapshots, drifted portfolio cost basis after partial exits, and large JS bundles. Added readiness snapshot: 78% closed-testnet, 42% mainnet. |
| 2026-04-17 | **points-app:** parallel AMM mode (N outcomes as N binary legs), cascading resolution on parent → legs. Weather / charts / entertainment generators with adaptive buckets. |
| 2026-04-18 | **points-app:** 13-generator pipeline, daily cron, admin approval queue with Aprobar todos, category tabs (Trending / Deportes / Música / México / Política / Crypto / Por resolver / Resueltos). |
| 2026-04-19 | **points-app:** Per-category routes `/c/:slug`, sport sub-filter (soccer / baseball / NBA / F1 / tennis / golf), soccer league sidebar (UCL / La Liga / Premier / Serie A / Bundesliga / Liga MX / MLS), Finanzas tab. |
| 2026-04-20 | **points-app:** World Cup 2026 tab `/c/world-cup` — real FIFA draw fixtures (72 group matches), hero countdown, 4×3 group grid with team badges, symmetric bracket tree, Group Winner parallel markets, Mexico Path composite. |
| 2026-04-21 | **points-app:** Buy drawer variant of PointsBuyModal — slides from right via createPortal, escapes ancestor transforms. Clicking any outcome on a card opens the drawer preselected. Slippage guards on buy/sell (`minSharesOut` / `maxAvgPrice` / `minCollateralOut`) — server holds row lock, rejects with 409 `price_moved`. |
| 2026-04-22 | **points-app:** 🔧 Retrofit resolvers unified (F1 + LMB + golf image rebuild in one pass), 🏆 Progresar Mundial admin endpoint (standings → R32 spawn), ⚡ Resolver ahora + 🩺 Diagnóstico resolver admin buttons. Portfolio OK-button dismisses losing resolved positions. Finanzas + Béisbol sub-filter (MLB + LMB). |
| 2026-04-23 | **Consolidation decision.** Rather than a separate `mvp-v2` branch off main, the MVP evolves on `points-app` directly — on-chain engine will be ported INTO the points-app when we're ready for mainnet. ROADMAP rewritten with a 6-milestone plan (M1 done). Hybrid oracle, news feed, and OAuth social linking un-sidelined. OAuth social linking for X shipped with the shared oauth.js helper (PKCE + signed state cookie); IG + TikTok scaffolded for bio-code verification to skip Meta review. LMB fake fixtures cleared — real schedule didn't match, admin-entry only until we have a licensed source. |

---

*Last updated: 2026-04-16*

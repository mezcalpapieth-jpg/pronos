# PRONOS Repo Audit vs PRD

Date: April 2, 2026  
Branch reviewed: `main`  
Git sync status: `git pull` returned **Already up to date**

---

## Executive Summary

The repository contains a real and meaningful MVP foundation, but it is **not yet a single coherent mainnet-ready product**. The codebase currently mixes **two different product tracks**:

1. A **legacy Base Sepolia parimutuel flow** centered on `PronoBet.sol`
2. A **newer PRD-aligned protocol track** centered on `PronosToken.sol`, `PronosAMM.sol`, `MarketFactory.sol`, the React `/mvp` app, Safe integration, and serverless APIs

The English PRD you asked for is aligned much more closely with the **second track**. That means the PRD is directionally correct, but the latest repo still contains older Base-era code, docs, and operational assumptions that would confuse any external development team unless they are cleaned up first.

### Overall assessment

| Area | Current state |
| --- | --- |
| Product direction | Clear in PRD, but not yet fully reflected in one canonical code path |
| Core protocol contracts | Strong foundation |
| Frontend MVP shell | Strong |
| Own-protocol trading integration | Partial / incomplete |
| Admin + Safe multisig tooling | Good scaffolding, not fully wired |
| Backend + indexing | Good foundation |
| Security hardening | Baseline work done, major items still open |
| MoonPay / UMA / real on-ramp | Not implemented yet |
| Mainnet readiness | Not ready yet |

### Practical conclusion

You have enough built to brief a dev shop seriously, but before handoff you should make one thing explicit:

- **Canonical architecture:** Arbitrum + `PronosToken` / `PronosAMM` / `MarketFactory` + React MVP
- **Legacy track:** Base / `PronoBet` is legacy and should either be archived or clearly labeled as deprecated

If you do not make that distinction, a third-party team could scope the wrong product.

---

## What Is Actually Present in the Repo Today

### 1. Contracts and protocol foundation

This is the strongest area of the repo.

Verified in code:

- `contracts/src/PronosToken.sol`
- `contracts/src/PronosAMM.sol`
- `contracts/src/MarketFactory.sol`
- `contracts/script/DeployProtocol.s.sol`
- `contracts/test/PronosProtocol.t.sol`

Verified by test run:

- `forge test --offline` passes
- **43 tests passed**
- `30` tests for `PronosProtocol.t.sol`
- `13` tests for `PronoBet.t.sol`

What is clearly implemented in the newer contract path:

- ERC-1155 outcome tokens
- factory-created markets
- CPMM AMM
- dynamic fee logic
- fee collector support
- fee distribution logic
- pause / unpause
- resolve / redeem lifecycle
- Foundry-based test suite

### 2. Legacy contract path still exists

The older parimutuel contract is still active in the repo:

- `contracts/src/PronoBet.sol`
- `contracts/test/PronoBet.t.sol`
- `deployments.json`
- `scripts/config.ts`
- `README.md`
- `CONTEXT.md`

This older track is still wired around:

- Base Sepolia
- `PronoBet`
- parimutuel settlement
- 2% fee at resolution
- Mexico / South Africa match-specific logic

This is the single biggest architectural inconsistency in the repo.

### 3. Frontend MVP structure

The React MVP is real and substantial.

Verified pages:

- `frontend/app/src/pages/Home.jsx`
- `frontend/app/src/pages/MarketDetail.jsx`
- `frontend/app/src/pages/Portfolio.jsx`
- `frontend/app/src/pages/Admin.jsx`

Verified platform features in code:

- React SPA with `/mvp` routing
- Privy login with email / Google / wallet
- embedded wallet support
- username creation flow
- Sentry integration
- Polymarket Gamma proxy
- Polymarket CLOB proxy
- market grid
- market detail page
- portfolio page
- admin panel shell
- password gate for staging

### 4. Backend and indexing

This area is more mature than the public-facing app might suggest.

Verified APIs:

- `frontend/api/markets.js`
- `frontend/api/market.js`
- `frontend/api/positions.js`
- `frontend/api/indexer.js`
- `frontend/api/migrate.js`
- `frontend/api/user.js`
- `frontend/api/gamma.js`
- `frontend/api/clob.js`
- `frontend/api/bitso.js`

Verified infrastructure pieces:

- Neon PostgreSQL schema migration endpoint
- on-chain indexer for protocol markets
- market / trade / position / snapshot persistence
- Vercel cron configuration for the indexer
- structured API logging helper

### 5. Safe multisig scaffolding

This is present and meaningful.

Verified:

- `frontend/app/src/lib/safe.js`
- Safe transaction service support for Arbitrum Sepolia and Arbitrum One
- create / connect / propose / confirm / execute transaction helpers
- admin UI panels for Safe creation and pending transaction handling

This is one of the better-built parts of the MVP, although it is still not fully connected to the create / pause / resolve admin actions.

---

## What Is Only Partial, Mocked, or Scaffolded

These features exist in some form, but are **not truly done** in the repo.

### 1. Own protocol mode exists, but is not fully functional

The app includes a protocol switch in:

- `frontend/app/src/lib/protocol.js`
- `frontend/app/src/pages/Admin.jsx`

But the actual implementation is incomplete:

- contract addresses for the own protocol are still `null`
- protocol mode is stored in `localStorage`
- the frontend is still centered on Polymarket flows for trading
- the "own protocol" path is mostly UI scaffolding rather than a full product flow

### 2. Market creation, pause, and resolve are not wired end to end

In `frontend/app/src/pages/Admin.jsx`:

- the market creation form is UI-only
- create market returns a success message without sending a real transaction
- pause and resolve actions still use placeholder alerts
- contract status cards still show pending deployment values

So the admin panel looks advanced, but the core admin actions are not yet live.

### 3. Own-protocol frontend trading is not connected

This is one of the main gaps relative to the PRD.

Evidence:

- `frontend/app/src/components/BetModal.jsx` still routes the trade flow through Polymarket CLOB logic
- `frontend/app/src/lib/clob.js` is the active trade implementation
- `frontend/app/src/components/MarketsGrid.jsx` loads Gamma markets plus local mocks
- `frontend/app/src/pages/Portfolio.jsx` only loads Polymarket positions
- `frontend/api/markets.js` and `frontend/api/positions.js` exist, but the main MVP UX is not yet centered on them

So the internal protocol has contract and backend foundations, but not a finished user-facing trade flow.

### 4. Portfolio is not unified yet

The PRD describes a unified portfolio. The repo does not have that yet.

Current state:

- frontend portfolio page shows Polymarket positions only
- internal protocol positions have their own API
- there is no merged view across both sources

### 5. Bitso exists only as a mock

`frontend/api/bitso.js` is a simulation layer, not a production integration.

What exists:

- ticker stub
- quote stub
- mock exchange rate logic

What does not exist:

- live Bitso API integration
- SPEI settlement
- real MXN balance handling
- real deposit / withdrawal flow

### 6. Gasless support is a helper, not a confirmed live feature

`frontend/app/src/lib/gasless.js` is a helper layer only.

What exists:

- transaction helper
- chain-aware token approval helper
- embedded-wallet detection

What is still missing:

- confirmation that Privy paymaster is configured and working in production
- end-to-end gas-sponsored transaction validation

---

## What Is Missing Relative to the PRD

These are the largest PRD items that are not actually implemented in the latest repo.

### 1. MoonPay

MoonPay is not integrated.

No verified MoonPay widget, webhook flow, deposit flow, or frontend funding step was found in the repo.

### 2. UMA

UMA is not integrated.

No verified UMA adapter contract, callback flow, or frontend/admin flow for UMA-backed market resolution was found.

### 3. Arbitrum deployment completion

The PRD assumes Arbitrum is the deployment target, but the repo does not yet show a completed Arbitrum deployment lifecycle.

Missing or incomplete:

- deployed Arbitrum contract addresses in canonical config
- confirmed Arbitrum Sepolia deployment records
- confirmed Arbitrum One deployment records
- verified ownership transfer to Safe
- verified multisig resolution flow against deployed contracts

### 4. Own-protocol market trading in the live MVP

This is still missing end to end:

- market detail page that truly routes own-protocol markets to `PronosAMM`
- buy / sell / redeem flow against the live internal contracts
- slippage preview from `estimateBuy()` / `estimateSell()`
- real own-protocol positions in the live user journey

### 5. Security hardening items

The PRD and roadmap correctly keep these in scope because they are still missing:

- Content-Security-Policy
- CSRF protection
- rate limiting
- stronger server-side admin enforcement
- protection for `/api/user`
- server-side handling of CLOB credentials
- stricter separation of database access
- SRI on external scripts
- full input validation across endpoints

### 6. End-to-end test coverage

The contracts are tested, but the full product flow is not yet verified in repo code as an end-to-end application.

Still missing:

- user registration -> trade -> sell -> resolve -> redeem test
- live testnet flow for internal protocol
- multisig test flow tied to deployed contracts
- on-ramp and onboarding validation

---

## Where the Repo and PRD Still Conflict

This section matters a lot for external handoff.

### 1. Base vs Arbitrum

The PRD says Arbitrum is the selected network.

But these repo files still point to Base or Base Sepolia:

- `README.md`
- `CONTEXT.md`
- `deployments.json`
- `contracts/foundry.toml`
- `scripts/config.ts`
- `scripts/setup-safe.md`

This means the codebase is **not fully migrated at the repository level**, even if the newer roadmap and frontend pieces talk about Arbitrum.

### 2. Old parimutuel product vs new AMM product

The repo still contains both:

- `PronoBet.sol` parimutuel product
- `PronosAMM.sol` + `MarketFactory.sol` AMM product

The PRD clearly wants the AMM-based internal protocol, not the older parimutuel path.

This needs a canonical decision in the repo:

- either archive the legacy contract path
- or explicitly label it as deprecated / legacy / previous MVP

### 3. "Built" in roadmap vs "actually live"

Several items are marked as done in `ROADMAP.md`, but are still only partially complete in the code.

Examples:

- own-protocol mode exists, but trading is not fully wired
- admin panel exists, but create / pause / resolve are not fully connected
- contract status panel exists, but addresses are still pending
- backend APIs exist, but frontend does not yet rely on them as the main product path

So the roadmap is useful, but it should not be treated as a literal deployment-readiness checklist without a code-based verification pass.

---

## Security Status: What Is Real vs What Still Needs Work

### Security work that is genuinely present

Verified in code:

- restrictive response headers in `frontend/vercel.json`
- server-side admin username evaluation in `frontend/api/user.js`
- Sentry with some privacy filtering
- restricted CORS patterns across API routes

### Security issues that remain visibly open

#### CLOB credentials still pass through the client-visible request body

Verified in:

- `frontend/api/clob.js`

The proxy still accepts `apiKey`, `secret`, and `passphrase` from the request body, which matches the known open security issue.

#### `/api/user` is still enumerable

Verified in:

- `frontend/api/user.js`

Any caller with a `privyId` can query username and admin status. That matches the still-open hardening concern.

#### Admin access is still ultimately decided in the client routing layer

Verified in:

- `frontend/app/src/pages/Admin.jsx`

The page shows a 404-style view for unauthorized users, but this is still frontend routing logic rather than full server-side route protection.

#### No CSP is visible in deployment config

Verified in:

- `frontend/vercel.json`

There is no Content-Security-Policy header there today.

#### Protocol mode is stored in localStorage

Verified in:

- `frontend/app/src/lib/protocol.js`

This matches the roadmap's own warning about local storage being the source of truth.

---

## Suggested Repo-Level Interpretation of the PRD

If we translate the PRD into what the repo **really supports today**, the product is closer to this:

### Built enough to show and discuss

- internal AMM contract architecture
- strong contract test coverage
- React MVP shell
- Polymarket-based live market UX
- admin panel and Safe scaffolding
- backend schema and indexer
- serverless API structure
- monitoring basics

### Ready for an external dev team to complete

- Arbitrum deployment and environment cleanup
- own-protocol frontend wiring
- admin-to-contract transaction wiring
- MoonPay integration
- UMA integration
- security hardening
- unified portfolio
- testnet E2E validation

### Not ready to claim as finished

- internal protocol live trading
- production on-ramp
- hardened admin security
- mainnet operational readiness
- coherent chain/config/documentation alignment

---

## Recommended Next Steps Before Dev-Shop Handoff

### Priority 1: Clean up the canonical story

- Decide that Arbitrum + `PronosToken` / `PronosAMM` / `MarketFactory` is the official path
- Mark `PronoBet`, Base Sepolia docs, and old deployment metadata as legacy
- Rewrite `README.md`, `CONTEXT.md`, and script docs so they no longer contradict the PRD

### Priority 2: Finish the own-protocol path

- wire market creation to `MarketFactory.createMarket()`
- wire pause / resolve to Safe transaction flows
- wire market detail and bet modal to internal AMM functions
- surface protocol market data in the live frontend instead of only in backend APIs

### Priority 3: Close critical security gaps

- remove CLOB secrets from client-visible request flows
- harden `/api/user`
- add CSP
- add CSRF protection
- add rate limiting and input validation

### Priority 4: Keep roadmap items such as UMA and MoonPay in the PRD

These should remain in the English PRD because they are part of the intended product direction.

Recommended framing:

- **MoonPay** = planned launch-critical funding integration
- **UMA** = planned resolution mechanism for political / complex markets
- **Bitso real integration** = post-MVP or medium-priority roadmap item
- **push notifications / leaderboard / user-generated markets** = nice-to-have or post-MVP

That preserves strategic intent without overstating what is already built.

---

## Bottom Line

The latest repo does support a strong PRD, but the repo and the PRD are **not yet fully aligned**.

The best way to describe the current state honestly is:

- **Protocol architecture:** real
- **MVP frontend:** real
- **backend/indexing:** real
- **own-protocol live user flow:** not finished
- **MoonPay / UMA / production hardening:** still to build
- **repo coherence:** needs cleanup before external handoff

That is still a very workable position. It means you are no longer starting from zero, but you should present the codebase as a **solid foundation with clear remaining milestones**, not as a fully integrated mainnet-ready system.

# Stock Points: cofounder demo and Pointbreak rollout

October 12, 2026. Implementation branch: `stock-points`. Implementation validated in isolated local staging; no production release has been performed.

## What can be shown now

The real-data local demo runs at **http://127.0.0.1:5180/points/stocks**. Port 5178 now proxies to the same isolated API after fixing its inactive proxy target. Its API uses the isolated Neon branch `stock-points-staging-2026-10-12`; it shares no writes with the production database. If the local session is missing, use **http://127.0.0.1:5180/api/stock-staging/session**. This local-only testing shortcut was explicitly approved by the user. Normal deployed sign-in remains the existing session flow.

A useful presentation sequence:

1. Browse 13 tradable instruments; search and filter categories, including Crypto. ETF listings and filters are removed. The heading is “Compra acciones desde 100 MXNP” and the subtitle is “Pon tu portafolio a trabajar, sigue el mercado.”
2. Open Nvidia. Switch 7D to 4H to show one-hour versus five-minute candles. Hover/tap a candle to show its USD close and explicitly labeled UTC start time. Compare that with the chart fetch time and live order-book time/age; detail prices poll independently every three seconds.
3. Enter an MXNP budget, review the units, actual fee, FX and rounding remainder, then confirm the expiring quote.
4. Open Portfolio to show spendable cash, holding value, open/realized PnL and history. Partially sell and then use sell-all to turn exposure back into spendable points.
5. Open Torneo to show realized stock PnL. Open gains remain unrealized in the Portfolio monitor until sold. User buys/sells count as activity; holding or automatic cutoff sales do not. At cutoff, all stocks are sold before the photo. On rollover, points reset and no stock holdings or PnL carry into the next tournament.

The demo currently retains a small 0.024-NVDA position purchased with a 100-MXNP request, with about 399.31 MXNP spendable cash after an additional Solana buy/sell check. Its value and PnL continue to move with the live reference price.

The demonstrated browser buy requested 400 MXNP and filled 0.096 NVDA for 398.77 MXNP including fee. Two sales of 0.048 NVDA returned 198.96 and 199.03 MXNP net. The wallet then showed 499.22 MXNP and Portfolio/tournament stock PnL about -0.78, matching the net wallet change after all units were sold. These are historical staging observations, not fixed prices or guaranteed future fills.

The Solana browser check requested 100 MXNP, filled 0.04 SOL for 80.35 MXNP including fee and kept the quantity-rounding remainder. Sell-all returned 80.23 MXNP, removed the holding and updated available cash from 319.08 to 399.31 MXNP. Processing kept the estimates visible and ended after the committed response. An expired quote was explicitly reviewed again rather than silently replaced. These are historical staging observations.

Tradable reference prices come from Hyperliquid native and xyz perpetuals. Transactions simulate exposure using MXNP points; they do not acquire shares or execute externally. On-chain crypto-funded execution is a subsequent product phase.

## Verified readiness

| Area | Evidence |
| --- | --- |
| Real data | 14 displayed instruments available through Pronos, 13 tradable with points; Banxico FIX 18.4163 dated October 9; actual completed one-minute cutoff candle retrieved. Native/xyz venue routing and explicit spot market-ID joins verified. |
| Browser flow | Authenticated buy, partial sale, sell-all, wallet debit/credit, units, fee/proceeds and Portfolio history verified on local real-data staging. |
| Expanded UI | Solana buy/sell-all and five-minute candle readout verified. ETFs and the index/ETF switch are removed. All 13 current instrument logos are local; the 390px catalogue had no horizontal overflow. |
| Concurrency | Six live checks passed across three independent Postgres connections: competing stock buys, stock/prediction purchase race, duplicate retry, simultaneous sell-all, partial/full accounting, reset contention/replay. |
| Scoring | Automated tests verify realized-only tournament stock PnL after fees and separate open Portfolio PnL, reinvestment without double counting, common offline marks, wallet equity and immutable cutoff snapshots. |
| Provider outage | Tests verify unavailable/stale books cannot trade, holdings survive, old values are marked stale and missing cutoff prices defer the photo. |
| Focused checks | 79 stock, chart, tournament, snapshot, wallet and leaderboard tests pass, including rejection of removed instruments and Vercel function tracing. |
| Build | Points production build passes; existing dependency annotation and large-bundle warnings remain. |
| Function packaging | Vercel's static evaluator failed when the requested sell quantity started as `null` and was later used in BigInt subtraction. It now starts as `0n`; all 380 API modules trace successfully. A development-only tracer regression test covers the stock endpoints and scoring dependencies. |
| Feature control | Main server and frontend flags default off in production; separate trading pause preserves valuations and stock scoring. |

The local harness runs the minute collector directly. Vercel cron delivery, preview routing and normal sign-in still need validation on the actual preview deployment. The on-chain phase is not part of this readiness claim.

## Steps to bring it into Pointbreak

1. Review the local diff and commit the stock implementation changes. Keep unrelated approved-market reports out of the stock commits. The first two checkpoints are `9ee1d0f` and `2a08733`; include the subsequent scoring/staging changes as well.
2. Create an isolated preview environment with both database URLs on its own Neon branch. Set `BANXICO_API_TOKEN`, the normal `POINTS_SESSION_SECRET`, `CRON_SECRET` and `POINTS_STOCKS_ENABLED=true`. Build with `VITE_POINTS_STOCKS_ENABLED=true`.
3. Dry-run, then apply `frontend/api/scripts/migrate-stocks.mjs` with `--expected-host=<actual-preview-host> --apply`. Schema v3 creates six stock tables, adds snapshot breakdown fields and records user/automatic trade origins. Never paste or log a database connection string in the checklist.
4. Deploy the preview. Use normal authentication to run the buy/partial-sell/sell-all journey; verify the shared prediction wallet, leaderboard, history and minute cron. `/api/points/stocks/health` reports schema version, available assets and FX date.
5. Cherry-pick the reviewed stock commits into the latest `pointbreak`. Resolve any changes to cycle snapshots, leaderboard or Portfolio against current Pointbreak behavior, then rerun focused tests and rebuild Points with its frontend flag.
6. After release approval, apply the guarded migration to the approved production host and deploy. Activate the server feature and minute cron together, then verify the deployed build and a scoped real session flow. Do not claim the beta is live from a pushed commit alone.
7. If trading must stop, set `POINTS_STOCKS_TRADING_ENABLED=false`. Keep `POINTS_STOCKS_ENABLED=true` once holdings exist so current positions, stock PnL and terminal snapshots remain represented.

No production migration or release approval is requested merely to prepare these steps. This document records the reviewed implementation path; the final release is a separate action.

## Reproducible checks

```sh
cd frontend
npm run test:stocks
node --test api/_lib/stock-*.test.js api/_lib/points-tournament-*.test.js api/_lib/points-wallet-leaderboard.test.js api/points/leaderboard.test.js api/points/cycles.test.js app/points/src/lib/stockApi.test.js app/points/src/lib/stockChart.test.js
node --env-file=/absolute/private/verification.env api/scripts/verify-stock-staging.mjs
cd app
npm run build:points
```

The live verification script requires the explicit staging host/branch guard, uses a unique disposable fixture prefix, restores the active cycle, and cleans up only its own fixtures. Keep the verification database separate from the cofounder demo to prevent page polling from interfering with reset tests.

Private env files currently live under `/private/tmp/pronos-stock-staging/`, mode 0600, and are excluded from Git. The two test branches autosuspend after five minutes. Archive/delete them deliberately once the preview supersedes this local demo; do not remove the branch backing a running presentation.

## On-chain decisions still required

Choose the actual instrument (tokenized security or derivative), execution venue, chain and collateral. Define how the Pronos currency funds it, custody/signing, fee model, supported jurisdictions and product permissions. Then add an execution adapter with reconciliation, funding/withdrawal flows and transaction status. The off-chain points ledger and its tournament rules can remain a separate product mode using the same UI.

## Hyperliquid instrument check, October 12, 2026

This is dated research for the future on-chain phase. The current Points catalogue excludes ETFs; the earlier SPYx price preview and spot adapter have been removed.

Checked the live public Info API's native and all listed builder perpetual venues, plus spot metadata, books and candles. Catalogue availability is a dated observation; recheck before choosing an execution venue.

| Requested exposure | Current verified reference | Points behavior |
| --- | --- | --- |
| Bitcoin | Native `BTC` perpetual; wrapped spot `UBTC` also listed | BTC points trading added using the native perpetual reference. |
| Ethereum | Native `ETH` perpetual; wrapped spot `UETH` also listed | ETH points trading added using the native perpetual reference. |
| Solana | Native `SOL` perpetual; wrapped spot `USOL` also listed | SOL points trading added and browser buy/sell-all verified. |
| SpaceX | Active `xyz:SPCX` perpetual; older `vntl:SPACEX` is delisted | SPCX points trading added. A similarly named token alone is not evidence of stock backing. |
| S&P 500 index | Active `xyz:SP500` perpetual | Index points trading retained; ETF switching removed. |
| S&P 500 ETF | Active spot `@703`, wrapped SPYx token | Removed from the Points product at the user's request. |
| Dow Jones / DIA ETF | No matching active market found in this catalogue check | Omitted rather than inserting an unrelated or fabricated instrument. |

The [Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) documents venue discovery and spot market identifiers. [Hyperliquid contract specifications](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications) describe perpetual derivatives. [TradeXYZ's official specification index](https://docs.trade.xyz/perpetuals/specifications-and-schedules/specification-index.md) identifies SPCX and its schedule; the [US equity-index specifications](https://docs.trade.xyz/perpetuals/markets/equity-indices/us.md) distinguish SP500 index exposure. A perpetual does not represent owned stock and involves funding, margin and liquidation mechanisms if executed on-chain.

There is a more relevant buy-and-hold path than perpetuals: [xStocks announced live Hyperliquid spot markets](https://xstocks.com/news/xstocks-goes-live-on-hyperliquid-bringing-the-markets-deepest-tokenized-equities-framework-to-traders), including SPYx. Its tokens provide economic exposure to backed reference assets; its issuer states that holders do not own or gain shareholder rights to the underlying securities. This must remain distinct from direct stock ownership.

The former SPYx preview pinned token ID `0x29067197b3125c8b82ad0f338e4a31b2` and wrapper `0xe7e553cd128f0011777323a0b44a7b96ea1cb540`. Hyperliquid metadata matches that wrapper to the current HyperEVM v2 address in the [official SPYx asset registry](https://api.xstocks.fi/api/v2/public/assets/SPYx). That preview displayed the market price per wrapped token, with independent units from ETF shares. See [wrapped xStocks documentation](https://docs.xstocks.fi/developers/wrapped-xstocks) for multipliers, conversions and independent price references.

The instruments have different units, prices, liquidity, backing and execution mechanics. The user chose to remove the ETF/index switch to simplify the Points experience.

Before enabling SPYx points trading, define and implement a reliable tournament cutoff valuation for sparse spot trades. Cutoff settlement prefers the completed one-minute candle; when it has no trades, only a shared pre-cutoff mark no older than 90 seconds is accepted. If both are missing, settlement and the photo defer for retry. Add issuer halt/corporate-action handling, wrapper/multiplier validation and a tested valuation policy shared by all holders. The current catalogue and valuation feeds contain only the 13 supported instruments and make no spot-ETF requests.

For on-chain buys, add the appropriate verified spot asset and funding adapter, user signing/custody, token conversion, execution reconciliation and transaction status. Off-chain MXNP points cannot themselves be transferred to Hyperliquid; the crypto product needs its own funded balances and conversion path. Do not route a “buy stock” promise to a perpetual without explicitly defining that derivative product.

## Realized-only tournament update

The October 12 follow-up implements user buys/sells as daily activity, realized-only stock tournament PnL, a clickable Portfolio monitor and automatic liquidation before the cutoff photo. Schema v3 distinguishes automatic closing sales from user transactions. All 79 focused tests and the Points build passed. Six live staging checks passed across three independent Postgres connections, including closing/reset contention, matching realized PnL to wallet proceeds, repeated-close idempotency and a new cycle with no holdings/PnL carried over. The cofounder demo wallet was not reset for these tests. Short selling remains disabled; it requires a separate collateralized position model.


## Pointbreak integration checkpoint - October 14, 2026

The eight stock commits through `e46dd42` were cherry-picked in order onto Pointbreak's `f36e5a1` checkpoint. The two DOGGY collector fixes remain intact. A follow-up corrects tournament warnings to distinguish delayed open valuations from realized stock scoring.

Validation on the combined stock checkout: 100 focused stock, chart, tournament, leaderboard, wallet and DOGGY regression tests passed; the Points production build passed. Six live staging checks passed across two independent PostgreSQL connections, covering shared-wallet contention, duplicate execution, concurrent sell-all, sale accounting, automatic liquidation, reset contention and no carried holdings/PnL. These tests used the separate disposable verification branch and cleaned only their own fixtures.

The integrated local demo is available at http://127.0.0.1:5182/points/torneo, backed by the existing isolated cofounder staging database. Its API must allow its exact localhost origin when using the Vite proxy. The existing demo cookie was reused. Browser checks confirmed the stock catalogue, clickable Portfolio monitor, single-click Apple purchase and full unit sale. The purchase left realized stock PnL at -3.049774 MXNP; the sale changed it to -3.003340 MXNP, matching Torneo's displayed -3.00 MXNP. The existing 0.048 NVDA holding was preserved, and qualification remained at zero prediction markets. The PnL chart rendered stock samples after refreshing its data; live provider requests can still time out independently of committed trades.

A separate local Pointbreak change moves the October cutoff to 23:59:59 Mexico City and its daily snapshot job to midnight. The combination passed 148 tests and a Points build into a temporary output folder. Preserve those cutoff edits as uncommitted work and do not include them silently in the stock commits. No production database migration, flag activation, push or deployment has been performed as part of this integration checkpoint. Normal deployed sign-in, Vercel cron delivery, and production migration/feature activation remain release checks.

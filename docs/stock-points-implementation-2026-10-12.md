# Stock Points implementation

Branch: `stock-points`, based on `pointbreak` at `ab8036a`.

The points MVP now supports 13 tradable reference instruments and one read-only ETF preview, real Hyperliquid prices, Banxico FIX, shared-wallet simulated purchases and sales, Portfolio history, and tournament stock PnL. It was verified on isolated Neon staging branches with authenticated local sessions. No production migration, deployment, merge or external order execution has been performed. The synthetic preview remains available separately.

## Product behavior

- The original seven equities, S&P 500 and gold, plus SpaceX (`xyz:SPCX`), Bitcoin, Ethereum and Solana. Crypto has its own filter. The S&P 500 detail has index/ETF navigation; SPYx is a separate wrapped-token spot price preview, with its own units and price. It cannot be purchased with points yet. Search, category filters and local logos cover the expanded catalogue. Logo sources and licenses are in `frontend/app/points/public/stock-logos/README.md`.
- Main copy: “Compra acciones desde 100 MXNP” and “Pon tu portafolio a trabajar, sigue el mercado.”
- Charts use returned USD candle closes. Ranges: 4H/5m, 24H/15m, 7D/1h, 30D/4h. Hover, tap and keyboard selection show the nearest candle close and explicitly labeled interval-start time in UTC, including forming-candle status. Charts poll every 60 seconds with a 55-second backend cache, expiring ahead of the poll to avoid accidentally repeating a sample for another minute. They show their fetch timestamp; indicative detail prices/books poll every three seconds and show the actual book timestamp and age. The main list polls every five seconds. Candle interval size is separate from data freshness.
- Large prices and simulated accounting use MXNP, converted with the current Banxico FIX. The UI shows the FIX date. Missing FX blocks trading; there is no fixed-rate fallback.
- Minimum purchase 100 MXNP; fee 0.10% of actual filled notional, rounded up to one micropoint. Quantity precision follows the instrument. Unspent rounding remainder stays in the wallet. No leverage, shorting or limit orders.
- Review and confirm obtain a user/cycle/side-owned immutable quote. Confirmation requests a fresh order book rather than reusing the indicative three-second cache. Books must remain under ten seconds old, including time spent waiting for locks. Quotes expire; the server never silently requotes a confirmation.
- Price requests and 15-second holdings requests run independently, without overlapping requests within either loop. Stock API requests time out after 12 seconds. Holdings omit trade/PnL history. A failed background poll does not invalidate a still-valid confirmation quote; server freshness checks remain mandatory. Estimates remain visible during processing. After a fill, the returned wallet and holding update immediately; background wallet refresh no longer keeps the form processing.
- A transaction updates the shared wallet, holding, immutable trade, stock valuation and existing `points_distributions` audit. Idempotency returns the original committed result after an uncertain response, expiry or cycle change.
- Buy, partial sale and sell-all are supported. History retains the latest 200 stock trades per selected cycle. Portfolio includes current value, average cost, realized/unrealized PnL, percentage and the combined recorded PnL chart.

## Tournament policy approved by the user

Stock PnL equals **current holding value minus remaining cost basis plus realized PnL**. Entry fees are in cost basis and sale fees reduce proceeds. Realized and open stock PnL enter tournament score exactly once, alongside prediction PnL and existing bonuses/penalties. Reinvesting sale proceeds does not count the same profit again. Moving points between cash and a holding is not profit.

Confirmed stock purchases and sales count as actions and active days. Holding a stock without trading does not count as daily activity. The existing ten qualifying prediction-market requirement, minimum qualifying stake, conviction/liquidity bonuses and inactivity penalties remain in place. Stocks receive neither prediction qualification credit nor conviction/liquidity bonuses.

The wallet leaderboard ranks **cash plus current-cycle stock value**. Spendable cash is still reported separately. Cash and holdings are read in one SQL snapshot to avoid an inconsistent ranking during a fill.

A minute cron records common asset/cycle marks and stock PnL samples for offline holders. All users holding an instrument use the same shared mark. Live marks older than 90 seconds are flagged stale; outages retain holdings and prior values without inventing fresh samples. An unknown holding value fails scoring instead of fabricating zero PnL.

At cycle cutoff, the tournament photo freezes the last completed one-minute candle before the cutoff, converted with the latest official FIX published by that Mexican calendar date. Missing cutoff prices defer the photo for retry. Terminal marks and an existing photo are immutable. Rollover uses the exclusive cycle lock; stock fills use cycle, then wallet, then mark/position locks. Previous-cycle holdings are archived and cannot be sold into the new cycle.

## Configuration and migration

| Variable | Purpose |
| --- | --- |
| `POINTS_STOCKS_ENABLED=true` | Enables the server feature, stock PnL and valuations. Default off. |
| `VITE_POINTS_STOCKS_ENABLED=true` | Enables the built frontend navigation. Requires a rebuild; development defaults on. |
| `POINTS_STOCKS_TRADING_ENABLED=false` | Pauses quotes/buys/sells while retaining holdings, history, prices and tournament scoring. Default allows trading when the feature is enabled. |
| `DATABASE_URL` / `DATABASE_READ_URL` | Use the intended isolated database for staging. Stock reads use the primary. |
| `BANXICO_API_TOKEN` | Official FIX credential. |
| `POINTS_SESSION_SECRET` | Existing authenticated points sessions. |
| `CRON_SECRET` | Bearer authorization for scheduled stock valuations and cutoff retries. |

Schema v2 adds six `points_stock_*` tables (cache, positions, quotes, trades, valuations, cycle marks) and four stock breakdown columns to `points_cycle_snapshots`. The migration uses a transaction-level advisory lock. It was applied only to staging. The host guard requires the actual connection hostname, without printing the connection string:

```sh
cd frontend
node --env-file=/absolute/private/staging.env api/scripts/migrate-stocks.mjs --expected-host=YOUR_STAGING_HOST
node --env-file=/absolute/private/staging.env api/scripts/migrate-stocks.mjs --expected-host=YOUR_STAGING_HOST --apply
```

The first command is a dry run. Root and frontend Vercel configs schedule `/api/cron/points-stock-snapshot` every minute. A deployment must supply `CRON_SECRET` and support that schedule.

After user fills exist, use the trading pause flag for an incident. Turning the main feature flag off also excludes stock PnL from live scoring, so it is not an appropriate mid-cycle trading pause.

## Real-data local staging demo

The local-only harness binds to `127.0.0.1:3180`, requires an explicit isolated branch ID/hostname and matching read/write URLs, and refuses a Vercel environment. Its demo session shortcut is never imported by a deployed route. The user explicitly approved this shortcut for isolated testing.

```sh
cd frontend
node --watch --env-file=/absolute/private/staging.env api/scripts/stock-staging-server.mjs
# In another terminal:
cd frontend/app
BUILD_TARGET=points VITE_POINTS_STOCKS_ENABLED=true VITE_API_PROXY_TARGET=http://127.0.0.1:3180 npm run dev -- --host 127.0.0.1 --port 5180
```

Open `http://127.0.0.1:5180/api/stock-staging/session`, then Acciones, an instrument, Portfolio and Torneo. The shortcut creates a normal local HMAC session for `stocks_demo`; its wallet starts at 500 MXNP only when first created. Subsequent restarts preserve its fills and balance.

The current private configuration is `/private/tmp/pronos-stock-staging/staging.env`; the demo branch is `stock-points-staging-2026-10-12` (`br-blue-star-am4d8y8r`). A separate verification branch `stock-points-verification-2026-10-12` (`br-falling-star-amgmwfys`) isolates contention fixtures from demo polling. Both are autosuspended test branches. Temporary credential files are not committed.

Port 5178 was reconnected to the same isolated API at port 3180 after its previous unused-port proxy caused API failures. Both 5178 and 5180 now serve real-data staging. For the synthetic browser-only preview, explicitly use `stocksDemo=1`; its prices and FX are labeled synthetic and do not replace the staging checks.

## Verification on October 12

- 67 focused stock, tournament, snapshot, wallet-ranking and leaderboard tests pass, including exact fee/cost-basis accounting, partial/full sales, reinvestment, unknown valuations, stale prices, immutable cutoff photos, reset isolation, authentication, the trading pause switch, native/xyz venue separation, ETF identity/read-only guards and Vercel function tracing. Spot contexts are joined by explicit market ID, independently of their array ordering.
- Six isolated live Postgres checks pass across three independent connections: competing stock buys; stock versus a real prediction purchase; duplicate retries; simultaneous sell-all; partial/full sale accounting; reset contention and a committed retry after reset. The verification script removes its own fixtures and restores the previous active-cycle state.
- All 14 real instruments were available through the Pronos adapter, including 13 enabled for simulated trades. Banxico returned FIX 18.4163 effective October 9. A real NVDA completed one-minute cutoff sample was also retrieved. SPYx's sparse candle stream is explicitly identified as potentially older than its live book.
- Authenticated local browser checks completed a 400-MXNP purchase request, a partial sale and sell-all using real quotes. Wallet, unit counts, net-proceeds messages and history updated correctly. Tournament and Portfolio both displayed the same stock PnL after sell-all. Exact fills depend on live prices and quantity rounding.
- The Points production build passes. Existing third-party annotation and large-bundle warnings remain. The initial broad suite had two independently reproduced failures in unchanged dated fixtures; those are documented in the earlier checkpoint.

See [the PDF requirement audit](stock-points-spec-audit-2026-10-12.md) and [rollout checklist](stock-points-rollout-2026-10-12.md). Preview deployment verification, reviewed commits, cherry-picking to `pointbreak`, production migration and explicit flag activation remain separate rollout steps.

The on-chain phase still requires selecting the actual instrument and execution venue, collateral/custody model, funding/FX route and product permissions. The current points ledger records simulated exposure to reference perpetual prices; it does not confer share ownership. See the current Hyperliquid instrument research and ETF activation requirements in the rollout checklist.

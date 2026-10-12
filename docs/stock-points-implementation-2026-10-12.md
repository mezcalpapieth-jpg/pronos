# Stock Points implementation

Branch: `stock-points`, based on `pointbreak` at `ab8036a`.

This is the first complete points-only slice of the Acciones concept in `Pronos_Acciones_Spec_MXNP.pdf`. It adds simulated exposure to seven equities, the S&P 500 and gold. It does not execute orders on Hyperliquid, represent ownership of securities, or interact with on-chain wallets/contracts.

## Implemented

- Acciones navigation, searchable/filterable list, sparklines, asset detail and 4H/24H/7D/30D charts. Dark/orange styling follows the supplied reference, with local monogram badges.
- Public Hyperliquid Info API, `xyz` asset metadata, depth and candles. Symbols are allowlisted; metadata is joined by symbol rather than fixed upstream indices. Missing/delisted assets cannot be traded.
- MXNP valuation using the existing Banxico SF43718 FIX reader. The UI labels the effective date and distinguishes USD 24-hour changes from the converted MXNP price.
- Review/confirm purchases and sales, including sell-all. Minimum purchase: 100 MXNP. Commission: 0.10% of filled notional, rounded up to a micropoint. No leverage, shorting or limit orders.
- Server-issued quotes, book timestamps under 10 seconds old, expiry and immutable fill records. Fills walk displayed depth, respect provider quantity precision, and reject material unfilled orders. Purchases debit actual fill plus fee and preserve rounding remainder; fee is included in cost basis.
- One real Postgres transaction updates the shared wallet, stock holding, trade, valuation and `points_distributions` audit. A unique user/idempotency key supports retries and rejects changed requests. Quotes belong to one user/cycle/side and can be consumed once. The browser retains the same key after an uncertain confirmation.
- Existing Portfolio shows stocks alongside prediction positions, asset filters, stock history, realized/unrealized PnL and a combined observed PnL chart.
- Demo support behind existing demo activation. The local preview entry is compiled out of production builds and labels its prices/FX synthetic.

## Local preview

```sh
cd frontend
npm install
npm run test:stocks
cd app
BUILD_TARGET=points VITE_API_PROXY_TARGET=http://127.0.0.1:9 npm run dev -- --host 127.0.0.1 --port 5178
```

Open `http://127.0.0.1:5178/points/stocks?stocksDemo=1` to use the isolated in-browser demo. The proxy points to an unused local port, so the preview cannot send a points write to production. Preview activation persists in that tab's session storage. Clear `pronos-video-demo-active` and `pronos-stock-demo` to leave it. The demo uses the same pure fill/cost-basis arithmetic as the backend, but does not replace backend integration testing.

## Live staging configuration

| Variable | Purpose |
| --- | --- |
| `POINTS_STOCKS_ENABLED=true` | Enables stock API routes. Defaults off, including in production. |
| `VITE_POINTS_STOCKS_ENABLED=true` | Enables the navigation link in a built frontend. Development defaults on; `false` disables it. Requires rebuilding. |
| `DATABASE_URL` | Existing write database connection; use an isolated staging branch. |
| `BANXICO_API_TOKEN` | Existing FIX provider credential. No hardcoded FX fallback. |
| `POINTS_SESSION_SECRET` | Existing authenticated points session. |

Stock routes first ensure the existing points schema, then create the five `points_stock_*` tables under a transaction-level advisory lock. No production migration or deployment was performed during implementation. All stock database reads use the primary to preserve read-after-write behavior.

The stock service requires an active, unpaused points cycle and stops at its operation cutoff. It acquires a shared cycle lock before the wallet lock; the existing rollover acquires an exclusive cycle lock. Holdings are keyed by cycle ID, so a reset starts with no stock holdings available for sale. Old holdings, quotes, trades and valuations remain associated with their original cycle. Completed idempotency retries still return their original result after a reset or expiry.

## Valuation and ranking policy

Stock history is observational: samples are stored on a fill and on a portfolio read, with minute buckets for portfolio polls. The chart carries the latest independent market/stock observations forward; it does not reconstruct every historical price between visits. The first stock fill records a zero baseline at cycle start. Trade history currently displays the latest 200 stock trades in the selected cycle.

Current holdings retain their last recorded valuation during a provider outage. A missing/stale mark is labeled and does not create a fresh portfolio valuation sample. Closed-cycle holdings show their last recorded valuation, not a guaranteed price at the exact closing second. If an exact terminal stock value becomes a tournament requirement, add a scheduled terminal snapshot before enabling prize scoring.

Stock PnL is not included in the existing prediction-market tournament score, qualifying-market count, hold bonus or liquidity rewards. The wallet leaderboard reflects spendable cash, so stock purchases reduce that displayed cash balance. Any decision to score stock holdings in a prize tournament needs a separate implementation and product review.

Metadata/book caches persist in Postgres across instances and coalesce refreshes within one warm instance. This initial adapter polls rather than streaming; a dedicated streaming feed can replace it later without changing stock accounting. Banxico FIX is cached for one hour and must be no more than seven days old. Missing FX disables trades. Hyperliquid depth and FX are reference inputs to a simulator; Pronos does not place those fills externally.

## Verification and next milestone

- New stock tests cover integer accounting, remainder preservation, fees/cost basis, depth, malformed/stale books, FX validity, symbol mapping, feature gate, authentication/CSRF, SQL rollback, retries, quote ownership/expiry, cycle rollover, stale portfolio marks and combined PnL samples.
- Transaction tests use PGlite, an isolated Postgres engine. It serializes transactions within one engine; it is not proof of multi-connection Neon contention behavior.
- Browser preview verified a buy, wallet debit, holding in Portfolio, sell-all and wallet credit; mobile and desktop layouts were inspected. Preview prices are explicitly synthetic.
- All 21 new stock tests pass. The final wider suite passed 797 of 799 tests. The two failures reproduced independently in unchanged code: the mañanera fallback fixture expects an older article URL, and a team schedule fixture treats a June 2026 event as future relative to the current October date.
- Both MVP and Points production builds passed. Existing dependency annotation and large-bundle warnings remain. Only generated Points output is included in this branch's checkpoint.

Before enabling a live beta, run the stock routes on an isolated Neon branch with real session cookies, Banxico FIX and Hyperliquid data. Verify competing stock/prediction purchases, simultaneous stock sales, idempotent retries across instances, rollover contention and provider outages. Then enable both flags on a preview deployment and review the resulting fills before deciding when to cherry-pick into `pointbreak`.

The subsequent on-chain phase remains a separate adapter/product: choose the actual tradable instrument and execution venue, collateral/custody model, funding/FX route and applicable product permissions before wiring wallet transactions. The points ledger is not an ownership register for real shares.

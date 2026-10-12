# Acciones PDF implementation audit

Reviewed all 10 pages of `/Users/Fran/Downloads/Pronos_Acciones_Spec_MXNP.pdf`, including the three screen references, against the `stock-points` implementation. The first checkpoint is `9ee1d0f`; the chart/detail follow-up closes the UI gaps listed below. Production has not been deployed, and production feature flags remain off.

**The off-chain points scope is implemented and verified in isolated staging.** Real prices, Banxico FIX, authenticated buy/partial-sell/sell-all flows and multi-connection contention checks are now verified. Company logos and custom index/gold icons are local assets. It has not been released to production. The separate on-chain phase remains outside this MVP.

## Requirement checklist

| PDF requirement | Status | Evidence / limitation |
| --- | --- | --- |
| Points only; no deposits, wallets, external orders, leverage, shorts or limits | Implemented | Stock routes update the internal points wallet; only the public Hyperliquid Info API is used. |
| Nine initial assets and their categories | Implemented and expanded after PDF | Original seven equities, SP500, GOLD, plus SPCX, BTC, ETH and SOL. ETFs were removed from the Points scope at the user's request. Catalogue is code-defined rather than an editable SQL assets table. |
| Existing header and Acciones category pill | Implemented | Points shell/navigation reused; stock search and category filters are in the list page. Header search continues to search prediction markets. |
| Top EN VIVO ticker with 24-hour changes | Implemented in follow-up | `StockLiveTicker.jsx` reuses `PointsTicker.jsx` markup/styles on stock list/detail. Demo is labeled DEMO; outages hide changes and show SIN DATOS. |
| Searchable list; technology, indices, commodities filters; rows open detail | Implemented | `PointsStocks.jsx`. |
| USD mark × USD/MXN shown as MXNP; USD-based 24-hour change | Implemented and staging verified | `stock-data.js` joins `metaAndAssetCtxs` by coin and reads the existing Banxico FIX source. No fixed-FX fallback in live routes. |
| 24-hour sparkline using hourly candle closes | Implemented | SPARK candle proxy uses `1h`; small SVG line follows returned timestamps. |
| Detail heading, category, 24/7, price and change | Implemented with hours correction | `PointsStockDetail.jsx` identifies a points simulator. The blanket 24/7 label was removed because venue schedules and price availability differ by instrument. Product cycle pauses/cutoffs apply. |
| Orange price chart: 4H/5m, 24H/15m, 7D/1h, 30D/4h | Implemented | Config, proxy and interval tests; synthetic demo uses the same interval spacing after follow-up. Default selection is 7D. |
| Chart hover price/time requested after PDF | Implemented in follow-up | Nearest returned candle close, crosshair, UTC interval-start timestamp; mouse, tap, keyboard support. No interpolated price is presented as a data sample. |
| Best ask, best bid and 24-hour USD volume | Implemented | Bid/ask from `l2Book`; volume from `dayNtlVlm`, added to detail in follow-up. |
| Buy/sell switch; amount and 100/500/1,000/5,000 presets | Implemented | Detail order card uses MXNP. |
| Quantity, 0.10% fee and FX estimate recalculated on amount changes | Implemented in follow-up | Indicative client estimate uses the same pure fill arithmetic as the server. Review/confirm still obtains an immutable server quote. |
| CTA updates with asset, side and amount | Implemented with deliberate extra step | Review CTA shows these fields; second click confirms an expiring quote. |
| Prevent overselling; sell-all button | Implemented | UI indicative validation and server quantity enforcement; button added in follow-up. Small residual holdings can be sold below the purchase minimum. |
| Minimum 100 MXNP and sufficient balance | Implemented | 100 MXNP minimum applies to purchases. Shared wallet locked and checked in a transaction. |
| Quotes under 10 seconds; unavailable-price button; idempotency | Implemented | Stale/future books rejected, expiring user-owned quotes, unique idempotency key, atomic writes and retry replay. Six staging scenarios were verified across three independent Postgres connections. |
| Backend cache and public candle proxy | Implemented | Metadata TTL 5s, book TTL 3s, candles TTL 55s, FX TTL 1h; request-driven refresh. Candle cache expires ahead of the 60s chart poll. Detail price polling is every 3s, independently of 15s holdings polling; list polling is every 5s. |
| Store operation price, FX, quantity, fee and idempotency | Implemented | Immutable `points_stock_trades`; cycle-keyed positions, quote/cache/valuation tables. Names are prefixed to match Pronos. |
| Same points balance/ledger as prediction markets | Implemented and staging verified | One transaction updates `points_balances`, stock position, stock trade, `points_distributions` audit and valuation. |
| Existing Portfolio tabs and market cards | Implemented | Activo, Combinadas, Historial and Recompensas retained. |
| Portfolio balance, exposure, open/total PnL include stocks | Implemented | Existing summary cards combine stock and prediction figures; unavailable valuations are shown as unknown/stale. Stock realized and open PnL now enter tournament scoring after fees, as subsequently approved by the user. |
| Combined PnL evolution | Implemented with a limitation | Combines recorded stock and prediction PnL observations. A minute cron now records stock PnL while holders are offline; outages retain prior observations rather than fabricating samples. |
| TODO / ACCIONES / MERCADOS list filters | Implemented | Portfolio active/history filters. |
| Stock row: logo, name, quantity, average cost, current value, PnL and percentage; opens detail | Implemented | Average cost, percentage and detail link added in follow-up. Local company logos and custom index/gold icons are included, with monogram fallback. |
| Cobraste notice after profitable stock sale | Implemented in follow-up | Sale success notice states actual net MXNP received. It also appears for a sale at a loss; this amount is proceeds, not a claim of profit. |
| Existing dark tokens and Bebas Neue / DM Sans / DM Mono | Implemented with visual adaptations | Shared typography/theme reused. Follow-up replaces stock surface and positive/negative color fallbacks with actual Pronos tokens. Desktop uses two columns; mobile stacks cards. |
| Company logos in circles, own index/gold icons | Implemented | Local SVG assets and source/license notes; icons remain visible without an external image host. |
| No betting copy / no long dashes in stock user text | Implemented for new stock copy | Uses buying/selling/price/position vocabulary. Existing global app/footer content was reused. |
| Phase 2 wallet signatures, builder fees, real funding and on-chain execution | Explicitly outside this MVP | The PDF says not to build phase 2 yet. No real stock ownership or external order execution is claimed. |

## Accounting differences from the proposed formulas

The implementation intentionally preserves quantity-rounding remainder in the user's wallet instead of debiting the entire entered amount for unfilled fractions. Fees are 0.10% of actual filled notional and are included in cost basis, so PnL includes entry costs. It walks available order-book depth rather than assuming all units fill at the best price. These differences are covered by accounting tests and visible in the review quote.

## Price and chart semantics

| Selected range | Candle interval |
| --- | --- |
| 4H | 5 minutes |
| 24H | 15 minutes |
| 7D | 1 hour |
| 30D | 4 hours |
| List sparkline, last 24 hours | 1 hour |

Live mode draws the `c` close from each returned `candleSnapshot` candle. `t` is the candle interval start, explicitly labeled in UTC. The final candle can still be forming. The chart fetch timestamp and the live order-book timestamp/age are shown separately. The chart is in USD; the large asset price is in MXNP using the current FIX conversion. Historical FX is not reconstructed. Mark price and candle close can differ. Detail price/book polling is 3 seconds, list polling 5 seconds, candle polling 60 seconds and candle cache 55 seconds. These are separate from candle interval size. Sparse markets can have genuinely old last-trade candles; live buy/sell timestamps are shown separately.

The local `stocksDemo=1` preview remains synthetic, including its FX and volume. Real staging checks verified the browser-to-Pronos-to-Neon fill path with Hyperliquid prices and Banxico FIX on October 12. The synthetic preview is a separate tool.

## Tournament extension approved after the PDF

The user requested that stock PnL count toward the tournament. Realized and open PnL now count after fees; stock buys/sells count as actions and active days. Existing prediction qualification, conviction/liquidity bonuses and inactivity rules remain. The wallet leaderboard ranks cash plus stock value. A minute cron values offline holdings, and the tournament snapshot freezes the last completed one-minute candle before cutoff with historical FIX. Missing terminal prices defer the photo; existing photos and terminal marks remain immutable.

## Remaining rollout steps

1. Review and commit the latest `stock-points` changes and generated Points assets.
2. Deploy a preview with an isolated database, real normal sign-in, provider credentials and the minute cron; verify the deployment-specific routing, session and schedule.
3. Cherry-pick the reviewed stock checkpoints into `pointbreak` and rebuild with the frontend feature flag.
4. Apply the guarded schema v2 migration to the approved production host, then explicitly activate the server feature and cron.
5. Keep the trading pause switch available without disabling valuation/scoring once holdings exist.

No on-chain share ownership, crypto funding, wallet signature or external order execution has been implemented in the points MVP.

## Verification

- 73 focused stock/tournament/snapshot/wallet/leaderboard tests pass. Price interval mappings, unchanged provider closes/timestamps, nearest-candle selection, UTC formatting, venue routing, rejection of removed instruments and Vercel function tracing are covered.
- Six real Neon contention scenarios pass across three independent connections, including a stock/prediction purchase race, double-sale prevention, idempotency and reset contention.
- The original real provider checks verified 14 assets, Banxico FIX and a completed one-minute cutoff price. The ETF was subsequently removed, leaving 13 supported instruments.
- Authenticated local staging browser checks completed a buy, partial sale and sell-all, with shared-wallet debits/credits and holding changes.
- Points production build passes with existing dependency annotation and bundle-size warnings.
- Prior local chart checks verified pointer-driven price/time selection, five-minute/one-hour range changes and a 390px layout without overflow. The original broad suite's two unchanged dated fixture failures are documented in the implementation notes.

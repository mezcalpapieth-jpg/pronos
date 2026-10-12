# Acciones PDF implementation audit

Reviewed all 10 pages of `/Users/Fran/Downloads/Pronos_Acciones_Spec_MXNP.pdf`, including the three screen references, against the `stock-points` implementation. The first checkpoint is `9ee1d0f`; the chart/detail follow-up closes the UI gaps listed below. Nothing has been pushed or deployed, and production feature flags remain off.

**The entire PDF is not yet delivered as a live product.** Most points MVP behavior is implemented and locally verified. The local browser preview is a synthetic demo. Real Hyperliquid prices are supported by the backend adapter, but a complete staging run with an isolated database, authenticated sessions and real Banxico FIX is still pending. Company logos remain monograms.

## Requirement checklist

| PDF requirement | Status | Evidence / limitation |
| --- | --- | --- |
| Points only; no deposits, wallets, external orders, leverage, shorts or limits | Implemented | Stock routes update the internal points wallet; only the public Hyperliquid Info API is used. |
| Nine initial assets and their categories | Implemented | `frontend/api/_lib/stock-assets.js`: seven equities, SP500, GOLD. Catalogue is code-defined rather than an editable SQL assets table. |
| Existing header and Acciones category pill | Implemented | Points shell/navigation reused; stock search and category filters are in the list page. Header search continues to search prediction markets. |
| Top EN VIVO ticker with 24-hour changes | Implemented in follow-up | `StockLiveTicker.jsx` reuses `PointsTicker.jsx` markup/styles on stock list/detail. Demo is labeled DEMO; outages hide changes and show SIN DATOS. |
| Searchable list; technology, indices, commodities filters; rows open detail | Implemented | `PointsStocks.jsx`. |
| USD mark × USD/MXN shown as MXNP; USD-based 24-hour change | Backend implemented; live integration pending | `stock-data.js` joins `metaAndAssetCtxs` by coin and reads the existing Banxico FIX source. No fixed-FX fallback in live routes. |
| 24-hour sparkline using hourly candle closes | Implemented | SPARK candle proxy uses `1h`; small SVG line follows returned timestamps. |
| Detail heading, category, 24/7, price and change | Implemented | `PointsStockDetail.jsx`; identifies a points simulator. Product cycle pauses/cutoffs still apply to simulated trades. |
| Orange price chart: 4H/5m, 24H/15m, 7D/1h, 30D/4h | Implemented | Config, proxy and interval tests; synthetic demo uses the same interval spacing after follow-up. Default selection is 7D. |
| Chart hover price/time requested after PDF | Implemented in follow-up | Nearest returned candle close, crosshair, UTC interval-start timestamp; mouse, tap, keyboard support. No interpolated price is presented as a data sample. |
| Best ask, best bid and 24-hour USD volume | Implemented | Bid/ask from `l2Book`; volume from `dayNtlVlm`, added to detail in follow-up. |
| Buy/sell switch; amount and 100/500/1,000/5,000 presets | Implemented | Detail order card uses MXNP. |
| Quantity, 0.10% fee and FX estimate recalculated on amount changes | Implemented in follow-up | Indicative client estimate uses the same pure fill arithmetic as the server. Review/confirm still obtains an immutable server quote. |
| CTA updates with asset, side and amount | Implemented with deliberate extra step | Review CTA shows these fields; second click confirms an expiring quote. |
| Prevent overselling; sell-all button | Implemented | UI indicative validation and server quantity enforcement; button added in follow-up. Small residual holdings can be sold below the purchase minimum. |
| Minimum 100 MXNP and sufficient balance | Implemented | 100 MXNP minimum applies to purchases. Shared wallet locked and checked in a transaction. |
| Quotes under 10 seconds; unavailable-price button; idempotency | Implemented | Stale/future books rejected, expiring user-owned quotes, unique idempotency key, atomic writes and retry replay. Multi-instance contention validation is still pending. |
| Backend cache and public candle proxy | Implemented | Metadata TTL 5s, book TTL 3s, candles TTL 60s, FX TTL 1h; request-driven refresh. It is not a continuously scheduled 5-second collector. UI price polling is every 5s. |
| Store operation price, FX, quantity, fee and idempotency | Implemented | Immutable `points_stock_trades`; cycle-keyed positions, quote/cache/valuation tables. Names are prefixed to match Pronos. |
| Same points balance/ledger as prediction markets | Implemented; staging validation pending | One transaction updates `points_balances`, stock position, stock trade, `points_distributions` audit and valuation. |
| Existing Portfolio tabs and market cards | Implemented | Activo, Combinadas, Historial and Recompensas retained. |
| Portfolio balance, exposure, open/total PnL include stocks | Implemented | Existing summary cards combine stock and prediction figures; unavailable valuations are shown as unknown/stale. Stock PnL does not yet enter prediction tournament prize scoring. |
| Combined PnL evolution | Implemented with a limitation | Combines recorded stock and prediction PnL observations. It is not a continuously reconstructed price history while the user is offline. |
| TODO / ACCIONES / MERCADOS list filters | Implemented | Portfolio active/history filters. |
| Stock row: logo, name, quantity, average cost, current value, PnL and percentage; opens detail | Implemented except company logos | Average cost, percentage and detail link added in follow-up. Logos are monogram placeholders. |
| Cobraste notice after profitable stock sale | Implemented in follow-up | Sale success notice states actual net MXNP received. It also appears for a sale at a loss; this amount is proceeds, not a claim of profit. |
| Existing dark tokens and Bebas Neue / DM Sans / DM Mono | Implemented with visual adaptations | Shared typography/theme reused. Follow-up replaces stock surface and positive/negative color fallbacks with actual Pronos tokens. Desktop uses two columns; mobile stacks cards. |
| Company logos in circles, own index/gold icons | Pending | Monograms are still used. Source/license review and final local logo/icon assets are required for reference fidelity. |
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

Live mode draws the `c` close from each returned `candleSnapshot` candle. `t` is the candle interval start, shown in UTC. The final candle can still be forming. The chart is in USD; the large asset price is in MXNP using the current FIX conversion. Historical FX is not reconstructed. Mark price and candle close can differ. Price/book polling is 5 seconds; candle polling/cache is 60 seconds. These are separate from candle interval size.

The local `stocksDemo=1` preview remains synthetic, including its FX and volume. Public feed checks returned valid NVIDIA data for all four intervals on October 12. This does not validate the full browser-to-Pronos-to-database execution path.

## Remaining before a live points beta

1. Use an isolated staging database and enable the two stock flags there; provide the existing Banxico and session configuration.
2. Verify real prices/FX through the Pronos endpoints, quotes, a buy, a partial sale, a full sale, wallet audits and Portfolio PnL.
3. Exercise concurrent stock/prediction buys, simultaneous sales, cross-instance retries, provider outages and cycle rollover. PGlite tests do not prove multi-connection behavior.
4. Finish company/logo assets and reference-layout review. Decide whether prize scoring needs stock valuations; if it does, implement that policy and terminal cycle snapshots before enabling it.
5. Review the resulting branch commits before cherry-picking into `pointbreak` and explicitly enabling production.

## Verification

- 24 stock tests pass, including all interval mappings, 60-second candle caching, unchanged provider timestamps/closes, nearest-candle selection and UTC time formatting.
- Points production build passes with existing dependency annotation and bundle-size warnings.
- Local browser checks confirm one-hour steps in 7D, five-minute steps in 4H, pointer-driven price/time selection, immediate estimate changes, average cost/PnL percentage and detail navigation in Portfolio. Mobile chart width and page scroll width both measure 390px, with the readout visible.
- The initial checkpoint also verified demo buy/sell and Portfolio balance/holdings; the wider initial suite had two failures in unchanged fixtures, documented in the implementation notes.

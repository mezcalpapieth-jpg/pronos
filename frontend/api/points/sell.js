/**
 * POST /api/points/sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Off-chain MXNP early exit. Points-app only — see /api/protocol/sell
 * for on-chain trades. The points-app's `points_markets` ledger never
 * touches the chain.
 *
 * Atomic: runs inside a single Postgres transaction so reserve /
 * balance / position / trade / distribution all commit together.
 *
 * Average-cost accounting for realized PnL:
 *   avgCost          = costBasis / sharesHeld
 *   soldCostBasis    = avgCost × sharesSold
 *   addedRealizedPnl = proceeds − soldCostBasis
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, binarySellQuote, multiSellQuote } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { bestEffortInsertPointsPriceSnapshot } from '../_lib/points-price-snapshots.js';
import {
  combineSellOrderbookMatches,
  executeTriggeredLimitOrders,
  lockedReservedShares,
  matchPronosMakerBidsForSell,
  matchRestingBidsForSell,
  PRONOS_TREASURY_USERNAME,
} from '../_lib/points-limit-orders.js';
import { assertCryptoTradeAllowed } from '../_lib/points-crypto-trade-guard.js';
import { normalizeExecutableSellShares } from '../_lib/points-sell-shares.js';
import { binaryPricesWithBookTrade } from '../_lib/points-display-prices.js';
import { capturePointsRiskEvent } from '../_lib/points-risk.js';

const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function sellOrderbookPriceFloor(reserves, outcomeIndex, shares) {
  const amount = Number(shares);
  if (!Array.isArray(reserves) || reserves.length < 2 || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  try {
    const quote = reserves.length === 2
      ? binarySellQuote(reserves, outcomeIndex, amount)
      : multiSellQuote(reserves, outcomeIndex, amount);
    const floor = Number(quote?.collateralOut) / amount;
    return Number.isFinite(floor) && floor > 0 ? floor : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `sell:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex, shares, minCollateralOut } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const n   = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  // Upper bound on oi is enforced once we read the market's reserves length.
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0)       return res.status(400).json({ error: 'invalid_shares' });

  // Slippage guard: lowest MXNP the user will accept for their
  // shares. Rejected with `price_moved` if the locked quote undershoots.
  const minOut = Number.isFinite(Number(minCollateralOut)) ? Number(minCollateralOut) : null;

  const username = session.username;

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const marketResult = await client.query(
        `SELECT m.id, m.status, m.reserves, m.end_time, m.resolver_config,
                m.seed_liquidity, m.seed_liquidities,
                COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
         FROM points_markets m
         LEFT JOIN points_markets p ON p.id = m.parent_id
         WHERE m.id = $1
         FOR UPDATE OF m`,
        [mid],
      );
      if (marketResult.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const m = marketResult.rows[0];
      if (m.status !== 'active') {
        const err = new Error('market_closed'); err.status = 400; throw err;
      }
      if (m.end_time && new Date(m.end_time) <= new Date()) {
        const err = new Error('market_expired'); err.status = 400; throw err;
      }
      assertCryptoTradeAllowed(m);
      const reserves = parseJsonb(m.reserves, []).map(Number);
      // AMM dispatch, same rules as buy.js: N=2 binary, N≥3 unified multi.
      if (reserves.length < 2) {
        const err = new Error('degenerate_reserves'); err.status = 400; throw err;
      }
      if (oi >= reserves.length) {
        const err = new Error('invalid_outcome_index'); err.status = 400; throw err;
      }
      let displayPriceBefore = 0;
      if (reserves.length === 2) {
        const pricesBefore = binaryPrices(reserves);
        const displayTradeResult = await client.query(
          `SELECT outcome_index, price_at_trade,
                  (reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after) AS is_book_trade
             FROM points_trades
            WHERE market_id = $1
              AND username <> $2
              AND price_at_trade IS NOT NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 1`,
          [mid, PRONOS_TREASURY_USERNAME],
        );
        const displayPricesBefore = binaryPricesWithBookTrade(pricesBefore, {
          status: m.status,
          outcomeIndex: displayTradeResult.rows[0]?.outcome_index,
          price: displayTradeResult.rows[0]?.price_at_trade,
          isBookTrade: displayTradeResult.rows[0]?.is_book_trade,
        });
        displayPriceBefore = Number(displayPricesBefore[oi] ?? pricesBefore[oi] ?? 0);
      }

      const positionResult = await client.query(
        `SELECT shares, cost_basis, realized_pnl
         FROM points_positions
         WHERE market_id = $1 AND username = $2 AND outcome_index = $3
         FOR UPDATE`,
        [mid, username, oi],
      );
      if (positionResult.rows.length === 0) {
        const err = new Error('no_position'); err.status = 400; throw err;
      }
      const p = positionResult.rows[0];
      const held = Number(p.shares);
      const reservedShares = await lockedReservedShares(client, { marketId: mid, username, outcomeIndex: oi });
      const { sharesToSell } = normalizeExecutableSellShares({
        requestedShares: n,
        heldShares: held,
        reservedShares,
      });

      const bookMinPrice = sellOrderbookPriceFloor(reserves, oi, sharesToSell);
      const realOrderbookMatch = await matchRestingBidsForSell(client, {
        market: m,
        marketId: mid,
        username,
        outcomeIndex: oi,
        sharesToSell,
        minPrice: bookMinPrice,
      });
      const makerOrderbookMatch = realOrderbookMatch.remainingShares > 0.000001
        ? await matchPronosMakerBidsForSell(client, {
          market: m,
          marketId: mid,
          username,
          outcomeIndex: oi,
          sharesToSell: realOrderbookMatch.remainingShares,
          currentPrice: displayPriceBefore || null,
          minPrice: bookMinPrice,
        })
        : null;
      const orderbookMatch = combineSellOrderbookMatches(realOrderbookMatch, makerOrderbookMatch);
      const ammShares = orderbookMatch.remainingShares > 0.000001
        ? orderbookMatch.remainingShares
        : 0;

      let quote = null;
      let addedAmmRealized = 0;
      if (ammShares > 0) {
        let freshPosition;
        const freshPositionResult = await client.query(
          `SELECT shares, cost_basis, realized_pnl
             FROM points_positions
            WHERE market_id = $1 AND username = $2 AND outcome_index = $3
            FOR UPDATE`,
          [mid, username, oi],
        );
        if (freshPositionResult.rows.length === 0) {
          const err = new Error('no_position'); err.status = 400; throw err;
        }
        freshPosition = freshPositionResult.rows[0];
        const freshHeld = Number(freshPosition.shares);
        const freshCostBasis = Number(freshPosition.cost_basis);
        const freshRealized = Number(freshPosition.realized_pnl || 0);
        if (freshHeld + 0.000001 < ammShares) {
          const err = new Error('insufficient_available_shares'); err.status = 400; throw err;
        }

        try {
          quote = reserves.length === 2
            ? binarySellQuote(reserves, oi, ammShares)
            : multiSellQuote(reserves, oi, ammShares);
        } catch (e) {
          const err = new Error('invalid_quote'); err.status = 400; err.detail = e.message; throw err;
        }

        const minAmmOut = minOut !== null
          ? Math.max(0, minOut - orderbookMatch.collateralOut)
          : null;
        if (minAmmOut !== null && quote.collateralOut < minAmmOut) {
          const err = new Error('price_moved'); err.status = 409;
          err.detail = `out=${(orderbookMatch.collateralOut + quote.collateralOut).toFixed(6)} below min=${minOut}`;
          throw err;
        }

        await client.query(
          `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
          [JSON.stringify(quote.reservesAfter), mid],
        );

        const avgCost = freshHeld > 0 ? freshCostBasis / freshHeld : 0;
        const soldCostBasis = avgCost * ammShares;
        addedAmmRealized = quote.collateralOut - soldCostBasis;
        const newShares = Math.max(0, freshHeld - ammShares);
        const newCostBasis = newShares > 0 ? freshCostBasis - soldCostBasis : 0;
        const newRealized = freshRealized + addedAmmRealized;

        await client.query(
          `UPDATE points_positions
           SET shares       = $1,
               cost_basis   = $2,
               realized_pnl = $3,
               updated_at   = NOW()
           WHERE market_id = $4 AND username = $5 AND outcome_index = $6`,
          [newShares, newCostBasis, newRealized, mid, username, oi],
        );

        await client.query(
          `INSERT INTO points_trades (
             market_id, username, side, outcome_index,
             shares, collateral, fee, price_at_trade,
             reserves_before, reserves_after
           ) VALUES ($1, $2, 'sell', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
          [
            mid, username, oi,
            ammShares, quote.collateralOut, quote.fee, quote.priceBefore || 0,
            JSON.stringify(reserves),
            JSON.stringify(quote.reservesAfter),
          ],
        );

        await bestEffortInsertPointsPriceSnapshot(client, {
          marketId: mid,
          reserves: quote.reservesAfter,
          logLabel: 'points-sell-price-snapshot',
        });
      }

      const totalCollateralOut = orderbookMatch.collateralOut + Number(quote?.collateralOut || 0);
      if (minOut !== null && totalCollateralOut < minOut) {
        const err = new Error('price_moved'); err.status = 409;
        err.detail = `out=${totalCollateralOut.toFixed(6)} below min=${minOut}`;
        throw err;
      }
      if (totalCollateralOut <= 0.000001) {
        const err = new Error('invalid_quote'); err.status = 400; throw err;
      }

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0 ? Number(balanceResult.rows[0].balance) : 0;
      const newBalance = currentBalance + totalCollateralOut;
      if (balanceResult.rows.length === 0) {
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
          [username, newBalance],
        );
      } else {
        await client.query(
          `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
          [newBalance, username],
        );
      }

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'trade_sell', $3, $4)`,
        [username, totalCollateralOut, mid, `Venta anticipada de ${sharesToSell.toFixed(2)} acciones`],
      );

      const triggeredLimitOrders = await executeTriggeredLimitOrders(client, {
        marketId: mid,
      });

      return {
        balance: newBalance,
        collateralOut: totalCollateralOut,
        sharesSold: sharesToSell,
        realizedPnl: orderbookMatch.realizedPnl + addedAmmRealized,
        priceBefore: quote?.priceBefore ?? orderbookMatch.avgPrice,
        priceAfter: quote?.priceAfter ?? orderbookMatch.avgPrice,
        orderbookFills: orderbookMatch.fills,
        triggeredLimitOrders,
      };
    });

    await capturePointsRiskEvent(schemaSql, req, {
      username,
      accountId: session.sub,
      eventType: 'trade:sell',
      marketId: mid,
      tradeSide: 'sell',
      outcomeIndex: oi,
      amount: result.collateralOut,
      shares: result.sharesSold,
      metadata: {
        requestedShares: n,
        realizedPnl: result.realizedPnl,
        priceBefore: result.priceBefore,
        priceAfter: result.priceAfter,
        orderbookFillCount: Array.isArray(result.orderbookFills) ? result.orderbookFills.length : 0,
        triggeredLimitOrderCount: Array.isArray(result.triggeredLimitOrders) ? result.triggeredLimitOrders.length : 0,
      },
    });

    const { orderbookFills, triggeredLimitOrders, ...publicResult } = result;
    return res.status(200).json({
      ok: true,
      ...publicResult,
      orderbookFillCount: Array.isArray(orderbookFills) ? orderbookFills.length : 0,
      triggeredLimitOrderCount: Array.isArray(triggeredLimitOrders) ? triggeredLimitOrders.length : 0,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}

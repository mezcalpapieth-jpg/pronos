/**
 * POST /api/points/quote-sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Read-only sell quote. Sells have no fee in the points app, so the
 * `fee` field always returns 0 but we keep the field for UI uniformity.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, binarySellQuote, multiPrices, multiSellQuote } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { cryptoTradeLock } from '../_lib/points-crypto-trade-guard.js';
import {
  combineSellOrderbookMatches,
  makerUsageFromRows,
  previewPronosMakerBidsForSell,
  previewRestingBidsForSell,
  PRONOS_TREASURY_USERNAME,
} from '../_lib/points-limit-orders.js';
import { binaryPricesWithBookTrade } from '../_lib/points-display-prices.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
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
    key: `quote-sell:${clientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return;

  const { marketId, outcomeIndex, shares } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const n = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'invalid_shares' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT m.status, m.reserves, m.end_time, m.resolver_config,
             m.seed_liquidity, m.seed_liquidities,
             COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
      FROM points_markets m
      LEFT JOIN points_markets p ON p.id = m.parent_id
      WHERE m.id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const r = rows[0];
    if (r.status !== 'active') return res.status(400).json({ error: 'market_closed' });
    if (r.end_time && new Date(r.end_time) <= new Date()) {
      return res.status(400).json({ error: 'market_expired' });
    }
    const cryptoLock = cryptoTradeLock(r);
    if (cryptoLock) {
      return res.status(cryptoLock.status).json({
        error: cryptoLock.error,
        detail: cryptoLock.detail,
      });
    }

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length < 2) return res.status(400).json({ error: 'degenerate_reserves' });
    if (oi >= reserves.length) return res.status(400).json({ error: 'invalid_outcome_index' });

    const pricesBefore = reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
    const displayTradeRows = reserves.length === 2 ? await sql`
      SELECT outcome_index, price_at_trade,
             (reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after) AS is_book_trade
      FROM points_trades
      WHERE market_id = ${mid}
        AND username <> ${PRONOS_TREASURY_USERNAME}
        AND price_at_trade IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ` : [];
    const displayPricesBefore = binaryPricesWithBookTrade(pricesBefore, {
      status: r.status,
      outcomeIndex: displayTradeRows[0]?.outcome_index,
      price: displayTradeRows[0]?.price_at_trade,
      isBookTrade: displayTradeRows[0]?.is_book_trade,
    });
    const priceBefore = displayPricesBefore[oi] || pricesBefore[oi] || 0;

    const bidRows = await sql`
      SELECT id, username, limit_price, remaining_amount
        FROM points_limit_orders
       WHERE market_id = ${mid}
         AND outcome_index = ${oi}
         AND side = 'buy'
         AND status = 'open'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY limit_price DESC, created_at ASC, id ASC
       LIMIT 24
    `;
    const bookMinPrice = sellOrderbookPriceFloor(reserves, oi, n);
    const realOrderbook = previewRestingBidsForSell(bidRows, {
      shares: n,
      minPrice: bookMinPrice,
    });
    const usageRows = await sql`
      SELECT side, COALESCE(SUM(collateral), 0)::text AS collateral
        FROM points_trades
       WHERE market_id = ${mid}
         AND outcome_index = ${oi}
         AND username = ${PRONOS_TREASURY_USERNAME}
         AND side IN ('buy', 'sell')
       GROUP BY side
    `;
    const makerOrderbook = realOrderbook.remainingShares > 0.000001
      ? previewPronosMakerBidsForSell(r, {
        outcomeIndex: oi,
        shares: realOrderbook.remainingShares,
        usage: makerUsageFromRows(usageRows),
        currentPrice: priceBefore,
        minPrice: bookMinPrice,
      })
      : null;
    const orderbook = combineSellOrderbookMatches(realOrderbook, makerOrderbook);
    const ammShares = orderbook.remainingShares > 0.000001
      ? orderbook.remainingShares
      : 0;
    const q = ammShares > 0
      ? (reserves.length === 2
        ? binarySellQuote(reserves, oi, ammShares)
        : multiSellQuote(reserves, oi, ammShares))
      : null;
    const collateralOut = orderbook.collateralOut + Number(q?.collateralOut || 0);
    const avgPrice = n > 0 ? collateralOut / n : 0;
    const executionPrice = avgPrice > 0 ? avgPrice : null;
    const lastBookFillPrice = [...(orderbook.fills || [])]
      .reverse()
      .map(fill => Number(fill.price))
      .find(price => Number.isFinite(price) && price > 0);
    const priceAfter = q?.priceAfter ?? lastBookFillPrice ?? executionPrice ?? priceBefore;
    return res.status(200).json({
      shares: n,
      gross: collateralOut,
      fee: Number(q?.fee || 0),
      feePct: q?.feePct || 0,
      collateralOut,
      avgPrice,
      priceBefore,
      priceAfter,
      priceImpactPts: (priceAfter - priceBefore) * 100,
      orderbookFillCount: Array.isArray(orderbook.fills) ? orderbook.fills.length : 0,
    });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-math') || msg.includes('drain')) {
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }
    console.error('[points/quote-sell] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'quote_failed' });
  }
}

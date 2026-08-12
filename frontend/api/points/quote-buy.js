/**
 * POST /api/points/quote-buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Pure read-only quote — computes what the user would receive if they
 * bought right now. Never mutates state. Used by the BuyModal to
 * preview price impact + fee.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryBuyQuote, binaryPrices, multiBuyQuote, multiPrices } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { seriesTradeLockFromRows } from '../_lib/series-markets.js';
import { cryptoTradeLock } from '../_lib/points-crypto-trade-guard.js';
import { previewRestingAsksForBuy } from '../_lib/points-limit-orders.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function readSeriesTradeLock(market) {
  const cfg = parseJsonb(market.resolver_config, null);
  if (cfg?.source !== 'espn' || !cfg?.leaguePath) return null;
  const anchor = market.start_time || market.end_time || market.created_at;
  if (!anchor) return null;
  const rows = await sql`
    SELECT id, question, outcomes, start_time, end_time,
           status, outcome, resolved_at, final_score,
           resolver_config, sport, league
      FROM points_markets
     WHERE parent_id IS NULL
       AND resolver_type = 'sports_api'
       AND resolver_config->>'source' = 'espn'
       AND resolver_config->>'leaguePath' = ${cfg.leaguePath}
       AND start_time >= ${anchor}::timestamptz - INTERVAL '45 days'
       AND start_time <= ${anchor}::timestamptz + INTERVAL '45 days'
     ORDER BY start_time ASC NULLS LAST, id ASC
     LIMIT 80
  `;
  return seriesTradeLockFromRows(market, rows);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Quote is cheap but a bot could spam it on the BuyModal debounce. Cap
  // at 60/min/IP so legit users can retype prices freely without hitting.
  const limited = rateLimit(req, res, {
    key: `quote-buy:${clientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return;

  const { marketId, outcomeIndex, collateral } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'invalid_amount' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT id, question, status, reserves, outcomes, start_time, end_time,
             created_at, resolver_type, resolver_config, sport, league
      FROM points_markets
      WHERE id = ${mid}
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
    const seriesLock = await readSeriesTradeLock(r);
    if (seriesLock?.locked) {
      return res.status(400).json({
        error: seriesLock.status === 'not_needed' ? 'series_game_not_needed' : 'series_game_pending',
        detail: seriesLock.summary || seriesLock.reason,
      });
    }

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length < 2) {
      return res.status(400).json({ error: 'degenerate_reserves' });
    }
    if (oi >= reserves.length) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }

    const askRows = await sql`
      SELECT id, username, limit_price, remaining_amount
        FROM points_limit_orders
       WHERE market_id = ${mid}
         AND outcome_index = ${oi}
         AND side = 'sell'
         AND status = 'open'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY limit_price ASC, created_at ASC, id ASC
       LIMIT 24
    `;
    const orderbook = previewRestingAsksForBuy(askRows, { collateral: amt });
    const ammCollateral = orderbook.remainingCollateral > 0.000001
      ? orderbook.remainingCollateral
      : 0;
    const q = ammCollateral > 0
      ? (reserves.length === 2
        ? binaryBuyQuote(reserves, oi, ammCollateral)
        : multiBuyQuote(reserves, oi, ammCollateral))
      : null;
    const pricesBefore = reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
    const pricesAfter = q?.pricesAfter || pricesBefore;
    const sharesOut = orderbook.sharesOut + Number(q?.sharesOut || 0);
    const collateralSpent = orderbook.collateralSpent + ammCollateral;
    const fee = Number(q?.fee || 0);
    const avgPrice = sharesOut > 0.000001 ? (collateralSpent - fee) / sharesOut : 0;
    const priceBefore = pricesBefore[oi] || 0;
    const priceAfter = pricesAfter[oi] || priceBefore;
    return res.status(200).json({
      collateral: collateralSpent,
      fee,
      feePct: collateralSpent > 0 ? (fee / collateralSpent) * 100 : 0,
      sharesOut,
      avgPrice,
      priceBefore,
      priceAfter,
      priceImpactPts: (priceAfter - priceBefore) * 100,
      pricesBefore,
      pricesAfter,
      orderbookFills: orderbook.fills,
      ammCollateral,
    });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-math')) {
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }
    console.error('[points/quote-buy] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'quote_failed' });
  }
}

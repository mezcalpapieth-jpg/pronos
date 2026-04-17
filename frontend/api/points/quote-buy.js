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
import { binaryBuyQuote } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
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
      SELECT status, reserves, outcomes
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const r = rows[0];
    if (r.status !== 'active') return res.status(400).json({ error: 'market_closed' });

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length !== 2) {
      return res.status(400).json({ error: 'only_binary_supported' });
    }
    if (oi >= reserves.length) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }

    const q = binaryBuyQuote(reserves, oi, amt);
    return res.status(200).json({
      collateral: q.collateral,
      fee: q.fee,
      feePct: q.feePct,
      sharesOut: q.sharesOut,
      avgPrice: q.avgPrice,
      priceBefore: q.priceBefore,
      priceAfter: q.priceAfter,
      priceImpactPts: q.priceImpactPts,
      pricesBefore: q.pricesBefore,
      pricesAfter: q.pricesAfter,
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

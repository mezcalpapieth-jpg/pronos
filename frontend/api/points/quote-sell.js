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
import { binarySellQuote } from '../_lib/amm-math.js';
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
    const rows = await sql`SELECT status, reserves FROM points_markets WHERE id = ${mid} LIMIT 1`;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const r = rows[0];
    if (r.status !== 'active') return res.status(400).json({ error: 'market_closed' });

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length !== 2) return res.status(400).json({ error: 'only_binary_supported' });
    if (oi >= reserves.length) return res.status(400).json({ error: 'invalid_outcome_index' });

    const q = binarySellQuote(reserves, oi, n);
    return res.status(200).json({
      shares: q.shares,
      gross: q.gross,
      fee: q.fee,
      feePct: q.feePct,
      collateralOut: q.collateralOut,
      priceBefore: q.priceBefore,
      priceAfter: q.priceAfter,
      priceImpactPts: q.priceImpactPts,
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

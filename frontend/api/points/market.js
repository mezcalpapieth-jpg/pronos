/**
 * GET /api/points/market?id=<id>
 *
 * Single market + its current reserves + derived prices. Used by the
 * detail page to render the ring chart and buy buttons.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  // Top-level try/catch guarantees JSON output — see markets.js for
  // details on why this matters.
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    try {
      await ensurePointsSchema(schemaSql);

      const rows = await sql`
        SELECT m.*,
          (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
        FROM points_markets m
        WHERE m.id = ${id}
        LIMIT 1
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'market_not_found' });
      }
      const r = rows[0];
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);

      return res.status(200).json({
        market: {
          id: r.id,
          question: r.question,
          category: r.category,
          icon: r.icon,
          outcomes,
          reserves,
          prices,
          seedLiquidity: Number(r.seed_liquidity || 0),
          volume: Number(r.seed_liquidity || 0),
          tradeVolume: Number(r.trade_volume || 0),
          endTime: r.end_time,
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          createdAt: r.created_at,
        },
      });
    } catch (e) {
      console.error('[points/market] db error', { message: e?.message, code: e?.code });
      return res.status(500).json({
        error: 'db_unavailable',
        detail: e?.message?.slice(0, 240) || null,
      });
    }
  } catch (e) {
    console.error('[points/market] unhandled error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

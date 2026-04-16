/**
 * GET /api/points/markets?status=active|resolved&category=X
 *
 * Public list endpoint — no auth required. Returns minimal market data +
 * derived prices so the grid can render without an extra call per card.
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
  // Binary: use the audited helper that matches the AMM contract.
  if (reserves.length === 2) return binaryPrices(reserves);
  // Multi: parallel-binary model assigns each outcome a YES reserve + a
  // NO reserve. For now we model multi as inverse-reserve weighted
  // probabilities that sum to 1 — a coarse approximation that's fine
  // for the grid view (exact math happens on quote/buy via the backend).
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const status = req.query.status === 'resolved' ? 'resolved' : 'active';
  const category = typeof req.query.category === 'string' ? req.query.category : null;

  try {
    await ensurePointsSchema(schemaSql);

    const rows = category
      ? await sql`
          SELECT m.*,
            (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
          FROM points_markets m
          WHERE m.status = ${status} AND m.category = ${category}
          ORDER BY m.end_time ASC
          LIMIT 100
        `
      : await sql`
          SELECT m.*,
            (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
          FROM points_markets m
          WHERE m.status = ${status}
          ORDER BY m.end_time ASC
          LIMIT 100
        `;

    const markets = rows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);
      return {
        id: r.id,
        question: r.question,
        category: r.category,
        icon: r.icon,
        outcomes,
        reserves,
        prices,
        seedLiquidity: Number(r.seed_liquidity || 0),
        volume: Number(r.seed_liquidity || 0),    // tradable depth proxy
        tradeVolume: Number(r.trade_volume || 0), // actual collateral traded
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
      };
    });

    return res.status(200).json({ markets });
  } catch (e) {
    console.error('[points/markets] db error', {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}

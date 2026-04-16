/**
 * GET /api/points/admin/markets?status=all|active|resolved
 *
 * Admin-only full market list (including expired / resolved) with trade
 * counts. Used by the admin panel to pick what to resolve.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const filter = ['all', 'active', 'resolved'].includes(req.query.status) ? req.query.status : 'all';

  try {
    await ensurePointsSchema(schemaSql);
    const rows = filter === 'all'
      ? await sql`
          SELECT m.*,
            (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
          FROM points_markets m
          ORDER BY m.created_at DESC
          LIMIT 200
        `
      : await sql`
          SELECT m.*,
            (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
          FROM points_markets m
          WHERE m.status = ${filter}
          ORDER BY m.created_at DESC
          LIMIT 200
        `;

    return res.status(200).json({
      markets: rows.map(r => ({
        id: r.id,
        question: r.question,
        category: r.category,
        icon: r.icon,
        outcomes: parseJsonb(r.outcomes, ['Sí', 'No']),
        reserves: parseJsonb(r.reserves, []).map(Number),
        seedLiquidity: Number(r.seed_liquidity || 0),
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        tradeCount: r.trade_count || 0,
      })),
    });
  } catch (e) {
    console.error('[admin/markets] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'list_failed' });
  }
}

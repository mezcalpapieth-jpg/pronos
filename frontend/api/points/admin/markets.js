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

  const filter = ['all', 'active', 'pending', 'resolved', 'archived'].includes(req.query.status) ? req.query.status : 'all';
  // Same mode split as the public /api/points/markets — lets the MVP
  // admin query only on-chain markets while Points admin stays on
  // off-chain ones. Omitted ⇒ no filter (shows everything; historic
  // behaviour).
  const modeParam = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : '';
  const modeFilter = modeParam === 'onchain' ? 'onchain'
                    : modeParam === 'points' ? 'points'
                    : null;
  // Chain filter: MVP admin scopes to whatever chain is currently
  // active (Sepolia 421614, Arbitrum One 42161, etc). When omitted the
  // admin sees markets across every chain.
  const chainIdRaw = req.query.chain_id;
  const chainIdFilter = Number.isFinite(Number(chainIdRaw)) && Number(chainIdRaw) > 0
    ? Number(chainIdRaw)
    : null;
  // By default we hide archived (soft-deleted) rows from the admin
  // lists too — they only surface on the explicit `status=archived`
  // tab or when `show_archived=1`.
  const showArchived = req.query.show_archived === '1' || filter === 'archived';

  try {
    await ensurePointsSchema(schemaSql);
    // Parallel legs (parent_id IS NOT NULL) are implicit children of
    // their parent — hiding them here keeps the admin table uncluttered
    // for markets with many outcomes. Admin resolves the parent; the
    // resolve endpoint cascades to every leg.
    let rows;
    if (filter === 'archived') {
      rows = await sql`
        SELECT m.*,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
        FROM points_markets m
        WHERE m.parent_id IS NULL
          AND m.archived_at IS NOT NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
        ORDER BY m.archived_at DESC
        LIMIT 200
      `;
    } else if (filter === 'all') {
      rows = await sql`
        SELECT m.*,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
        FROM points_markets m
        WHERE m.parent_id IS NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
        ORDER BY m.created_at DESC
        LIMIT 200
      `;
    } else if (filter === 'pending') {
      rows = await sql`
        SELECT m.*,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
        FROM points_markets m
        WHERE m.status = 'active'
          AND m.parent_id IS NULL
          AND m.end_time IS NOT NULL
          AND m.end_time < NOW()
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
        ORDER BY m.end_time ASC
        LIMIT 200
      `;
    } else {
      rows = await sql`
        SELECT m.*,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id) AS trade_count
        FROM points_markets m
        WHERE m.status = ${filter} AND m.parent_id IS NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
        ORDER BY m.created_at DESC
        LIMIT 200
      `;
    }

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
        ammMode: r.amm_mode || 'unified',
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        tradeCount: r.trade_count || 0,
        featured: r.featured === true || r.featured === false ? r.featured : true,
        resolverType: r.resolver_type || null,
        mode: r.mode || 'points',
        chainId: r.chain_id || null,
        chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
        chainAddress: r.chain_address || null,
        sport: r.sport || null,
        league: r.league || null,
        archivedAt: r.archived_at || null,
      })),
    });
  } catch (e) {
    console.error('[admin/markets] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'list_failed' });
  }
}

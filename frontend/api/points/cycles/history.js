/**
 * GET /api/points/cycles/history?limit=10
 *
 * Returns closed cycles with their top-10 snapshot. Drives a "winners of
 * past cycles" strip on the home page and inside the admin panel.
 *
 * Response:
 *   {
 *     cycles: [
 *       {
 *         id, label, startedAt, endsAt, closedAt,
 *         top: [{ rank, username, finalBalance, finalPnl }, ...]
 *       }
 *     ]
 *   }
 *
 * No auth — public historical data.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    await ensurePointsSchema(schemaSql);

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10;

    const cycles = await sql`
      SELECT id, label, started_at, ends_at, closed_at
      FROM points_cycles
      WHERE status = 'closed'
      ORDER BY closed_at DESC
      LIMIT ${limit}
    `;

    if (cycles.length === 0) {
      return res.status(200).json({ cycles: [] });
    }

    // One batched query for all snapshots — ordered so we can pick the top
    // N per cycle without an extra round-trip per row.
    const ids = cycles.map(c => c.id);
    const snaps = await sql`
      SELECT cycle_id, username, final_balance, final_pnl, rank
      FROM points_cycle_snapshots
      WHERE cycle_id = ANY(${ids}::int[])
        AND rank <= 10
      ORDER BY cycle_id ASC, rank ASC
    `;

    const byCycle = new Map();
    for (const s of snaps) {
      const arr = byCycle.get(s.cycle_id) || [];
      arr.push({
        rank: s.rank,
        username: s.username,
        finalBalance: Number(s.final_balance),
        finalPnl: Number(s.final_pnl),
      });
      byCycle.set(s.cycle_id, arr);
    }

    return res.status(200).json({
      cycles: cycles.map(c => ({
        id: c.id,
        label: c.label,
        startedAt: c.started_at,
        endsAt: c.ends_at,
        closedAt: c.closed_at,
        top: byCycle.get(c.id) || [],
      })),
    });
  } catch (e) {
    console.error('[points/cycles/history] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

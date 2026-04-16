/**
 * Admin-only cycle management for the points app.
 *
 * Routes (all gated by POINTS_ADMIN_USERNAMES via requirePointsAdmin):
 *
 *   GET /api/points/admin/cycles
 *     Returns the current active cycle + last 10 closed cycles. Drives the
 *     "Ciclos" tab in the admin panel.
 *
 *   POST /api/points/admin/cycles
 *     Body: { action: 'rollover', nextCycleLabel? }
 *     Closes the current active cycle:
 *       1. Snapshots the top-100 leaderboard into points_cycle_snapshots
 *          (username, final_balance, final_pnl, rank).
 *       2. Marks the cycle as 'closed' with closed_at = now.
 *       3. Opens a new active cycle starting now, ends_at in 14 days.
 *     Intentionally does NOT reset user balances — users keep their MXNP,
 *     the snapshot just serves as a historical record. Prize payouts are
 *     dispatched off-platform (admin reaches out to the top winners).
 *
 * Response on rollover:
 *   { ok: true, closedCycleId, newCycleId, snapshotted, winners: [top 3] }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const sql = neon(process.env.DATABASE_URL);

const CYCLE_DAYS = 14;

function cycleLabel(startIso) {
  try {
    const start = new Date(startIso);
    const end = new Date(start.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
    return `Ciclo ${fmt.format(start)} — ${fmt.format(end)}`;
  } catch {
    return null;
  }
}

async function handleGet(req, res) {
  const current = await sql`
    SELECT id, label, started_at, ends_at, status, created_at, closed_at
    FROM points_cycles
    WHERE status = 'active'
    ORDER BY ends_at DESC
    LIMIT 1
  `;
  const closed = await sql`
    SELECT id, label, started_at, ends_at, status, closed_at, created_at,
      (SELECT COUNT(*) FROM points_cycle_snapshots s WHERE s.cycle_id = c.id) AS snapshot_count
    FROM points_cycles c
    WHERE status = 'closed'
    ORDER BY closed_at DESC
    LIMIT 10
  `;
  return res.status(200).json({
    current: current[0]
      ? {
          id: current[0].id,
          label: current[0].label,
          startedAt: current[0].started_at,
          endsAt: current[0].ends_at,
          status: current[0].status,
          pastDeadline: new Date(current[0].ends_at).getTime() <= Date.now(),
        }
      : null,
    closed: closed.map(r => ({
      id: r.id,
      label: r.label,
      startedAt: r.started_at,
      endsAt: r.ends_at,
      closedAt: r.closed_at,
      snapshotCount: Number(r.snapshot_count || 0),
    })),
  });
}

async function handleRollover(req, res, nextCycleLabel) {
  const result = await withTransaction(async (client) => {
    // Lock the current active cycle. `FOR UPDATE` prevents two admins
    // from rolling over simultaneously.
    const cur = await client.query(
      `SELECT id, label, started_at, ends_at
       FROM points_cycles
       WHERE status = 'active'
       ORDER BY ends_at DESC
       LIMIT 1
       FOR UPDATE`,
    );
    if (cur.rows.length === 0) {
      const err = new Error('no_active_cycle'); err.status = 409; throw err;
    }
    const activeCycle = cur.rows[0];

    // Snapshot the top 100 users by final balance. PnL = balance - 500
    // (the signup bonus) is a crude proxy — a richer version would track
    // per-cycle PnL from trades, but this is enough for a leaderboard.
    const SIGNUP = 500;
    const top = await client.query(
      `SELECT u.username,
              COALESCE(b.balance, 0) AS final_balance,
              COALESCE(b.balance, 0) - ${SIGNUP} AS final_pnl
       FROM points_users u
       LEFT JOIN points_balances b ON b.username = u.username
       WHERE u.username IS NOT NULL
       ORDER BY final_balance DESC NULLS LAST
       LIMIT 100`,
    );

    // Bulk-insert snapshots with sequential rank.
    let rank = 0;
    for (const row of top.rows) {
      rank += 1;
      await client.query(
        `INSERT INTO points_cycle_snapshots (cycle_id, username, final_balance, final_pnl, rank)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cycle_id, username) DO NOTHING`,
        [activeCycle.id, row.username, row.final_balance, row.final_pnl, rank],
      );
    }

    // Close the active cycle.
    await client.query(
      `UPDATE points_cycles
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [activeCycle.id],
    );

    // Open the next cycle — 14 days starting now.
    const now = new Date();
    const startIso = now.toISOString();
    const endIso = new Date(now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const label = nextCycleLabel && typeof nextCycleLabel === 'string'
      ? nextCycleLabel.slice(0, 80)
      : cycleLabel(startIso);
    const inserted = await client.query(
      `INSERT INTO points_cycles (label, started_at, ends_at, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, label, started_at, ends_at`,
      [label, startIso, endIso],
    );

    return {
      closedCycleId: activeCycle.id,
      newCycle: inserted.rows[0],
      snapshotted: top.rows.length,
      winners: top.rows.slice(0, 3).map((r, i) => ({
        rank: i + 1,
        username: r.username,
        finalBalance: Number(r.final_balance),
      })),
    };
  });

  return res.status(200).json({ ok: true, ...result });
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;

    const session = requirePointsAdmin(req, res);
    if (!session) return; // requirePointsAdmin already sent 401/403

    await ensurePointsSchema(sql);

    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') {
      const { action, nextCycleLabel } = req.body || {};
      if (action !== 'rollover') {
        return res.status(400).json({ error: 'invalid_action' });
      }
      try {
        return await handleRollover(req, res, nextCycleLabel);
      } catch (e) {
        if (e?.status && typeof e?.message === 'string') {
          return res.status(e.status).json({ error: e.message });
        }
        throw e;
      }
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[admin/cycles] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

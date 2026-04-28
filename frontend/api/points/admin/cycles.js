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
 *       1. Snapshots the top-100 leaderboard (by balance) into
 *          points_cycle_snapshots.
 *       2. Marks the cycle as 'closed' with closed_at = now.
 *       3. **Resets every user's balance to 500 MXNP** so the next
 *          cycle starts on a level playing field — per product decision:
 *          "every cycle all wallets reset to 500 MXNP". Each reset is
 *          audited in points_distributions (kind='cycle_reset') with a
 *          delta of (500 - previous_balance) so the ledger stays
 *          balanced.
 *       4. Opens a new active cycle starting now, ends_at in 14 days.
 *
 * Response on rollover:
 *   { ok: true, closedCycleId, newCycleId, snapshotted, resetCount,
 *     winners: [top 3] }
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

// Every cycle restarts at this balance. Must match claim-daily's and
// username.js's signup bonus so a fresh account and a cycle-reset
// account have the same starting point.
const CYCLE_STARTING_BALANCE = 500;

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

    // ── 1. Snapshot the top 100 users by final balance ──────────────
    // final_pnl = balance - 500 (the cycle start). This matches the
    // new leaderboard ranking (balance-based) so the snapshot is the
    // canonical record of "who won what" for this cycle.
    const top = await client.query(
      `SELECT u.username,
              COALESCE(b.balance, 0) AS final_balance,
              COALESCE(b.balance, 0) - ${CYCLE_STARTING_BALANCE} AS final_pnl
       FROM points_users u
       LEFT JOIN points_balances b ON b.username = u.username
       WHERE u.username IS NOT NULL
       ORDER BY final_balance DESC NULLS LAST
       LIMIT 100`,
    );

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

    // ── 2. Reset every wallet to the starting balance ──────────────
    // Per product decision: each cycle is a level playing field. The
    // reset happens for EVERY balance row (not just top-100) so users
    // outside the leaderboard also restart at 500. We also audit each
    // reset as a signed distribution so the ledger stays balanced.
    //
    // We need the *pre-reset* balances to compute the audit deltas, so
    // we SELECT FOR UPDATE first (locking every row we're about to
    // touch — also blocks any concurrent buy/sell during rollover),
    // then UPDATE, then write one audit row per reset. Earlier versions
    // of this code looked up the previous balance in the top-100
    // snapshot only — which silently skipped audit rows for users
    // outside top-100, leaving the ledger out of balance with the
    // actual balance reset.
    const preReset = await client.query(
      `SELECT username, balance
       FROM points_balances
       WHERE balance <> $1
       FOR UPDATE`,
      [CYCLE_STARTING_BALANCE],
    );
    const resetCount = preReset.rows.length;
    if (resetCount > 0) {
      await client.query(
        `UPDATE points_balances
         SET balance = $1, updated_at = NOW()
         WHERE username = ANY($2::text[])`,
        [CYCLE_STARTING_BALANCE, preReset.rows.map(r => r.username)],
      );
      // Bulk-insert audit rows in a single round-trip via UNNEST(). With
      // 10k+ active users a per-row INSERT loop is the slowest part of
      // rollover; this collapses it to one statement.
      const usernames = [];
      const deltas = [];
      for (const row of preReset.rows) {
        const prev = Number(row.balance);
        const delta = CYCLE_STARTING_BALANCE - prev;
        if (delta === 0) continue;
        usernames.push(row.username);
        deltas.push(delta);
      }
      if (usernames.length > 0) {
        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           SELECT u, d, 'cycle_reset', $3, $4
           FROM UNNEST($1::text[], $2::int[]) AS t(u, d)`,
          [
            usernames,
            deltas,
            activeCycle.id,
            `Reinicio de ciclo #${activeCycle.id} — balance volvió a ${CYCLE_STARTING_BALANCE} MXNP`,
          ],
        );
      }
    }

    // ── 3. Close the active cycle ───────────────────────────────────
    await client.query(
      `UPDATE points_cycles
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [activeCycle.id],
    );

    // ── 4. Open the next cycle ──────────────────────────────────────
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
      resetCount,
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

/**
 * Admin-only cycle management for the points app.
 *
 * Routes (all gated by POINTS_ADMIN_USERNAMES via requirePointsAdmin):
 *
 *   GET /api/points/admin/cycles
 *     Returns public pause state, the current active cycle + last 10 closed
 *     cycles. Drives the "Ciclos" tab in the admin panel.
 *
 *   POST /api/points/admin/cycles
 *     Body: { action: 'rollover', nextCycleLabel? } or { action: 'pause' }
 *     Closes the current active cycle:
 *       1. Snapshots the top-100 leaderboard (by tournament score) into
 *          points_cycle_snapshots.
 *       2. Marks the cycle as 'closed' with closed_at = now.
 *       3. **Resets every user's balance to the tournament starting balance**
 *          cycle starts on a level playing field — per product decision:
 *          "every cycle all wallets reset". Each reset is
 *          audited in points_distributions (kind='cycle_reset') with a
 *          delta of (tournament starting balance - previous_balance) so
 *          the ledger stays balanced.
 *       4. Opens a new active cycle starting now, ends_at in 14 days.
 *
 * Response on rollover:
 *   { ok: true, closedCycleId, newCycleId, snapshotted, resetCount,
 *     winners: [top 5] }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import {
  TOURNAMENT_STARTING_BALANCE,
} from '../../_lib/points-tournament-config.js';
import { buildTournamentLeaderboardRows } from '../../_lib/points-tournament-leaderboard.js';

const sql = neon(process.env.DATABASE_URL);

const CYCLE_DAYS = 14;
const CYCLES_PAUSED_KEY = 'points_cycles_paused';

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

function parseSettingBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.paused === 'boolean') return value.paused;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

async function getCyclesPaused() {
  const rows = await sql`
    SELECT value
    FROM points_app_settings
    WHERE key = ${CYCLES_PAUSED_KEY}
    LIMIT 1
  `;
  return parseSettingBool(rows[0]?.value, true);
}

async function setCyclesPaused(client, paused) {
  await client.query(
    `INSERT INTO points_app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value,
         updated_at = NOW()`,
    [CYCLES_PAUSED_KEY, JSON.stringify(Boolean(paused))],
  );
}

async function openNewCycle(client, nextCycleLabel) {
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
  return inserted.rows[0];
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
  const paused = await getCyclesPaused();
  return res.status(200).json({
    paused,
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

// Every cycle restarts at the tournament starting balance. A fresh
// account and a cycle-reset account should begin from the same baseline.
const CYCLE_STARTING_BALANCE = TOURNAMENT_STARTING_BALANCE;

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
      const newCycle = await openNewCycle(client, nextCycleLabel);
      await setCyclesPaused(client, false);
      return {
        restarted: true,
        closedCycleId: null,
        newCycle,
        newCycleId: newCycle.id,
        snapshotted: 0,
        resetCount: 0,
        winners: [],
      };
    }
    const activeCycle = cur.rows[0];

    // ── 1. Snapshot the top 100 users by tournament score ───────────
    const top = await buildTournamentLeaderboardRows(client, { limit: 100, now: new Date() });

    let rank = 0;
    for (const row of top) {
      rank += 1;
      await client.query(
        `INSERT INTO points_cycle_snapshots (
           cycle_id, username, final_balance, final_pnl, rank,
           tournament_score, market_pnl, current_position_value,
           inactivity_penalty, inactive_days, active_days,
           qualifying_markets, qualified
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (cycle_id, username) DO NOTHING`,
        [
          activeCycle.id,
          row.username,
          row.balance,
          row.score,
          rank,
          row.score,
          row.marketPnl,
          row.currentPositionValue,
          row.inactivityPenalty,
          row.inactiveDays,
          row.activeDays,
          row.qualifyingMarkets,
          row.qualified,
        ],
      );
    }

    // ── 2. Reset every wallet to the starting balance ──────────────
    // Per product decision: each cycle is a level playing field. The
    // reset happens for EVERY balance row (not just top-100) so users
    // outside the leaderboard also restart at the same baseline. We also audit each
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
        // points_distributions.amount is NUMERIC(20,6) — keep the
        // fractional part so balances that ended on a decimal (after
        // CPMM trades) reset audit-correctly. Earlier this was cast to
        // int[] which threw "invalid input syntax for type integer" on
        // any non-integer balance (e.g. 3653.581803). Stringify so the
        // node-postgres driver doesn't do scientific notation on large
        // deltas before Postgres sees them.
        deltas.push(delta.toFixed(6));
      }
      if (usernames.length > 0) {
        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           SELECT u, d, 'cycle_reset', $3, $4
           FROM UNNEST($1::text[], $2::numeric[]) AS t(u, d)`,
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

    // ── 4. Open the next cycle and unpause public cycle UI ───────────
    const newCycle = await openNewCycle(client, nextCycleLabel);
    await setCyclesPaused(client, false);

    return {
      closedCycleId: activeCycle.id,
      newCycle,
      newCycleId: newCycle.id,
      snapshotted: top.length,
      resetCount,
      winners: top.slice(0, 5).map((r, i) => ({
        rank: i + 1,
        username: r.username,
        finalBalance: Number(r.balance),
        score: Number(r.score),
      })),
    };
  });

  return res.status(200).json({ ok: true, ...result });
}

async function handlePause(req, res) {
  await withTransaction(async (client) => {
    await setCyclesPaused(client, true);
  });
  return res.status(200).json({ ok: true, paused: true });
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
      if (action === 'pause') {
        return await handlePause(req, res);
      }
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

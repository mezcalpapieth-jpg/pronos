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
 *       2. Archives and clears materialized positions, then cancels open
 *          limit orders so old exposure cannot leak into the next cycle.
 *       3. Marks the cycle as 'closed' with closed_at = now.
 *       4. Opens a new active cycle starting now, ends_at in 14 days.
 *       5. Resets balances to the tournament starting balance. The first
 *          bootstrap reset also carries forward only pre-cycle promotional
 *          bonuses: 200 MXNP for existing signups, 50 MXNP per referral,
 *          approved follow tasks, and credited social links.
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
  TOURNAMENT_REWARDS,
} from '../../_lib/points-tournament-config.js';
import {
  buildTournamentLeaderboardRows,
  cycleWindowFromRow,
} from '../../_lib/points-tournament-leaderboard.js';

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
const PRE_CYCLE_SIGNUP_BONUS = TOURNAMENT_REWARDS.preCycleSignupBonus;
const PRE_CYCLE_REFERRAL_REWARD = TOURNAMENT_REWARDS.preCycleReferralReward;
const PRE_CYCLE_FOLLOW_TASK_KEYS = ['instagram_follow', 'tiktok_follow', 'twitter_follow'];
const SOCIAL_LINK_CARRYOVER_KINDS = ['social_link_instagram', 'social_link_tiktok', 'social_link_x'];

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numericSql(value) {
  return numeric(value).toFixed(6);
}

function cycleResetReason(cycleId) {
  return `Reinicio de ciclo #${cycleId} — balance base ${CYCLE_STARTING_BALANCE} MXNP`;
}

async function snapshotLeaderboard(client, activeCycle, now) {
  if (!activeCycle) return [];
  const top = await buildTournamentLeaderboardRows(client, {
    limit: 100,
    now,
    window: cycleWindowFromRow(activeCycle),
  });

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
  return top;
}

async function cancelOpenLimitOrdersForCycleReset(client) {
  const result = await client.query(
    `WITH open_orders AS (
       SELECT id, side, remaining_amount, reserved_collateral, reserved_shares
       FROM points_limit_orders
       WHERE status = 'open'
       FOR UPDATE
     ),
     updated AS (
       UPDATE points_limit_orders
       SET status = 'cancelled',
           remaining_amount = 0,
           reserved_collateral = 0,
           reserved_shares = 0,
           reason = 'cycle_reset',
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id IN (SELECT id FROM open_orders)
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*) FROM updated) AS cancelled_count,
       COALESCE(SUM(CASE WHEN side = 'buy' THEN remaining_amount ELSE 0 END), 0) AS cleared_buy_reserves,
       COALESCE(SUM(CASE WHEN side = 'sell' THEN reserved_shares ELSE 0 END), 0) AS cleared_sell_reserves
     FROM open_orders`,
  );
  const row = result.rows[0] || {};
  return {
    cancelledOrders: Number(row.cancelled_count || 0),
    clearedBuyReserves: numeric(row.cleared_buy_reserves),
    clearedSellReserves: numeric(row.cleared_sell_reserves),
  };
}

async function archiveAndClearPositionsForCycleReset(client, cycleId) {
  const result = await client.query(
    `WITH position_rows AS (
       SELECT market_id, username, outcome_index, shares, cost_basis, realized_pnl
       FROM points_positions
       WHERE ABS(COALESCE(shares, 0)) > 0.000000000001
          OR ABS(COALESCE(cost_basis, 0)) > 0.000001
          OR ABS(COALESCE(realized_pnl, 0)) > 0.000001
       FOR UPDATE
     ),
     archived AS (
       INSERT INTO points_cycle_position_snapshots (
         cycle_id, username, market_id, outcome_index, shares, cost_basis, realized_pnl
       )
       SELECT $1, username, market_id, outcome_index, shares, cost_basis, realized_pnl
       FROM position_rows
       RETURNING id
     ),
     cleared AS (
       UPDATE points_positions
       SET shares = 0,
           cost_basis = 0,
           realized_pnl = 0,
           dismissed_at = COALESCE(dismissed_at, NOW()),
           updated_at = NOW()
       WHERE (market_id, username, outcome_index) IN (
         SELECT market_id, username, outcome_index FROM position_rows
       )
       RETURNING 1
     )
     SELECT
       (SELECT COUNT(*) FROM archived) AS archived_count,
       (SELECT COUNT(*) FROM cleared) AS cleared_count`,
    [cycleId],
  );
  const row = result.rows[0] || {};
  return {
    archivedPositions: Number(row.archived_count || 0),
    clearedPositions: Number(row.cleared_count || 0),
  };
}

async function selectCycleResetBalances(client, {
  resetAtIso,
  includePreCycleCarryover = false,
} = {}) {
  await client.query(`SELECT username FROM points_balances FOR UPDATE`);

  const referralReward = includePreCycleCarryover ? PRE_CYCLE_REFERRAL_REWARD : 0;
  const signupBonus = includePreCycleCarryover ? PRE_CYCLE_SIGNUP_BONUS : 0;
  const followTaskKeys = includePreCycleCarryover ? PRE_CYCLE_FOLLOW_TASK_KEYS : [];
  const socialLinkKinds = includePreCycleCarryover ? SOCIAL_LINK_CARRYOVER_KINDS : [];

  const result = await client.query(
    `WITH known_users AS (
       SELECT LOWER(username) AS username
       FROM points_users
       WHERE username IS NOT NULL
       UNION
       SELECT LOWER(username) AS username
       FROM points_balances
       WHERE username IS NOT NULL
     ),
     signup AS (
       SELECT LOWER(username) AS username, $5::numeric AS amount
       FROM points_users
       WHERE username IS NOT NULL
         AND created_at <= $1::timestamptz
     ),
     referrals AS (
       SELECT LOWER(referrer) AS username,
              COUNT(*)::numeric * $2::numeric AS amount
       FROM points_referrals
       WHERE created_at <= $1::timestamptz
       GROUP BY LOWER(referrer)
     ),
     manual_social AS (
       SELECT LOWER(username) AS username,
              SUM(COALESCE(reward, 0))::numeric AS amount
       FROM social_tasks
       WHERE status = 'approved'
         AND task_key = ANY($3::text[])
         AND COALESCE(reviewed_at, created_at) <= $1::timestamptz
       GROUP BY LOWER(username)
     ),
     oauth_social AS (
       SELECT LOWER(username) AS username,
              SUM(GREATEST(amount, 0))::numeric AS amount
       FROM points_distributions
       WHERE kind = ANY($4::text[])
         AND amount > 0
         AND created_at <= $1::timestamptz
       GROUP BY LOWER(username)
     )
     SELECT
       u.username,
       COALESCE(b.balance, 0) AS previous_balance,
       $6::numeric AS baseline_balance,
       COALESCE(s.amount, 0) AS signup_bonus,
       COALESCE(r.amount, 0) AS referral_bonus,
       COALESCE(ms.amount, 0) + COALESCE(os.amount, 0) AS social_bonus,
       $6::numeric
         + COALESCE(s.amount, 0)
         + COALESCE(r.amount, 0)
         + COALESCE(ms.amount, 0)
         + COALESCE(os.amount, 0) AS target_balance
     FROM known_users u
     LEFT JOIN points_balances b ON LOWER(b.username) = u.username
     LEFT JOIN signup s ON s.username = u.username
     LEFT JOIN referrals r ON r.username = u.username
     LEFT JOIN manual_social ms ON ms.username = u.username
     LEFT JOIN oauth_social os ON os.username = u.username
     ORDER BY u.username`,
    [
      resetAtIso,
      referralReward,
      followTaskKeys,
      socialLinkKinds,
      signupBonus,
      CYCLE_STARTING_BALANCE,
    ],
  );
  return result.rows;
}

async function resetBalancesForCycle(client, {
  cycleId,
  resetAtIso,
  includePreCycleCarryover = false,
} = {}) {
  const rows = await selectCycleResetBalances(client, { resetAtIso, includePreCycleCarryover });
  if (rows.length === 0) {
    return {
      balanceRows: 0,
      resetCount: 0,
      carryoverUsers: 0,
      carryoverTotal: 0,
      signupBonusTotal: 0,
      referralBonusTotal: 0,
      socialBonusTotal: 0,
    };
  }

  const usernames = rows.map(row => row.username);
  const targetBalances = rows.map(row => numericSql(row.target_balance));
  await client.query(
    `INSERT INTO points_balances (username, balance, updated_at)
     SELECT u, b, NOW()
     FROM UNNEST($1::text[], $2::numeric[]) AS t(u, b)
     ON CONFLICT (username) DO UPDATE
     SET balance = EXCLUDED.balance,
         updated_at = NOW()`,
    [usernames, targetBalances],
  );

  const resetUsers = [];
  const resetDeltas = [];
  const carryoverUsers = [];
  const carryoverAmounts = [];
  const carryoverReasons = [];
  let signupBonusTotal = 0;
  let referralBonusTotal = 0;
  let socialBonusTotal = 0;

  for (const row of rows) {
    const previousBalance = numeric(row.previous_balance);
    const resetDelta = CYCLE_STARTING_BALANCE - previousBalance;
    const signupBonus = numeric(row.signup_bonus);
    const referralBonus = numeric(row.referral_bonus);
    const socialBonus = numeric(row.social_bonus);
    const carryover = signupBonus + referralBonus + socialBonus;
    signupBonusTotal += signupBonus;
    referralBonusTotal += referralBonus;
    socialBonusTotal += socialBonus;

    if (Math.abs(resetDelta) > 0.000001) {
      resetUsers.push(row.username);
      resetDeltas.push(numericSql(resetDelta));
    }
    if (carryover > 0.000001) {
      carryoverUsers.push(row.username);
      carryoverAmounts.push(numericSql(carryover));
      carryoverReasons.push(
        `Bonos preciclo conservados: registro ${numericSql(signupBonus)} MXNP, referidos ${numericSql(referralBonus)} MXNP, sociales ${numericSql(socialBonus)} MXNP`,
      );
    }
  }

  if (resetUsers.length > 0) {
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       SELECT u, d, 'cycle_reset', $3, $4
       FROM UNNEST($1::text[], $2::numeric[]) AS t(u, d)`,
      [resetUsers, resetDeltas, cycleId, cycleResetReason(cycleId)],
    );
  }

  if (carryoverUsers.length > 0) {
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       SELECT u, a, 'cycle_carryover', $3, r
       FROM UNNEST($1::text[], $2::numeric[], $4::text[]) AS t(u, a, r)`,
      [carryoverUsers, carryoverAmounts, cycleId, carryoverReasons],
    );
  }

  return {
    balanceRows: rows.length,
    resetCount: rows.filter(row => Math.abs(numeric(row.previous_balance) - numeric(row.target_balance)) > 0.000001).length,
    carryoverUsers: carryoverUsers.length,
    carryoverTotal: numericSql(signupBonusTotal + referralBonusTotal + socialBonusTotal),
    signupBonusTotal: numericSql(signupBonusTotal),
    referralBonusTotal: numericSql(referralBonusTotal),
    socialBonusTotal: numericSql(socialBonusTotal),
  };
}

async function handleRollover(req, res, nextCycleLabel) {
  const result = await withTransaction(async (client) => {
    const now = new Date();
    const resetAtIso = now.toISOString();
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
      const positions = await archiveAndClearPositionsForCycleReset(client, newCycle.id);
      const orders = await cancelOpenLimitOrdersForCycleReset(client);
      const balances = await resetBalancesForCycle(client, {
        cycleId: newCycle.id,
        resetAtIso,
        includePreCycleCarryover: true,
      });
      await setCyclesPaused(client, false);
      return {
        restarted: true,
        closedCycleId: null,
        newCycle,
        newCycleId: newCycle.id,
        snapshotted: 0,
        resetCount: balances.resetCount,
        balanceRows: balances.balanceRows,
        carryoverUsers: balances.carryoverUsers,
        carryoverTotal: Number(balances.carryoverTotal),
        signupBonusTotal: Number(balances.signupBonusTotal),
        referralBonusTotal: Number(balances.referralBonusTotal),
        socialBonusTotal: Number(balances.socialBonusTotal),
        archivedPositions: positions.archivedPositions,
        clearedPositions: positions.clearedPositions,
        cancelledOrders: orders.cancelledOrders,
        winners: [],
      };
    }
    const activeCycle = cur.rows[0];

    // ── 1. Snapshot the top 100 users by tournament score ───────────
    const top = await snapshotLeaderboard(client, activeCycle, now);

    // ── 2. Clear old exposure before the next cycle opens ──────────
    const positions = await archiveAndClearPositionsForCycleReset(client, activeCycle.id);
    const orders = await cancelOpenLimitOrdersForCycleReset(client);

    // ── 3. Close the active cycle ───────────────────────────────────
    await client.query(
      `UPDATE points_cycles
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [activeCycle.id],
    );

    // ── 4. Open the next cycle and unpause public cycle UI ───────────
    const newCycle = await openNewCycle(client, nextCycleLabel);
    const balances = await resetBalancesForCycle(client, {
      cycleId: newCycle.id,
      resetAtIso,
      includePreCycleCarryover: false,
    });
    await setCyclesPaused(client, false);

    return {
      closedCycleId: activeCycle.id,
      newCycle,
      newCycleId: newCycle.id,
      snapshotted: top.length,
      resetCount: balances.resetCount,
      balanceRows: balances.balanceRows,
      carryoverUsers: balances.carryoverUsers,
      carryoverTotal: Number(balances.carryoverTotal),
      signupBonusTotal: Number(balances.signupBonusTotal),
      referralBonusTotal: Number(balances.referralBonusTotal),
      socialBonusTotal: Number(balances.socialBonusTotal),
      archivedPositions: positions.archivedPositions,
      clearedPositions: positions.clearedPositions,
      cancelledOrders: orders.cancelledOrders,
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

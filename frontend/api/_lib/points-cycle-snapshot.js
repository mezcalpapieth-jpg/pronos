import {
  buildTournamentLeaderboardRows,
  cycleWindowFromRow,
} from './points-tournament-leaderboard.js';
import { roundTournamentAmount } from './points-tournament-config.js';

export const DEFAULT_CYCLE_SNAPSHOT_LIMIT = 5000;

async function queryRows(db, text, params = []) {
  const result = await db.query(text, params);
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function snapshotRow(row) {
  const score = row.tournament_score ?? row.final_pnl ?? 0;
  const qualified = row.qualified === true || row.qualified === 't' || row.qualified === 'true';
  return {
    rank: Number(row.rank || 0) || null,
    username: row.username,
    createdAt: null,
    balance: roundTournamentAmount(row.final_balance),
    finalBalance: roundTournamentAmount(row.final_balance),
    score: roundTournamentAmount(score),
    cycleDelta: roundTournamentAmount(score),
    marketPnl: roundTournamentAmount(row.market_pnl ?? row.final_pnl ?? 0),
    currentPositionValue: roundTournamentAmount(row.current_position_value ?? 0),
    inactivityPenalty: roundTournamentAmount(row.inactivity_penalty ?? 0),
    inactiveDays: Number(row.inactive_days || 0),
    activeDays: Number(row.active_days || 0),
    qualifyingMarkets: Number(row.qualifying_markets || 0),
    qualified,
    totalActions: 0,
    buyCount: 0,
  };
}

async function readActiveCycle(db, { forUpdate = false } = {}) {
  const rows = await queryRows(db, `
    SELECT id, label, started_at, ends_at
    FROM points_cycles
    WHERE status = 'active'
    ORDER BY ends_at DESC
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
  `);
  return rows[0] || null;
}

async function countCycleSnapshots(db, cycleId) {
  const rows = await queryRows(db, `
    SELECT COUNT(*)::int AS count
    FROM points_cycle_snapshots
    WHERE cycle_id = $1
  `, [cycleId]);
  return Number(rows[0]?.count || 0);
}

export async function readCycleSnapshotRows(db, { cycleId, limit = DEFAULT_CYCLE_SNAPSHOT_LIMIT } = {}) {
  const id = Number(cycleId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const rows = await queryRows(db, `
    SELECT username, final_balance, final_pnl, rank,
           tournament_score, market_pnl, current_position_value,
           inactivity_penalty, inactive_days, active_days,
           qualifying_markets, qualified
    FROM points_cycle_snapshots
    WHERE cycle_id = $1
    ORDER BY rank ASC, username ASC
    LIMIT $2
  `, [id, Math.max(1, Number(limit) || DEFAULT_CYCLE_SNAPSHOT_LIMIT)]);
  return rows.map(snapshotRow);
}

export async function snapshotCycleLeaderboard(
  client,
  activeCycle,
  { now = new Date(), limit = DEFAULT_CYCLE_SNAPSHOT_LIMIT } = {},
) {
  if (!activeCycle?.id) return [];

  const existingCount = await countCycleSnapshots(client, activeCycle.id);
  if (existingCount > 0) {
    return readCycleSnapshotRows(client, { cycleId: activeCycle.id, limit });
  }

  const top = await buildTournamentLeaderboardRows(client, {
    limit,
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
        numeric(row.balance),
        numeric(row.score),
        Number(row.rank || rank),
        numeric(row.score),
        numeric(row.marketPnl),
        numeric(row.currentPositionValue),
        numeric(row.inactivityPenalty),
        Number(row.inactiveDays || 0),
        Number(row.activeDays || 0),
        Number(row.qualifyingMarkets || 0),
        row.qualified === true,
      ],
    );
  }

  return readCycleSnapshotRows(client, { cycleId: activeCycle.id, limit });
}

export async function readActiveCycleCutoffSnapshotStatus(db, { now = new Date() } = {}) {
  const activeCycle = await readActiveCycle(db);
  if (!activeCycle) {
    return {
      activeCycle: null,
      window: null,
      cutoffPassed: false,
      snapshotTaken: false,
      snapshotCount: 0,
      cutoffAt: null,
    };
  }

  const window = cycleWindowFromRow(activeCycle);
  const cutoffAt = window?.rankingCutoffAt || activeCycle.ends_at;
  const cutoffMs = new Date(cutoffAt).getTime();
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const cutoffPassed = Number.isFinite(cutoffMs) && Number.isFinite(nowMs) && nowMs >= cutoffMs;
  const snapshotCount = cutoffPassed ? await countCycleSnapshots(db, activeCycle.id) : 0;

  return {
    activeCycle,
    window,
    cutoffPassed,
    snapshotTaken: snapshotCount > 0,
    snapshotCount,
    cutoffAt,
  };
}

export async function readFrozenLeaderboardRowsForActiveCutoff(
  db,
  { now = new Date(), limit = DEFAULT_CYCLE_SNAPSHOT_LIMIT } = {},
) {
  const status = await readActiveCycleCutoffSnapshotStatus(db, { now });
  if (!status.cutoffPassed || !status.snapshotTaken || !status.activeCycle?.id) return null;
  const rows = await readCycleSnapshotRows(db, {
    cycleId: status.activeCycle.id,
    limit,
  });
  if (rows.length === 0) return null;
  return {
    ...status,
    rows,
  };
}

export async function snapshotActiveCycleAtCutoff(
  client,
  { now = new Date(), limit = DEFAULT_CYCLE_SNAPSHOT_LIMIT } = {},
) {
  const activeCycle = await readActiveCycle(client, { forUpdate: true });
  if (!activeCycle) {
    return {
      ok: true,
      skipped: 'no_active_cycle',
      snapshotted: 0,
      winners: [],
    };
  }

  const window = cycleWindowFromRow(activeCycle);
  const cutoffAt = window?.rankingCutoffAt || activeCycle.ends_at;
  const cutoffMs = new Date(cutoffAt).getTime();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(cutoffMs) || nowDate.getTime() < cutoffMs) {
    return {
      ok: true,
      skipped: 'before_cutoff',
      cycleId: activeCycle.id,
      cycleLabel: window?.label || activeCycle.label,
      cutoffAt,
      snapshotted: 0,
      winners: [],
    };
  }

  const existingCount = await countCycleSnapshots(client, activeCycle.id);
  const rows = await snapshotCycleLeaderboard(client, activeCycle, {
    now: new Date(cutoffMs),
    limit,
  });

  return {
    ok: true,
    skipped: existingCount > 0 ? 'already_snapshotted' : null,
    cycleId: activeCycle.id,
    cycleLabel: window?.label || activeCycle.label,
    cutoffAt,
    snapshotted: rows.length,
    winners: rows.slice(0, 5).map(row => ({
      rank: row.rank,
      username: row.username,
      finalBalance: row.finalBalance,
      score: row.score,
    })),
  };
}

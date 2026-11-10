import { rows } from './stock-data.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';

export async function readStockCycle(db, { lock = false } = {}) {
  const [cycle] = await rows(db, `SELECT id,label,started_at,ends_at,status FROM points_cycles
    WHERE status='active' ORDER BY ends_at DESC LIMIT 1 ${lock ? 'FOR SHARE' : ''}`);
  return cycle;
}

export async function readStockCyclePhase(db, cycle, now) {
  const window = configuredCycleWindowFromRow(cycle);
  if (!window || now < new Date(window.startsAt).getTime()) return null;
  if (now < new Date(window.operationCloseAt).getTime()) return 'tournament';
  if (now <= new Date(window.rankingCutoffAt).getTime()) return null;

  // The snapshot and the cutoff sales commit together under the exclusive
  // cycle lock. A missing or non-stock snapshot must never reopen trading.
  const [status] = await rows(db, `SELECT EXISTS (
    SELECT 1 FROM points_cycle_snapshots WHERE cycle_id=$1 AND stock_pnl IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM points_stock_positions WHERE cycle_id=$1 AND NOT post_cutoff AND quantity>0
  ) AS ready`, [cycle.id]);
  return status?.ready === true ? 'post_cutoff' : null;
}

export async function stockTradingIsPaused(db) {
  const [setting] = await rows(db, "SELECT value FROM points_app_settings WHERE key='points_cycles_paused'");
  const paused = setting?.value;
  return paused == null || paused === true || paused === 'true' || paused?.paused === true;
}

export function stockValuationMinute(now, cutoff) {
  const minute = Math.floor(now / 60000) * 60000;
  return new Date(cutoff == null ? minute : Math.max(minute, new Date(cutoff).getTime() + 1)).toISOString();
}

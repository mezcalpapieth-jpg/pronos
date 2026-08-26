import {
  TOURNAMENT_MIN_ENTRY_MXNP,
  TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_START_ISO,
  getTournamentWindow,
  tournamentRulesActive,
} from './points-tournament-config.js';
import { resolveTournamentScoringWindow } from './points-tournament-leaderboard.js';
import { readActiveCycleCutoffSnapshotStatus } from './points-cycle-snapshot.js';

function parseJsonb(value, fallback = null) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truthy(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function tournamentMarketSettlementMs(market = {}) {
  const cfg = parseJsonb(market.resolver_config ?? market.resolverConfig, {});
  const closeValue = cfg?.closesAt || market.end_time || market.endTime;
  const closeMs = closeValue ? new Date(closeValue).getTime() : NaN;
  return Number.isFinite(closeMs) ? closeMs : null;
}

export function tournamentSettlementLock(market = {}, now = new Date()) {
  if (!tournamentRulesActive(now) || !truthy(market.tournament_featured ?? market.tournamentFeatured)) {
    return null;
  }

  const window = getTournamentWindow(now);
  const cutoffMs = new Date(window?.rankingCutoffAt || TOURNAMENT_RANKING_CUTOFF_ISO).getTime();
  const settlementMs = tournamentMarketSettlementMs(market);
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(settlementMs)) return null;
  if (settlementMs <= cutoffMs) return null;

  return {
    error: 'tournament_market_after_cutoff',
    status: 400,
    detail: 'Este mercado termina despues del cierre del torneo y no cuenta para este ciclo.',
  };
}

export function assertTournamentSettlementAllowed(market = {}, now = new Date()) {
  const lock = tournamentSettlementLock(market, now);
  if (!lock) return;
  const err = new Error(lock.error);
  err.status = lock.status;
  err.detail = lock.detail;
  throw err;
}

export async function tournamentCutoffSnapshotLock(client, market = {}, now = new Date()) {
  if (!truthy(market.tournament_featured ?? market.tournamentFeatured)) return null;

  const status = await readActiveCycleCutoffSnapshotStatus(client, { now }).catch(() => null);
  if (!status?.cutoffPassed || status.snapshotTaken) return null;

  return {
    error: 'tournament_snapshot_pending',
    status: 423,
    detail: 'Estamos guardando la foto final del torneo. El mercado reabre en cuanto termine.',
  };
}

export async function assertTournamentCutoffSnapshotReady(client, { market = {}, now = new Date() } = {}) {
  const lock = await tournamentCutoffSnapshotLock(client, market, now);
  if (!lock) return;
  const err = new Error(lock.error);
  err.status = lock.status;
  err.detail = lock.detail;
  throw err;
}

async function relatedTournamentMarketIds(client, market) {
  const id = Number(market?.id);
  if (!Number.isInteger(id) || id <= 0) return [];

  const parentId = Number(market?.parent_id);
  if (Number.isInteger(parentId) && parentId > 0) {
    const rows = await client.query(
      `SELECT id
         FROM points_markets
        WHERE id = $1 OR parent_id = $1`,
      [parentId],
    );
    return rows.rows.map(row => Number(row.id)).filter(Number.isInteger);
  }

  if (String(market?.amm_mode || market?.ammMode || '') === 'parallel') {
    const rows = await client.query(
      `SELECT id
         FROM points_markets
        WHERE id = $1 OR parent_id = $1`,
      [id],
    );
    return rows.rows.map(row => Number(row.id)).filter(Number.isInteger);
  }

  return [id];
}

export async function hasCoveredTournamentMarket(client, { market, username } = {}) {
  if (!username || !market?.id) return false;
  const ids = await relatedTournamentMarketIds(client, market);
  if (ids.length === 0) return false;

  const scoringWindow = await resolveTournamentScoringWindow(client).catch(() => null);
  const startIso = scoringWindow?.startsAt || TOURNAMENT_START_ISO;
  const cutoffIso = scoringWindow?.rankingCutoffAt || TOURNAMENT_RANKING_CUTOFF_ISO;

  const rows = await client.query(
    `SELECT 1
       FROM points_trades
      WHERE username = $1
        AND side = 'buy'
        AND market_id = ANY($2::int[])
        AND ABS(COALESCE(collateral, 0)) >= $3
        AND created_at >= $4::timestamptz
        AND created_at <= $5::timestamptz
      LIMIT 1`,
    [username, ids, TOURNAMENT_MIN_ENTRY_MXNP, startIso, cutoffIso],
  );
  return rows.rows.length > 0;
}

export async function assertTournamentMinimumEntry(client, { market, username, amount } = {}) {
  const value = Number(amount);
  if (!tournamentRulesActive() || !Number.isFinite(value) || value >= TOURNAMENT_MIN_ENTRY_MXNP) return;
  if (await hasCoveredTournamentMarket(client, { market, username })) return;

  const err = new Error('tournament_min_entry');
  err.status = 400;
  err.detail = `El mínimo por primera entrada durante el torneo es ${TOURNAMENT_MIN_ENTRY_MXNP} MXNP.`;
  throw err;
}

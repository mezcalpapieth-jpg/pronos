import { binaryPrices, multiPrices } from './amm-math.js';
import {
  TOURNAMENT_INACTIVITY_PENALTY,
  TOURNAMENT_MIN_ENTRY_MXNP,
  TOURNAMENT_OPERATION_CLOSE_ISO,
  TOURNAMENT_QUALIFYING_MARKETS,
  TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_START_ISO,
  mexicoDateKey,
  mexicoDateKeyToUtcNoon,
  previousMexicoDateKey,
  roundTournamentAmount,
} from './points-tournament-config.js';

async function queryRows(db, text, params = []) {
  const result = await db.query(text, params);
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateKeysInclusive(startDate, endKey) {
  const keys = [];
  if (!endKey) return keys;
  const cursor = mexicoDateKeyToUtcNoon(mexicoDateKey(startDate));
  const endCursor = mexicoDateKeyToUtcNoon(endKey);
  if (endCursor < cursor) return keys;
  for (let guard = 0; guard < 400; guard += 1) {
    const key = mexicoDateKey(cursor);
    keys.push(key);
    if (key === endKey) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function cycleWindowFromRow(row) {
  if (!row?.started_at || !row?.ends_at) return null;
  return {
    id: row.id ?? null,
    label: row.label || null,
    startsAt: row.started_at,
    operationCloseAt: row.ends_at,
    rankingCutoffAt: row.ends_at,
    endsAt: row.ends_at,
  };
}

export async function resolveTournamentScoringWindow(db, { now = new Date() } = {}) {
  try {
    const rows = await queryRows(db, `
      SELECT id, label, started_at, ends_at
      FROM points_cycles
      WHERE status = 'active'
      ORDER BY ends_at DESC
      LIMIT 1
    `);
    const active = cycleWindowFromRow(rows[0]);
    if (active) return active;
  } catch {
    // Schema creation happens at the API boundary. If a read replica is
    // briefly behind, fail closed: scores should not start before reset.
  }

  return null;
}

function buildNeutralLeaderboardRows(users, limit) {
  const ranked = users.map(user => ({
    username: user.username,
    createdAt: user.created_at,
    balance: roundTournamentAmount(user.balance),
    score: 0,
    cycleDelta: 0,
    marketPnl: 0,
    currentPositionValue: 0,
    inactivityPenalty: 0,
    inactiveDays: 0,
    activeDays: 0,
    qualifyingMarkets: 0,
    qualified: false,
    totalActions: 0,
    buyCount: 0,
  }));

  ranked.sort((a, b) => {
    const aCreated = new Date(a.createdAt || 0).getTime();
    const bCreated = new Date(b.createdAt || 0).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.username).localeCompare(String(b.username));
  });

  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  return ranked.slice(0, Math.max(1, Number(limit) || 500));
}

function completedPenaltyEndKey(now, window) {
  const current = now instanceof Date ? now : new Date(now);
  const startsAt = new Date(window?.startsAt || TOURNAMENT_START_ISO);
  const rankingCutoffAt = new Date(window?.rankingCutoffAt || TOURNAMENT_RANKING_CUTOFF_ISO);
  if (current < startsAt) return null;
  if (current >= rankingCutoffAt) {
    return mexicoDateKey(new Date(window?.operationCloseAt || TOURNAMENT_OPERATION_CLOSE_ISO));
  }
  return previousMexicoDateKey(current);
}

function marketPricesForPosition(market) {
  const reserves = parseJson(market.reserves, []);
  if (!Array.isArray(reserves) || reserves.length === 0) return [];
  if (reserves.length === 2) return binaryPrices(reserves);
  return multiPrices(reserves);
}

function positionValue(position) {
  const shares = numeric(position.shares);
  const costBasis = numeric(position.cost_basis);
  const realizedPnl = numeric(position.realized_pnl);
  let price = 0;

  if (position.status === 'resolved') {
    price = Number(position.outcome_index) === Number(position.outcome) ? 1 : 0;
  } else if (position.status === 'cancelled' || position.status === 'canceled') {
    price = 0;
  } else {
    const prices = marketPricesForPosition(position);
    price = numeric(prices[Number(position.outcome_index)]);
  }

  const currentValue = shares * price;
  return {
    currentValue,
    pnl: currentValue - costBasis + realizedPnl,
  };
}

function buildPenalty({ user, activity, now, window }) {
  const penaltyEndKey = completedPenaltyEndKey(now, window);
  if (!penaltyEndKey) return { activeDays: 0, inactiveDays: 0, inactivityPenalty: 0 };

  const startsAt = new Date(window?.startsAt || TOURNAMENT_START_ISO);
  const userCreatedAt = user.created_at ? new Date(user.created_at) : startsAt;
  const effectiveStart = userCreatedAt > startsAt ? userCreatedAt : startsAt;
  const eligibleKeys = dateKeysInclusive(effectiveStart, penaltyEndKey);
  const activeSet = new Set(Array.isArray(activity?.active_day_keys) ? activity.active_day_keys : []);
  const activeDays = eligibleKeys.filter(key => activeSet.has(key)).length;
  const inactiveDays = Math.max(0, eligibleKeys.length - activeDays);
  return {
    activeDays,
    inactiveDays,
    inactivityPenalty: inactiveDays * TOURNAMENT_INACTIVITY_PENALTY,
  };
}

export async function buildTournamentLeaderboardRows(db, { limit = 500, now = new Date(), window = null } = {}) {
  const users = await queryRows(db, `
    SELECT u.username, u.created_at, COALESCE(b.balance, 0) AS balance
    FROM points_users u
    LEFT JOIN points_balances b ON b.username = u.username
    WHERE u.username IS NOT NULL
    LIMIT 5000
  `);

  const scoringWindow = window || await resolveTournamentScoringWindow(db, { now });
  if (!scoringWindow) {
    return buildNeutralLeaderboardRows(users, limit);
  }

  const startIso = scoringWindow.startsAt || TOURNAMENT_START_ISO;
  const cutoffIso = scoringWindow.rankingCutoffAt || TOURNAMENT_RANKING_CUTOFF_ISO;
  const qualifyingMinimum = TOURNAMENT_MIN_ENTRY_MXNP;

  const activityRows = await queryRows(db, `
    SELECT username,
           COUNT(*) FILTER (WHERE side IN ('buy', 'sell', 'redeem')) AS total_actions,
           COUNT(*) FILTER (WHERE side = 'buy') AS buy_count,
           COUNT(DISTINCT market_id) FILTER (
             WHERE side = 'buy' AND ABS(COALESCE(collateral, 0)) >= $3
           ) AS qualifying_markets,
           COALESCE(
             ARRAY_AGG(DISTINCT ((created_at AT TIME ZONE 'America/Mexico_City')::date)::text)
               FILTER (WHERE side IN ('buy', 'sell', 'redeem')),
             '{}'::text[]
           ) AS active_day_keys
    FROM points_trades
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY username
  `, [startIso, cutoffIso, qualifyingMinimum]);

  const positionRows = await queryRows(db, `
    SELECT p.username, p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
           m.status, m.outcome, m.reserves, m.outcomes
    FROM points_positions p
    JOIN points_markets m ON m.id = p.market_id
    WHERE EXISTS (
      SELECT 1
      FROM points_trades t
      WHERE t.username = p.username
        AND t.market_id = p.market_id
        AND t.created_at >= $1
        AND t.created_at <= $2
    )
  `, [startIso, cutoffIso]);

  const activityByUser = new Map(activityRows.map(row => [row.username, row]));
  const pnlByUser = new Map();
  const valueByUser = new Map();
  for (const row of positionRows) {
    const { currentValue, pnl } = positionValue(row);
    pnlByUser.set(row.username, (pnlByUser.get(row.username) || 0) + pnl);
    valueByUser.set(row.username, (valueByUser.get(row.username) || 0) + currentValue);
  }

  const ranked = users.map(user => {
    const activity = activityByUser.get(user.username) || {};
    const marketPnl = pnlByUser.get(user.username) || 0;
    const currentPositionValue = valueByUser.get(user.username) || 0;
    const penalty = buildPenalty({ user, activity, now, window: scoringWindow });
    const qualifyingMarkets = Number(activity.qualifying_markets || 0);
    const score = marketPnl - penalty.inactivityPenalty;
    return {
      username: user.username,
      createdAt: user.created_at,
      balance: roundTournamentAmount(user.balance),
      score: roundTournamentAmount(score),
      cycleDelta: roundTournamentAmount(score),
      marketPnl: roundTournamentAmount(marketPnl),
      currentPositionValue: roundTournamentAmount(currentPositionValue),
      inactivityPenalty: roundTournamentAmount(penalty.inactivityPenalty),
      inactiveDays: penalty.inactiveDays,
      activeDays: penalty.activeDays,
      qualifyingMarkets,
      qualified: qualifyingMarkets >= TOURNAMENT_QUALIFYING_MARKETS,
      totalActions: Number(activity.total_actions || 0),
      buyCount: Number(activity.buy_count || 0),
    };
  });

  ranked.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const inactiveDiff = a.inactiveDays - b.inactiveDays;
    if (inactiveDiff !== 0) return inactiveDiff;
    const marketsDiff = b.qualifyingMarkets - a.qualifyingMarkets;
    if (marketsDiff !== 0) return marketsDiff;
    const aCreated = new Date(a.createdAt || 0).getTime();
    const bCreated = new Date(b.createdAt || 0).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.username).localeCompare(String(b.username));
  });

  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  return ranked.slice(0, Math.max(1, Number(limit) || 500));
}

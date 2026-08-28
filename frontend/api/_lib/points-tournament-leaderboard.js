import { binaryPrices, multiPrices } from './amm-math.js';
import {
  TOURNAMENT_INACTIVITY_PENALTY,
  TOURNAMENT_HOLD_REWARD_MAX_WEEKS,
  TOURNAMENT_HOLD_REWARD_WEEKLY_RATE,
  TOURNAMENT_MIN_ENTRY_MXNP,
  TOURNAMENT_OPERATION_CLOSE_ISO,
  TOURNAMENT_QUALIFYING_MARKETS,
  TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_START_ISO,
  configuredCycleWindowFromRow,
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

function dbBool(value) {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
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
  return configuredCycleWindowFromRow(row);
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
    profileImageUrl: user.profile_image_url || null,
    createdAt: user.created_at,
    balance: roundTournamentAmount(user.balance),
    score: 0,
    cycleDelta: 0,
    marketPnl: 0,
    currentPositionValue: 0,
    holdBonus: 0,
    liquidityReward: 0,
    parlayPnl: 0,
    parlayTickets: 0,
    parlayWins: 0,
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

const HOLD_REWARD_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOLD_LOT_EPSILON = 0.000001;

export function tournamentHoldRewardForCostBasis(costBasis, firstBuyAt, { now = new Date(), window = null } = {}) {
  const principal = numeric(costBasis);
  const boughtAt = firstBuyAt ? new Date(firstBuyAt) : null;
  const current = now instanceof Date ? now : new Date(now);
  const windowStart = new Date(window?.startsAt || TOURNAMENT_START_ISO);
  const cutoff = new Date(window?.rankingCutoffAt || TOURNAMENT_RANKING_CUTOFF_ISO);

  if (
    principal <= 0
    || !boughtAt
    || !Number.isFinite(boughtAt.getTime())
    || !Number.isFinite(current.getTime())
    || !Number.isFinite(windowStart.getTime())
    || !Number.isFinite(cutoff.getTime())
  ) {
    return { weeks: 0, bonus: 0 };
  }

  const effectiveStart = boughtAt > windowStart ? boughtAt : windowStart;
  const rewardEnd = current < cutoff ? current : cutoff;
  if (rewardEnd <= effectiveStart) return { weeks: 0, bonus: 0 };

  const completedWeeks = Math.floor((rewardEnd.getTime() - effectiveStart.getTime()) / HOLD_REWARD_WEEK_MS);
  const weeks = Math.min(TOURNAMENT_HOLD_REWARD_MAX_WEEKS, Math.max(0, completedWeeks));
  return {
    weeks,
    bonus: principal * TOURNAMENT_HOLD_REWARD_WEEKLY_RATE * weeks,
  };
}

function holdLotTotalCost(lots = []) {
  return lots.reduce((sum, lot) => sum + Math.max(0, numeric(lot.costBasis)), 0);
}

function consumeHoldLots(lots = [], sharesToRemove) {
  let remaining = Math.max(0, Math.abs(numeric(sharesToRemove)));
  while (remaining > HOLD_LOT_EPSILON && lots.length > 0) {
    const lot = lots[0];
    const shares = Math.max(0, numeric(lot.shares));
    const costBasis = Math.max(0, numeric(lot.costBasis));
    if (shares <= HOLD_LOT_EPSILON || costBasis <= HOLD_LOT_EPSILON) {
      lots.shift();
      continue;
    }

    const consumedShares = Math.min(shares, remaining);
    const consumedRatio = consumedShares / shares;
    lot.shares = Math.max(0, shares - consumedShares);
    lot.costBasis = Math.max(0, costBasis - (costBasis * consumedRatio));
    remaining = Math.max(0, remaining - consumedShares);

    if (lot.shares <= HOLD_LOT_EPSILON || lot.costBasis <= HOLD_LOT_EPSILON) {
      lots.shift();
    }
  }
  return lots;
}

function subtractHedgeCostFromHoldLots(lots = [], hedgeCost) {
  let remaining = Math.max(0, numeric(hedgeCost));
  const eligible = lots.map(lot => ({ ...lot }));
  for (let i = eligible.length - 1; i >= 0 && remaining > HOLD_LOT_EPSILON; i -= 1) {
    const lot = eligible[i];
    const costBasis = Math.max(0, numeric(lot.costBasis));
    if (costBasis <= HOLD_LOT_EPSILON) continue;

    const consumedCost = Math.min(costBasis, remaining);
    const consumedRatio = consumedCost / costBasis;
    lot.costBasis = Math.max(0, costBasis - consumedCost);
    lot.shares = Math.max(0, numeric(lot.shares) * (1 - consumedRatio));
    remaining = Math.max(0, remaining - consumedCost);
  }
  return eligible.filter(lot => (
    numeric(lot.costBasis) > HOLD_LOT_EPSILON
    && numeric(lot.shares) > HOLD_LOT_EPSILON
    && lot.boughtAt
  ));
}

function holdBucketKey(row) {
  return `${row.market_id}:${row.outcome_index}`;
}

function compareTradeRows(a, b) {
  const aTime = new Date(a.created_at || 0).getTime();
  const bTime = new Date(b.created_at || 0).getTime();
  const safeATime = Number.isFinite(aTime) ? aTime : 0;
  const safeBTime = Number.isFinite(bTime) ? bTime : 0;
  if (safeATime !== safeBTime) return safeATime - safeBTime;
  return numeric(a.id) - numeric(b.id);
}

export function buildHoldBonusByUser(tradeRows, { now, window }) {
  const groups = new Map();

  for (const row of [...(Array.isArray(tradeRows) ? tradeRows : [])].sort(compareTradeRows)) {
    if (!dbBool(row.tournament_featured)) continue;
    const username = String(row.username || '').trim();
    const side = String(row.side || '').toLowerCase();
    const marketId = Number(row.market_id);
    const outcomeIndex = Number(row.outcome_index);
    const shares = Math.max(0, Math.abs(numeric(row.shares)));
    if (!username || !Number.isInteger(marketId) || !Number.isInteger(outcomeIndex) || shares <= HOLD_LOT_EPSILON) continue;

    const key = `${username}:${row.exposure_group_id || row.market_id}`;
    const group = groups.get(key) || { username, buckets: new Map() };
    const bucketKey = holdBucketKey(row);
    const lots = group.buckets.get(bucketKey) || [];
    if (side === 'buy') {
      const costBasis = Math.max(0, Math.abs(numeric(row.collateral)));
      if (costBasis > HOLD_LOT_EPSILON && row.created_at) {
        lots.push({
          username,
          shares,
          costBasis,
          boughtAt: row.created_at,
        });
      }
    } else if (side === 'sell' || side === 'redeem') {
      consumeHoldLots(lots, shares);
    }
    group.buckets.set(bucketKey, lots);
    groups.set(key, group);
  }

  const byUser = new Map();
  for (const group of groups.values()) {
    const sorted = [...group.buckets.values()]
      .map(lots => ({
        lots,
        costBasis: holdLotTotalCost(lots),
      }))
      .filter(bucket => bucket.costBasis > HOLD_LOT_EPSILON)
      .sort((a, b) => b.costBasis - a.costBasis);
    const primary = sorted[0];
    if (!primary) continue;
    const hedgeCost = sorted.slice(1).reduce((sum, item) => sum + item.costBasis, 0);
    const eligibleLots = subtractHedgeCostFromHoldLots(primary.lots, hedgeCost);
    for (const lot of eligibleLots) {
      const { bonus } = tournamentHoldRewardForCostBasis(lot.costBasis, lot.boughtAt, { now, window });
      if (bonus > 0) {
        byUser.set(group.username, (byUser.get(group.username) || 0) + bonus);
      }
    }
  }

  return byUser;
}

async function readParlayScoreRows(db, startIso, cutoffIso) {
  try {
    return await queryRows(db, `
      SELECT username,
             COALESCE(SUM(
               CASE
                 WHEN status = 'won' THEN COALESCE(NULLIF(payout, 0), potential_payout, 0) - stake
                 WHEN status = 'lost' THEN -stake
                 ELSE 0
               END
             ), 0) AS parlay_pnl,
             COUNT(*)::int AS parlay_tickets,
             COUNT(*) FILTER (WHERE status = 'won')::int AS parlay_wins
      FROM points_parlay_tickets
      WHERE submitted_at >= $1 AND submitted_at <= $2
      GROUP BY username
    `, [startIso, cutoffIso]);
  } catch (error) {
    if (error?.code === '42P01') return [];
    throw error;
  }
}

async function readLiquidityRewardRows(db, startIso, cutoffIso) {
  try {
    return await queryRows(db, `
      SELECT username,
             COALESCE(SUM(amount), 0) AS liquidity_reward
      FROM points_distributions
      WHERE kind = 'limit_maker_reward'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY username
    `, [startIso, cutoffIso]);
  } catch (error) {
    if (error?.code === '42P01') return [];
    throw error;
  }
}

export async function buildTournamentLeaderboardRows(db, { limit = 500, now = new Date(), window = null } = {}) {
  const users = await queryRows(db, `
    SELECT u.username, u.created_at, u.profile_image_url, COALESCE(b.balance, 0) AS balance
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
           m.status, m.outcome, m.reserves, m.outcomes,
           COALESCE(m.parent_id, m.id) AS exposure_group_id,
           COALESCE(m.tournament_featured, parent.tournament_featured, false) AS tournament_featured
    FROM points_positions p
    JOIN points_markets m ON m.id = p.market_id
    LEFT JOIN points_markets parent ON parent.id = m.parent_id
    WHERE EXISTS (
      SELECT 1
      FROM points_trades t
      WHERE t.username = p.username
        AND t.market_id = p.market_id
        AND t.created_at >= $1
        AND t.created_at <= $2
      )
  `, [startIso, cutoffIso]);

  const holdTradeRows = await queryRows(db, `
    SELECT t.id, t.username, t.market_id, t.outcome_index, t.side,
           t.shares, t.collateral, t.created_at,
           COALESCE(m.parent_id, m.id) AS exposure_group_id,
           COALESCE(m.tournament_featured, parent.tournament_featured, false) AS tournament_featured
    FROM points_trades t
    JOIN points_markets m ON m.id = t.market_id
    LEFT JOIN points_markets parent ON parent.id = m.parent_id
    WHERE t.created_at >= $1
      AND t.created_at <= $2
      AND t.side IN ('buy', 'sell', 'redeem')
    ORDER BY t.created_at ASC, t.id ASC
  `, [startIso, cutoffIso]);

  const activityByUser = new Map(activityRows.map(row => [row.username, row]));
  const pnlByUser = new Map();
  const valueByUser = new Map();
  const holdBonusByUser = buildHoldBonusByUser(holdTradeRows, { now, window: scoringWindow });
  for (const row of positionRows) {
    const { currentValue, pnl } = positionValue(row);
    pnlByUser.set(row.username, (pnlByUser.get(row.username) || 0) + pnl);
    valueByUser.set(row.username, (valueByUser.get(row.username) || 0) + currentValue);
  }

  const parlayRows = await readParlayScoreRows(db, startIso, cutoffIso);
  const parlayByUser = new Map(parlayRows.map(row => [row.username, row]));
  const liquidityRows = await readLiquidityRewardRows(db, startIso, cutoffIso);
  const liquidityByUser = new Map(liquidityRows.map(row => [row.username, row]));

  const ranked = users.map(user => {
    const activity = activityByUser.get(user.username) || {};
    const marketPnl = pnlByUser.get(user.username) || 0;
    const currentPositionValue = valueByUser.get(user.username) || 0;
    const holdBonus = holdBonusByUser.get(user.username) || 0;
    const parlay = parlayByUser.get(user.username) || {};
    const parlayPnl = numeric(parlay.parlay_pnl);
    const liquidityReward = numeric(liquidityByUser.get(user.username)?.liquidity_reward);
    const penalty = buildPenalty({ user, activity, now, window: scoringWindow });
    const qualifyingMarkets = Number(activity.qualifying_markets || 0);
    const score = marketPnl + holdBonus + liquidityReward + parlayPnl - penalty.inactivityPenalty;
    return {
      username: user.username,
      profileImageUrl: user.profile_image_url || null,
      createdAt: user.created_at,
      balance: roundTournamentAmount(user.balance),
      score: roundTournamentAmount(score),
      cycleDelta: roundTournamentAmount(score),
      marketPnl: roundTournamentAmount(marketPnl),
      currentPositionValue: roundTournamentAmount(currentPositionValue),
      holdBonus: roundTournamentAmount(holdBonus),
      liquidityReward: roundTournamentAmount(liquidityReward),
      parlayPnl: roundTournamentAmount(parlayPnl),
      parlayTickets: Number(parlay.parlay_tickets || 0),
      parlayWins: Number(parlay.parlay_wins || 0),
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

import { binaryPrices, multiPrices } from './amm-math.js';
import {
  TOURNAMENT_CONVICTION_BONUS_RATE,
  TOURNAMENT_CONVICTION_MAX_ENTRY_PRICE,
  TOURNAMENT_CONVICTION_MAX_MULTIPLIER,
  TOURNAMENT_CONVICTION_MIN_MARKET_ENTRY_MXNP,
  TOURNAMENT_CONVICTION_NET_PNL_CAP_RATE,
  TOURNAMENT_INACTIVITY_PENALTY,
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
    convictionBonus: 0,
    convictionBonusGross: 0,
    convictionBonusCapApplied: 0,
    convictionEligibleProfit: 0,
    convictionMarkets: 0,
    convictionLots: 0,
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

const CONVICTION_LOT_EPSILON = 0.000001;

function dateMs(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function convictionUserMarketKey(username, marketKey) {
  return `${username}:${marketKey}`;
}

function convictionMarketKey(row) {
  return row.exposure_group_id || row.market_id;
}

function convictionBucketKey(row) {
  return `${row.market_id}:${row.outcome_index}`;
}

function tradeEntryPrice(row, shares) {
  const directPrice = numeric(row.price_at_trade);
  if (directPrice > 0) return directPrice;
  const collateral = Math.max(0, Math.abs(numeric(row.collateral)));
  return shares > CONVICTION_LOT_EPSILON ? collateral / shares : 0;
}

function marketOpenAtForRow(row, window) {
  return row.market_start_time
    || row.start_time
    || window?.startsAt
    || TOURNAMENT_START_ISO;
}

function marketCloseAtForRow(row, window) {
  return row.market_end_time
    || row.end_time
    || window?.operationCloseAt
    || window?.rankingCutoffAt
    || TOURNAMENT_RANKING_CUTOFF_ISO;
}

function rowMarketStatus(row) {
  return String(row.market_status ?? row.status ?? '').toLowerCase();
}

function rowMarketOutcome(row) {
  const outcome = Number(row.market_outcome ?? row.outcome);
  return Number.isInteger(outcome) ? outcome : null;
}

function isTouchMarketRow(row) {
  const sourceData = parseJson(row.pending_source_data ?? row.source_data, {});
  const resolverConfig = parseJson(row.resolver_config, {});
  const kinds = [
    sourceData.kind,
    sourceData.marketKind,
    sourceData.marketStyle,
    resolverConfig.kind,
    resolverConfig.shape,
  ].map(value => String(value || '').toLowerCase());

  return dbBool(sourceData.touchMarket)
    || dbBool(sourceData.isTouchMarket)
    || dbBool(resolverConfig.touchMarket)
    || kinds.some(value => value === 'touch' || value.includes('_touch') || value.includes('touch_'));
}

export function tournamentConvictionMultiplierForLot(boughtAt, marketOpenAt, marketCloseAt) {
  const boughtMs = dateMs(boughtAt);
  const openMs = dateMs(marketOpenAt);
  const closeMs = dateMs(marketCloseAt);
  if (boughtMs == null || openMs == null || closeMs == null || closeMs <= openMs) {
    return { heldRatio: 0, multiplier: 1 };
  }

  const effectiveBuyMs = Math.min(Math.max(boughtMs, openMs), closeMs);
  const heldRatio = Math.max(0, Math.min(1, (closeMs - effectiveBuyMs) / (closeMs - openMs)));
  const multiplier = Math.min(
    TOURNAMENT_CONVICTION_MAX_MULTIPLIER,
    1 + TOURNAMENT_CONVICTION_BONUS_RATE * heldRatio,
  );
  return { heldRatio, multiplier };
}

function consumeConvictionLots(lots = [], sharesToRemove) {
  let remaining = Math.max(0, Math.abs(numeric(sharesToRemove)));
  while (remaining > CONVICTION_LOT_EPSILON && lots.length > 0) {
    const lot = lots[0];
    const shares = Math.max(0, numeric(lot.shares));
    if (shares <= CONVICTION_LOT_EPSILON) {
      lots.shift();
      continue;
    }

    const consumedShares = Math.min(shares, remaining);
    const consumedRatio = consumedShares / shares;
    lot.shares = Math.max(0, shares - consumedShares);
    lot.costBasis = Math.max(0, numeric(lot.costBasis) * (1 - consumedRatio));
    remaining = Math.max(0, remaining - consumedShares);

    if (lot.shares <= CONVICTION_LOT_EPSILON) {
      lots.shift();
    }
  }
  return lots;
}

function compareTradeRows(a, b) {
  const aTime = new Date(a.created_at || 0).getTime();
  const bTime = new Date(b.created_at || 0).getTime();
  const safeATime = Number.isFinite(aTime) ? aTime : 0;
  const safeBTime = Number.isFinite(bTime) ? bTime : 0;
  if (safeATime !== safeBTime) return safeATime - safeBTime;
  return numeric(a.id) - numeric(b.id);
}

function emptyConvictionStats() {
  return {
    convictionMarkets: 0,
    convictionLots: 0,
    convictionBonusGross: 0,
    convictionBonusCapApplied: 0,
    convictionEligibleProfit: 0,
  };
}

function addConvictionStats(statsByUser, username, patch) {
  const current = statsByUser.get(username) || emptyConvictionStats();
  for (const [key, value] of Object.entries(patch)) {
    current[key] = numeric(current[key]) + numeric(value);
  }
  statsByUser.set(username, current);
}

function roundConvictionRatio(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 1;
}

function publicConvictionBreakdown(rows = []) {
  return rows.map(row => ({
    marketId: row.marketId,
    bonus: roundTournamentAmount(row.bonus),
    grossBonus: roundTournamentAmount(row.grossBonus),
    capApplied: roundTournamentAmount(row.capApplied),
    netMarketPnl: roundTournamentAmount(row.netMarketPnl),
    eligibleLots: Number(row.eligibleLots || 0),
    eligibleShares: roundTournamentAmount(row.eligibleShares),
    eligibleProfit: roundTournamentAmount(row.eligibleProfit),
    averageMultiplier: roundConvictionRatio(row.averageMultiplier),
  }));
}

export function buildConvictionBonusByUser(tradeRows, pnlByUserMarket = new Map(), { window = null } = {}) {
  const groups = new Map();

  for (const row of [...(Array.isArray(tradeRows) ? tradeRows : [])].sort(compareTradeRows)) {
    if (!dbBool(row.tournament_featured)) continue;
    const username = String(row.username || '').trim();
    const side = String(row.side || '').toLowerCase();
    const marketId = Number(row.market_id);
    const outcomeIndex = Number(row.outcome_index);
    const shares = Math.max(0, Math.abs(numeric(row.shares)));
    if (!username || !Number.isInteger(marketId) || !Number.isInteger(outcomeIndex) || shares <= CONVICTION_LOT_EPSILON) continue;

    const marketKey = convictionMarketKey(row);
    const key = convictionUserMarketKey(username, marketKey);
    const group = groups.get(key) || {
      username,
      marketKey,
      buckets: new Map(),
      grossBuyCollateral: 0,
      excludedTouchMarket: false,
    };
    group.excludedTouchMarket = group.excludedTouchMarket || isTouchMarketRow(row);

    const bucketKey = convictionBucketKey(row);
    const lots = group.buckets.get(bucketKey) || [];
    if (side === 'buy') {
      const costBasis = Math.max(0, Math.abs(numeric(row.collateral)));
      const priceAtTrade = tradeEntryPrice(row, shares);
      group.grossBuyCollateral += costBasis;
      if (
        costBasis > CONVICTION_LOT_EPSILON
        && priceAtTrade > 0
        && row.created_at
      ) {
        lots.push({
          username,
          marketId,
          marketKey,
          outcomeIndex,
          shares,
          costBasis,
          priceAtTrade,
          eligibleEntryPrice: priceAtTrade <= TOURNAMENT_CONVICTION_MAX_ENTRY_PRICE,
          boughtAt: row.created_at,
          marketOpenAt: marketOpenAtForRow(row, window),
          marketCloseAt: marketCloseAtForRow(row, window),
          marketResolvedAt: row.market_resolved_at ?? row.resolved_at ?? null,
          marketStatus: rowMarketStatus(row),
          marketOutcome: rowMarketOutcome(row),
        });
      }
    } else if (side === 'sell') {
      const resolvedMs = dateMs(row.market_resolved_at ?? row.resolved_at);
      const tradeMs = dateMs(row.created_at);
      if (resolvedMs == null || tradeMs == null || tradeMs <= resolvedMs) {
        consumeConvictionLots(lots, shares);
      }
    }
    group.buckets.set(bucketKey, lots);
    groups.set(key, group);
  }

  const bonusByUser = new Map();
  const statsByUser = new Map();
  const marketBreakdownByUser = new Map();

  for (const group of groups.values()) {
    if (group.excludedTouchMarket) continue;
    if (group.grossBuyCollateral + CONVICTION_LOT_EPSILON < TOURNAMENT_CONVICTION_MIN_MARKET_ENTRY_MXNP) continue;

    const netMarketPnl = numeric(pnlByUserMarket.get(convictionUserMarketKey(group.username, group.marketKey)));
    if (netMarketPnl <= CONVICTION_LOT_EPSILON) continue;

    let grossBonus = 0;
    let eligibleLots = 0;
    let eligibleShares = 0;
    let eligibleProfit = 0;
    let multiplierShareWeight = 0;

    for (const lots of group.buckets.values()) {
      for (const lot of lots) {
        const shares = Math.max(0, numeric(lot.shares));
        const priceAtTrade = numeric(lot.priceAtTrade);
        if (
          shares <= CONVICTION_LOT_EPSILON
          || lot.marketStatus !== 'resolved'
          || lot.marketOutcome == null
          || Number(lot.outcomeIndex) !== Number(lot.marketOutcome)
          || !lot.eligibleEntryPrice
          || priceAtTrade <= 0
          || priceAtTrade > TOURNAMENT_CONVICTION_MAX_ENTRY_PRICE
        ) {
          continue;
        }

        const { multiplier } = tournamentConvictionMultiplierForLot(
          lot.boughtAt,
          lot.marketOpenAt,
          lot.marketCloseAt,
        );
        const lotProfit = shares * Math.max(0, 1 - priceAtTrade);
        const lotBonus = lotProfit * Math.max(0, multiplier - 1);
        if (lotBonus <= CONVICTION_LOT_EPSILON) continue;
        grossBonus += lotBonus;
        eligibleLots += 1;
        eligibleShares += shares;
        eligibleProfit += lotProfit;
        multiplierShareWeight += multiplier * shares;
      }
    }

    if (grossBonus <= CONVICTION_LOT_EPSILON) continue;

    const pnlCap = netMarketPnl * TOURNAMENT_CONVICTION_NET_PNL_CAP_RATE;
    const bonus = Math.min(grossBonus, pnlCap);
    if (bonus <= CONVICTION_LOT_EPSILON) continue;

    bonusByUser.set(group.username, (bonusByUser.get(group.username) || 0) + bonus);
    addConvictionStats(statsByUser, group.username, {
      convictionMarkets: 1,
      convictionLots: eligibleLots,
      convictionBonusGross: grossBonus,
      convictionBonusCapApplied: Math.max(0, grossBonus - bonus),
      convictionEligibleProfit: eligibleProfit,
    });

    const breakdown = marketBreakdownByUser.get(group.username) || [];
    breakdown.push({
      marketId: Number(group.marketKey) || group.marketKey,
      bonus,
      grossBonus,
      capApplied: Math.max(0, grossBonus - bonus),
      netMarketPnl,
      eligibleLots,
      eligibleShares,
      eligibleProfit,
      averageMultiplier: eligibleShares > CONVICTION_LOT_EPSILON
        ? multiplierShareWeight / eligibleShares
        : 1,
    });
    marketBreakdownByUser.set(group.username, breakdown);
  }

  return { bonusByUser, statsByUser, marketBreakdownByUser };
}

export function buildHoldBonusByUser(tradeRows, options = {}) {
  return buildConvictionBonusByUser(tradeRows, options.pnlByUserMarket || new Map(), options).bonusByUser;
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

export async function buildTournamentLeaderboardRows(
  db,
  { limit = 500, now = new Date(), window = null, includeConvictionBreakdown = false } = {},
) {
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
           t.shares, t.collateral, t.price_at_trade, t.created_at,
           m.status AS market_status, m.outcome AS market_outcome,
           COALESCE(m.start_time, parent.start_time) AS market_start_time,
           COALESCE(m.end_time, parent.end_time) AS market_end_time,
           COALESCE(m.resolved_at, parent.resolved_at) AS market_resolved_at,
           COALESCE(m.resolver_config, parent.resolver_config) AS resolver_config,
           pm.source_data AS pending_source_data,
           COALESCE(m.parent_id, m.id) AS exposure_group_id,
           COALESCE(m.tournament_featured, parent.tournament_featured, false) AS tournament_featured
    FROM points_trades t
    JOIN points_markets m ON m.id = t.market_id
    LEFT JOIN points_markets parent ON parent.id = m.parent_id
    LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
    WHERE t.created_at >= $1
      AND t.created_at <= $2
      AND t.side IN ('buy', 'sell', 'redeem')
    ORDER BY t.created_at ASC, t.id ASC
  `, [startIso, cutoffIso]);

  const activityByUser = new Map(activityRows.map(row => [row.username, row]));
  const pnlByUser = new Map();
  const pnlByUserMarket = new Map();
  const valueByUser = new Map();
  for (const row of positionRows) {
    const { currentValue, pnl } = positionValue(row);
    pnlByUser.set(row.username, (pnlByUser.get(row.username) || 0) + pnl);
    const marketKey = convictionMarketKey(row);
    const userMarketKey = convictionUserMarketKey(row.username, marketKey);
    pnlByUserMarket.set(userMarketKey, (pnlByUserMarket.get(userMarketKey) || 0) + pnl);
    valueByUser.set(row.username, (valueByUser.get(row.username) || 0) + currentValue);
  }
  const {
    bonusByUser: holdBonusByUser,
    statsByUser: convictionStatsByUser,
    marketBreakdownByUser: convictionBreakdownByUser,
  } = buildConvictionBonusByUser(holdTradeRows, pnlByUserMarket, { window: scoringWindow });

  const parlayRows = await readParlayScoreRows(db, startIso, cutoffIso);
  const parlayByUser = new Map(parlayRows.map(row => [row.username, row]));
  const liquidityRows = await readLiquidityRewardRows(db, startIso, cutoffIso);
  const liquidityByUser = new Map(liquidityRows.map(row => [row.username, row]));

  const ranked = users.map(user => {
    const activity = activityByUser.get(user.username) || {};
    const marketPnl = pnlByUser.get(user.username) || 0;
    const currentPositionValue = valueByUser.get(user.username) || 0;
    const holdBonus = holdBonusByUser.get(user.username) || 0;
    const convictionStats = convictionStatsByUser.get(user.username) || emptyConvictionStats();
    const convictionBreakdown = includeConvictionBreakdown
      ? publicConvictionBreakdown(convictionBreakdownByUser.get(user.username) || [])
      : null;
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
      convictionBonus: roundTournamentAmount(holdBonus),
      convictionBonusGross: roundTournamentAmount(convictionStats.convictionBonusGross),
      convictionBonusCapApplied: roundTournamentAmount(convictionStats.convictionBonusCapApplied),
      convictionEligibleProfit: roundTournamentAmount(convictionStats.convictionEligibleProfit),
      convictionMarkets: Number(convictionStats.convictionMarkets || 0),
      convictionLots: Number(convictionStats.convictionLots || 0),
      ...(includeConvictionBreakdown ? { convictionBreakdown } : {}),
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

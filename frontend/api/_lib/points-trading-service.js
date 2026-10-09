import { seriesTradeLockFromRows } from './series-markets.js';
import {
  executeTriggeredLimitOrders,
  lockedReservedShares,
  matchRestingAsksForBuy,
  matchRestingBidsForSell,
} from './points-limit-orders.js';
import { assertCryptoTradeAllowed } from './points-crypto-trade-guard.js';
import { TOURNAMENT_APPROVED_MARKET_START_ISO } from './points-tournament-config.js';
import {
  assertTournamentCutoffSnapshotReady,
  assertTournamentMinimumEntry,
  assertTournamentSettlementAllowed,
} from './points-tournament-entry.js';
import { normalizeExecutableSellShares } from './points-sell-shares.js';
import { optionalFiniteNumber } from './protocol-trade-guards.js';

const EPSILON = 0.000001;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function apiError(message, status = 400, detail = undefined) {
  const err = new Error(message);
  err.status = status;
  if (detail) err.detail = detail;
  return err;
}

function normalizeTradeSource(source) {
  const value = String(source || 'web').trim().toLowerCase();
  return ['web', 'api', 'system'].includes(value) ? value : 'web';
}

function normalizeApiKeyId(apiKeyId) {
  const value = Number(apiKeyId);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function readSeriesTradeLock(client, market) {
  const cfg = parseJsonb(market.resolver_config, null);
  if (cfg?.source !== 'espn' || !cfg?.leaguePath) return null;
  const anchor = market.start_time || market.end_time || market.created_at;
  if (!anchor) return null;
  const siblingResult = await client.query(
    `SELECT id, question, outcomes, start_time, end_time,
            status, outcome, resolved_at, final_score,
            resolver_config, sport, league
       FROM points_markets
      WHERE parent_id IS NULL
        AND resolver_type = 'sports_api'
        AND resolver_config->>'source' = 'espn'
        AND resolver_config->>'leaguePath' = $1
        AND start_time >= $2::timestamptz - INTERVAL '45 days'
        AND start_time <= $2::timestamptz + INTERVAL '45 days'
      ORDER BY start_time ASC NULLS LAST, id ASC
      LIMIT 80`,
    [cfg.leaguePath, anchor],
  );
  return seriesTradeLockFromRows(market, siblingResult.rows);
}

export async function executePointsBuy(client, {
  username,
  marketId,
  outcomeIndex,
  collateral,
  minSharesOut = null,
  maxAvgPrice = null,
  source = 'web',
  apiKeyId = null,
} = {}) {
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!username) throw apiError('username_required', 400);
  if (!Number.isInteger(mid) || mid <= 0) throw apiError('invalid_market_id', 400);
  if (!Number.isInteger(oi) || oi < 0) throw apiError('invalid_outcome_index', 400);
  if (!Number.isFinite(amt) || amt <= 0) throw apiError('invalid_amount', 400);

  const minShares = optionalFiniteNumber(minSharesOut);
  const maxPrice = optionalFiniteNumber(maxAvgPrice);
  const tradeSource = normalizeTradeSource(source);
  const tradeApiKeyId = normalizeApiKeyId(apiKeyId);

  const marketResult = await client.query(
    `SELECT m.id, m.question, m.status, m.reserves, m.outcomes, m.start_time, m.end_time,
            m.created_at, m.resolver_type, m.resolver_config, m.sport, m.league,
            m.seed_liquidity, m.seed_liquidities, m.amm_mode, m.parent_id,
            (
              m.tournament_featured IS TRUE
              OR p.tournament_featured IS TRUE
              OR COALESCE(pm.reviewed_at, p.created_at, m.created_at) >= $2::timestamptz
            ) AS tournament_featured
       FROM points_markets m
       LEFT JOIN points_markets p ON p.id = m.parent_id
       LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [mid, TOURNAMENT_APPROVED_MARKET_START_ISO],
  );
  if (marketResult.rows.length === 0) throw apiError('market_not_found', 404);
  const market = marketResult.rows[0];
  if (market.status !== 'active') throw apiError('market_closed', 400);
  if (market.end_time && new Date(market.end_time) <= new Date()) throw apiError('market_expired', 400);

  assertTournamentSettlementAllowed(market);
  await assertTournamentCutoffSnapshotReady(client, { market });
  await assertTournamentMinimumEntry(client, {
    market,
    username,
    amount: amt,
  });
  assertCryptoTradeAllowed(market);
  const seriesLock = await readSeriesTradeLock(client, market);
  if (seriesLock?.locked) {
    throw apiError(
      seriesLock.status === 'not_needed' ? 'series_game_not_needed' : 'series_game_pending',
      400,
      seriesLock.summary || seriesLock.reason,
    );
  }

  const reserves = parseJsonb(market.reserves, []).map(Number);
  if (reserves.length < 2) throw apiError('degenerate_reserves', 400);
  if (oi >= reserves.length) throw apiError('invalid_outcome_index', 400);

  const balanceResult = await client.query(
    `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
    [username],
  );
  const currentBalance = balanceResult.rows.length > 0
    ? Number(balanceResult.rows[0].balance)
    : 0;
  if (currentBalance < amt) throw apiError('insufficient_balance', 400);

  const orderbookMatch = await matchRestingAsksForBuy(client, {
    market,
    marketId: mid,
    username,
    outcomeIndex: oi,
    collateralBudget: amt,
    routeAmm: true,
    source: tradeSource,
    apiKeyId: tradeApiKeyId,
  });
  const totalSharesOut = orderbookMatch.sharesOut;
  const totalSpent = orderbookMatch.collateralSpent;
  const totalFee = Number(orderbookMatch.fee || 0);
  const combinedAvgPrice = totalSharesOut > EPSILON
    ? (totalSpent - totalFee) / totalSharesOut
    : 0;

  if (minShares !== null && totalSharesOut < minShares) {
    throw apiError('price_moved', 409, `shares_out=${totalSharesOut.toFixed(6)} below min=${minShares}`);
  }
  if (maxPrice !== null && combinedAvgPrice > maxPrice) {
    throw apiError('price_moved', 409, `avg_price=${combinedAvgPrice.toFixed(6)} above max=${maxPrice}`);
  }
  if (totalSharesOut <= EPSILON || totalSpent <= EPSILON) throw apiError('invalid_quote', 400);

  const newBalance = currentBalance - totalSpent;
  await client.query(
    `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
    [newBalance, username],
  );

  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     VALUES ($1, $2, 'trade_buy', $3, $4)`,
    [
      username,
      -totalSpent,
      mid,
      `Compra de ${totalSharesOut.toFixed(2)} acciones`,
    ],
  );

  const triggeredLimitOrders = await executeTriggeredLimitOrders(client, { marketId: mid });

  return {
    balance: newBalance,
    sharesOut: totalSharesOut,
    fee: totalFee,
    priceBefore: orderbookMatch.priceBefore,
    priceAfter: orderbookMatch.priceAfter,
    orderbookFills: orderbookMatch.fills.filter(fill => fill.source === 'limit'),
    triggeredLimitOrders,
  };
}

export async function executePointsSell(client, {
  username,
  marketId,
  outcomeIndex,
  shares,
  minCollateralOut = null,
  source = 'web',
  apiKeyId = null,
} = {}) {
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const requestedShares = Number(shares);
  if (!username) throw apiError('username_required', 400);
  if (!Number.isInteger(mid) || mid <= 0) throw apiError('invalid_market_id', 400);
  if (!Number.isInteger(oi) || oi < 0) throw apiError('invalid_outcome_index', 400);
  if (!Number.isFinite(requestedShares) || requestedShares <= 0) throw apiError('invalid_shares', 400);

  const minOut = optionalFiniteNumber(minCollateralOut);
  const tradeSource = normalizeTradeSource(source);
  const tradeApiKeyId = normalizeApiKeyId(apiKeyId);

  const marketResult = await client.query(
    `SELECT m.id, m.status, m.reserves, m.end_time, m.resolver_config,
            m.seed_liquidity, m.seed_liquidities,
            (
              m.tournament_featured IS TRUE
              OR p.tournament_featured IS TRUE
              OR COALESCE(pm.reviewed_at, p.created_at, m.created_at) >= $2::timestamptz
            ) AS tournament_featured
       FROM points_markets m
       LEFT JOIN points_markets p ON p.id = m.parent_id
       LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [mid, TOURNAMENT_APPROVED_MARKET_START_ISO],
  );
  if (marketResult.rows.length === 0) throw apiError('market_not_found', 404);
  const market = marketResult.rows[0];
  if (market.status !== 'active') throw apiError('market_closed', 400);
  if (market.end_time && new Date(market.end_time) <= new Date()) throw apiError('market_expired', 400);
  await assertTournamentCutoffSnapshotReady(client, { market });
  assertCryptoTradeAllowed(market);

  const reserves = parseJsonb(market.reserves, []).map(Number);
  if (reserves.length < 2) throw apiError('degenerate_reserves', 400);
  if (oi >= reserves.length) throw apiError('invalid_outcome_index', 400);

  const positionResult = await client.query(
    `SELECT shares, cost_basis, realized_pnl
       FROM points_positions
      WHERE market_id = $1 AND username = $2 AND outcome_index = $3
      FOR UPDATE`,
    [mid, username, oi],
  );
  if (positionResult.rows.length === 0) throw apiError('no_position', 400);
  const position = positionResult.rows[0];
  const held = Number(position.shares);
  const reservedShares = await lockedReservedShares(client, { marketId: mid, username, outcomeIndex: oi });
  const { sharesToSell } = normalizeExecutableSellShares({
    requestedShares,
    heldShares: held,
    reservedShares,
  });

  const orderbookMatch = await matchRestingBidsForSell(client, {
    market,
    marketId: mid,
    username,
    outcomeIndex: oi,
    sharesToSell,
    routeAmm: true,
    source: tradeSource,
    apiKeyId: tradeApiKeyId,
  });
  const totalCollateralOut = orderbookMatch.collateralOut;
  if (minOut !== null && totalCollateralOut < minOut) {
    throw apiError('price_moved', 409, `out=${totalCollateralOut.toFixed(6)} below min=${minOut}`);
  }
  if (totalCollateralOut <= EPSILON) throw apiError('invalid_quote', 400);

  const balanceResult = await client.query(
    `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
    [username],
  );
  const currentBalance = balanceResult.rows.length > 0 ? Number(balanceResult.rows[0].balance) : 0;
  const newBalance = currentBalance + totalCollateralOut;
  if (balanceResult.rows.length === 0) {
    await client.query(
      `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
      [username, newBalance],
    );
  } else {
    await client.query(
      `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
      [newBalance, username],
    );
  }

  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     VALUES ($1, $2, 'trade_sell', $3, $4)`,
    [username, totalCollateralOut, mid, `Venta anticipada de ${sharesToSell.toFixed(2)} acciones`],
  );

  const triggeredLimitOrders = await executeTriggeredLimitOrders(client, { marketId: mid });

  return {
    balance: newBalance,
    collateralOut: totalCollateralOut,
    sharesSold: orderbookMatch.sharesSold,
    realizedPnl: orderbookMatch.realizedPnl,
    priceBefore: orderbookMatch.priceBefore,
    priceAfter: orderbookMatch.priceAfter,
    orderbookFills: orderbookMatch.fills.filter(fill => fill.source === 'limit'),
    triggeredLimitOrders,
  };
}

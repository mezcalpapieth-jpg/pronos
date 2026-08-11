import {
  binaryBuyQuote,
  binaryPrices,
  binarySellQuote,
  multiBuyQuote,
  multiPrices,
  multiSellQuote,
} from './amm-math.js';
import { bestEffortInsertPointsPriceSnapshot } from './points-price-snapshots.js';
import { assertCryptoTradeAllowed, cryptoTradeLock } from './points-crypto-trade-guard.js';
import {
  TOURNAMENT_MAX_SHARES_PER_MARKET,
  TOURNAMENT_MIN_ENTRY_MXNP,
  tournamentRulesActive,
} from './points-tournament-config.js';

const EPSILON = 0.000001;
const MAX_TRIGGERED_PER_PASS = 24;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

function configNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const MAKER_REWARD_ANNUAL_RATE = configNumber('POINTS_MAKER_REWARD_ANNUAL_RATE', 0.12);
export const MAKER_REWARD_MAX_DAILY_PER_USER = configNumber('POINTS_MAKER_REWARD_MAX_DAILY_PER_USER', 100);
export const MAKER_REWARD_MAX_DISTANCE = configNumber('POINTS_MAKER_REWARD_MAX_DISTANCE', 0.10);
export const MAKER_REWARD_FULL_DISTANCE = configNumber('POINTS_MAKER_REWARD_FULL_DISTANCE', 0.03);
export const MAKER_REWARD_MIN_SECONDS = configNumber('POINTS_MAKER_REWARD_MIN_SECONDS', 300);

export function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function quoteBuy(reserves, outcomeIndex, collateral) {
  return reserves.length === 2
    ? binaryBuyQuote(reserves, outcomeIndex, collateral)
    : multiBuyQuote(reserves, outcomeIndex, collateral);
}

function quoteSell(reserves, outcomeIndex, shares) {
  return reserves.length === 2
    ? binarySellQuote(reserves, outcomeIndex, shares)
    : multiSellQuote(reserves, outcomeIndex, shares);
}

function pricesForReserves(reserves) {
  return reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
}

function currentPriceForOutcome(reserves, outcomeIndex) {
  const prices = pricesForReserves(reserves);
  const price = Number(prices[outcomeIndex]);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function qualityMultiplier(limitPrice, currentPrice) {
  const distance = Math.abs(Number(limitPrice) - Number(currentPrice));
  if (!Number.isFinite(distance) || distance > MAKER_REWARD_MAX_DISTANCE) return 0;
  if (distance <= MAKER_REWARD_FULL_DISTANCE) return 1;
  const span = Math.max(EPSILON, MAKER_REWARD_MAX_DISTANCE - MAKER_REWARD_FULL_DISTANCE);
  const decay = (MAKER_REWARD_MAX_DISTANCE - distance) / span;
  return Math.max(0.15, Math.min(1, 0.15 + 0.85 * decay));
}

function makerRewardBaseValue(order, currentPrice) {
  const remaining = Number(order.remaining_amount || 0);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  if (order.side === 'buy') return remaining;
  return remaining * Math.max(0, Number(currentPrice) || 0);
}

function rewardCutoffTime(market, now = new Date()) {
  const end = market?.end_time ? new Date(market.end_time) : null;
  if (end && Number.isFinite(end.getTime()) && end < now) return end;
  return now;
}

export function estimateMakerReward(order, market, reserves, now = new Date()) {
  if (!order || order.status !== 'open') return 0;
  const cutoff = rewardCutoffTime(market, now);
  const cutoffMs = cutoff.getTime();
  if (!Number.isFinite(cutoffMs)) return 0;
  const createdAtMs = new Date(order.created_at || cutoff).getTime();
  const lastAtMs = new Date(order.maker_reward_last_at || order.created_at || cutoff).getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(lastAtMs)) return 0;

  const eligibleStartMs = Math.max(lastAtMs, createdAtMs + MAKER_REWARD_MIN_SECONDS * 1000);
  const eligibleSeconds = Math.max(0, (cutoffMs - eligibleStartMs) / 1000);
  if (eligibleSeconds <= 0) return 0;

  const currentPrice = currentPriceForOutcome(reserves, Number(order.outcome_index));
  const baseValue = makerRewardBaseValue(order, currentPrice);
  const multiplier = qualityMultiplier(Number(order.limit_price), currentPrice);
  if (baseValue <= 0 || multiplier <= 0) return 0;

  const reward = baseValue * MAKER_REWARD_ANNUAL_RATE * (eligibleSeconds / SECONDS_PER_YEAR) * multiplier;
  return round(Math.max(0, reward), 6);
}

async function accrueMakerRewardForOrder(client, order, market, reserves, now = new Date()) {
  if (!order || order.status !== 'open') return order;
  const reward = estimateMakerReward(order, market, reserves, now);
  const cutoff = rewardCutoffTime(market, now);
  const cutoffMs = cutoff.getTime();
  const createdAtMs = new Date(order.created_at || cutoff).getTime();
  const lastAtMs = new Date(order.maker_reward_last_at || order.created_at || cutoff).getTime();
  const eligibleStartMs = Math.max(lastAtMs, createdAtMs + MAKER_REWARD_MIN_SECONDS * 1000);
  const shouldAdvanceClock = Number.isFinite(cutoffMs)
    && Number.isFinite(eligibleStartMs)
    && cutoffMs > eligibleStartMs;

  if (reward <= 0 && !shouldAdvanceClock) return order;

  const updates = await client.query(
    `UPDATE points_limit_orders
        SET maker_reward_accrued = maker_reward_accrued + $2,
            maker_reward_last_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE maker_reward_last_at END,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'open'
      RETURNING *`,
    [order.id, reward, shouldAdvanceClock, cutoff.toISOString()],
  );
  return updates.rows[0] || order;
}

async function payMakerRewardForOrder(client, orderOrId, reason = 'limit_order_maker_reward') {
  const orderId = typeof orderOrId === 'object' ? orderOrId.id : orderOrId;
  const result = await client.query(
    `SELECT *
       FROM points_limit_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId],
  );
  if (result.rows.length === 0) return { paid: 0 };

  const order = result.rows[0];
  const accrued = Number(order.maker_reward_accrued || 0);
  if (accrued <= EPSILON) return { paid: 0 };

  const daily = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM points_distributions
      WHERE username = $1
        AND kind = 'limit_maker_reward'
        AND created_at >= CURRENT_DATE`,
    [order.username],
  );
  const paidToday = Number(daily.rows[0]?.total || 0);
  const dailyCapLeft = Math.max(0, MAKER_REWARD_MAX_DAILY_PER_USER - paidToday);
  const payable = round(Math.min(accrued, dailyCapLeft), 6);
  if (payable <= EPSILON) return { paid: 0 };

  const balance = await lockBalance(client, order.username);
  await setBalance(client, order.username, balance + payable);
  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     VALUES ($1, $2, 'limit_maker_reward', $3, $4)`,
    [order.username, payable, order.market_id, reason],
  );
  await client.query(
    `UPDATE points_limit_orders
        SET maker_reward_paid = maker_reward_paid + $2,
            maker_reward_accrued = GREATEST(maker_reward_accrued - $2, 0::numeric),
            updated_at = NOW()
      WHERE id = $1`,
    [order.id, payable],
  );

  return { paid: payable };
}

export async function payDailyMakerRewards(client, {
  maxOrders = 500,
  now = new Date(),
} = {}) {
  const limit = Math.max(1, Math.min(2000, Number.parseInt(maxOrders, 10) || 500));
  const result = await client.query(
    `SELECT o.*,
            m.reserves AS market_reserves,
            m.end_time AS market_end_time,
            m.status AS market_status
       FROM points_limit_orders o
       JOIN points_markets m ON m.id = o.market_id
      WHERE o.status = 'open'
        AND COALESCE(m.mode, 'points') = 'points'
        AND m.status = 'active'
        AND (m.end_time IS NULL OR m.end_time > NOW())
      ORDER BY o.maker_reward_last_at NULLS FIRST, o.created_at ASC, o.id ASC
      LIMIT $1
      FOR UPDATE OF o SKIP LOCKED`,
    [limit],
  );

  const paidUsers = new Set();
  const paidOrders = [];
  const skipped = [];
  let paidTotal = 0;

  for (const row of result.rows) {
    const reserves = parseJsonb(row.market_reserves, []).map(Number);
    if (reserves.length < 2 || reserves.some(v => !Number.isFinite(v) || v < 0)) {
      skipped.push({ orderId: Number(row.id), reason: 'invalid_reserves' });
      continue;
    }
    const market = { end_time: row.market_end_time, status: row.market_status };
    const accruedOrder = await accrueMakerRewardForOrder(client, row, market, reserves, now);
    const payout = await payMakerRewardForOrder(client, accruedOrder.id, 'Pago diario por liquidez');
    const paid = Number(payout?.paid || 0);
    if (paid > EPSILON) {
      paidTotal += paid;
      paidUsers.add(row.username);
      paidOrders.push({
        orderId: Number(row.id),
        marketId: Number(row.market_id),
        username: row.username,
        paid: round(paid, 6),
      });
    }
  }

  return {
    checked: result.rows.length,
    paidOrders: paidOrders.length,
    paidUsers: paidUsers.size,
    paidTotal: round(paidTotal, 6),
    skipped,
    payouts: paidOrders,
  };
}

export function normalizeLimitPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // UI sends decimal probability. Accept cents defensively for admin/API
  // callers that pass 72.5 instead of 0.725.
  const p = n > 1 ? n / 100 : n;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return round(p, 6);
}

async function lockMarket(client, marketId) {
  const result = await client.query(
    `SELECT id, question, status, reserves, outcomes, end_time, resolver_config
       FROM points_markets
      WHERE id = $1
      FOR UPDATE`,
    [marketId],
  );
  if (result.rows.length === 0) {
    const err = new Error('market_not_found'); err.status = 404; throw err;
  }
  return result.rows[0];
}

function assertMarketCanTrade(market) {
  if (market.status !== 'active') {
    const err = new Error('market_closed'); err.status = 400; throw err;
  }
  if (market.end_time && new Date(market.end_time) <= new Date()) {
    const err = new Error('market_expired'); err.status = 400; throw err;
  }
  assertCryptoTradeAllowed(market);
}

function reservesForMarket(market, outcomeIndex) {
  const reserves = parseJsonb(market.reserves, []).map(Number);
  if (reserves.length < 2) {
    const err = new Error('degenerate_reserves'); err.status = 400; throw err;
  }
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= reserves.length) {
    const err = new Error('invalid_outcome_index'); err.status = 400; throw err;
  }
  return reserves;
}

async function lockBalance(client, username) {
  const result = await client.query(
    `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
    [username],
  );
  return result.rows.length > 0 ? Number(result.rows[0].balance) : 0;
}

async function setBalance(client, username, balance) {
  await client.query(
    `INSERT INTO points_balances (username, balance, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (username) DO UPDATE
       SET balance = EXCLUDED.balance,
           updated_at = NOW()`,
    [username, balance],
  );
}

async function assertTournamentShareCap(client, { marketId, username, additionalShares }) {
  if (!tournamentRulesActive()) return;
  const rows = await client.query(
    `SELECT shares
       FROM points_positions
      WHERE market_id = $1
        AND username = $2
      FOR UPDATE`,
    [marketId, username],
  );
  const currentShares = rows.rows.reduce((sum, row) => sum + Number(row.shares || 0), 0);
  if (currentShares + Number(additionalShares || 0) > TOURNAMENT_MAX_SHARES_PER_MARKET + EPSILON) {
    const err = new Error('tournament_share_cap');
    err.status = 400;
    err.detail = `Máximo ${TOURNAMENT_MAX_SHARES_PER_MARKET.toLocaleString('es-MX')} acciones por mercado en el torneo.`;
    throw err;
  }
}

export async function lockedReservedShares(client, { marketId, username, outcomeIndex }) {
  const rows = await client.query(
    `SELECT id, remaining_amount
       FROM points_limit_orders
      WHERE market_id = $1
        AND username = $2
        AND outcome_index = $3
        AND side = 'sell'
        AND status = 'open'
      FOR UPDATE`,
    [marketId, username, outcomeIndex],
  );
  return rows.rows.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
}

async function insertTradeAndSnapshot(client, {
  marketId,
  username,
  side,
  outcomeIndex,
  shares,
  collateral,
  fee,
  priceAtTrade,
  reservesBefore,
  reservesAfter,
  snapshotLabel,
}) {
  await client.query(
    `INSERT INTO points_trades (
       market_id, username, side, outcome_index,
       shares, collateral, fee, price_at_trade,
       reserves_before, reserves_after
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
    [
      marketId, username, side, outcomeIndex,
      shares, collateral, fee || 0, priceAtTrade || 0,
      JSON.stringify(reservesBefore),
      JSON.stringify(reservesAfter),
    ],
  );

  await bestEffortInsertPointsPriceSnapshot(client, {
    marketId,
    reserves: reservesAfter,
    logLabel: snapshotLabel,
  });
}

async function fillBuyOrder(client, { order, market, reserves }) {
  const amount = Number(order.remaining_amount);
  const quote = quoteBuy(reserves, Number(order.outcome_index), amount);
  if (quote.avgPrice > Number(order.limit_price) + EPSILON) {
    return { ok: true, status: 'open', triggered: false };
  }

  await assertTournamentShareCap(client, {
    marketId: order.market_id,
    username: order.username,
    additionalShares: quote.sharesOut,
  });

  await client.query(
    `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
    [JSON.stringify(quote.reservesAfter), order.market_id],
  );
  await insertTradeAndSnapshot(client, {
    marketId: order.market_id,
    username: order.username,
    side: 'buy',
    outcomeIndex: Number(order.outcome_index),
    shares: quote.sharesOut,
    collateral: amount,
    fee: quote.fee,
    priceAtTrade: quote.avgPrice,
    reservesBefore: reserves,
    reservesAfter: quote.reservesAfter,
    snapshotLabel: 'points-limit-buy-price-snapshot',
  });
  await client.query(
    `INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (market_id, username, outcome_index) DO UPDATE
       SET shares = points_positions.shares + EXCLUDED.shares,
           cost_basis = points_positions.cost_basis + EXCLUDED.cost_basis,
           dismissed_at = NULL,
           updated_at = NOW()`,
    [order.market_id, order.username, Number(order.outcome_index), quote.sharesOut, amount],
  );
  await client.query(
    `UPDATE points_limit_orders
        SET status = 'filled',
            remaining_amount = 0,
            reserved_collateral = 0,
            filled_shares = $2,
            filled_collateral = $3,
            avg_fill_price = $4,
            filled_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [order.id, quote.sharesOut, amount, quote.avgPrice],
  );
  const makerReward = await payMakerRewardForOrder(client, order.id, 'Orden límite ejecutada');

  return {
    ok: true,
    status: 'filled',
    triggered: true,
    shares: quote.sharesOut,
    collateral: amount,
    avgPrice: quote.avgPrice,
    reservesAfter: quote.reservesAfter,
    makerReward,
  };
}

async function fillSellOrder(client, { order, market, reserves }) {
  const shares = Number(order.remaining_amount);
  const quote = quoteSell(reserves, Number(order.outcome_index), shares);
  const avgPrice = quote.collateralOut / shares;
  if (avgPrice + EPSILON < Number(order.limit_price)) {
    return { ok: true, status: 'open', triggered: false };
  }

  const positionResult = await client.query(
    `SELECT shares, cost_basis, realized_pnl
       FROM points_positions
      WHERE market_id = $1
        AND username = $2
        AND outcome_index = $3
      FOR UPDATE`,
    [order.market_id, order.username, Number(order.outcome_index)],
  );
  if (positionResult.rows.length === 0 || Number(positionResult.rows[0].shares || 0) < shares) {
    await client.query(
      `UPDATE points_limit_orders
          SET status = 'expired',
              reason = 'shares_unavailable_at_fill',
              reserved_shares = 0,
              updated_at = NOW()
        WHERE id = $1`,
      [order.id],
    );
    return { ok: true, status: 'expired', triggered: false };
  }

  const p = positionResult.rows[0];
  const held = Number(p.shares);
  const costBasis = Number(p.cost_basis);
  const realized = Number(p.realized_pnl || 0);
  const avgCost = held > 0 ? costBasis / held : 0;
  const soldCostBasis = avgCost * shares;
  const addedRealized = quote.collateralOut - soldCostBasis;
  const newShares = held - shares;
  const newCostBasis = newShares > 0 ? costBasis - soldCostBasis : 0;

  await client.query(
    `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
    [JSON.stringify(quote.reservesAfter), order.market_id],
  );
  const currentBalance = await lockBalance(client, order.username);
  await setBalance(client, order.username, currentBalance + quote.collateralOut);
  await client.query(
    `UPDATE points_positions
        SET shares = $1,
            cost_basis = $2,
            realized_pnl = $3,
            updated_at = NOW()
      WHERE market_id = $4
        AND username = $5
        AND outcome_index = $6`,
    [newShares, newCostBasis, realized + addedRealized, order.market_id, order.username, Number(order.outcome_index)],
  );
  await insertTradeAndSnapshot(client, {
    marketId: order.market_id,
    username: order.username,
    side: 'sell',
    outcomeIndex: Number(order.outcome_index),
    shares,
    collateral: quote.collateralOut,
    fee: quote.fee,
    priceAtTrade: avgPrice,
    reservesBefore: reserves,
    reservesAfter: quote.reservesAfter,
    snapshotLabel: 'points-limit-sell-price-snapshot',
  });
  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     VALUES ($1, $2, 'limit_sell_fill', $3, $4)`,
    [order.username, quote.collateralOut, order.market_id, `Ask ejecutado a ${round(avgPrice * 100, 2)}c`],
  );
  await client.query(
    `UPDATE points_limit_orders
        SET status = 'filled',
            remaining_amount = 0,
            reserved_shares = 0,
            filled_shares = $2,
            filled_collateral = $3,
            avg_fill_price = $4,
            filled_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [order.id, shares, quote.collateralOut, avgPrice],
  );
  const makerReward = await payMakerRewardForOrder(client, order.id, 'Orden límite ejecutada');

  return {
    ok: true,
    status: 'filled',
    triggered: true,
    shares,
    collateral: quote.collateralOut,
    avgPrice,
    reservesAfter: quote.reservesAfter,
    makerReward,
  };
}

export async function executeLimitOrderById(client, orderId) {
  const orderResult = await client.query(
    `SELECT *
       FROM points_limit_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId],
  );
  if (orderResult.rows.length === 0) {
    const err = new Error('order_not_found'); err.status = 404; throw err;
  }
  let order = orderResult.rows[0];
  if (order.status !== 'open') {
    return { ok: true, status: order.status, triggered: false };
  }

  const market = await lockMarket(client, Number(order.market_id));
  const reserves = reservesForMarket(market, Number(order.outcome_index));
  order = await accrueMakerRewardForOrder(client, order, market, reserves);

  if (order.expires_at && new Date(order.expires_at) <= new Date()) {
    const makerReward = await payMakerRewardForOrder(client, order.id, 'Orden límite expirada');
    await expireOrders(client, [order], 'order_expired');
    return { ok: true, status: 'expired', triggered: false, makerReward };
  }
  if (market.status !== 'active' || (market.end_time && new Date(market.end_time) <= new Date())) {
    const makerReward = await payMakerRewardForOrder(client, order.id, 'Mercado cerrado');
    await expireOrders(client, [order], 'market_closed');
    return { ok: true, status: 'expired', triggered: false, makerReward };
  }
  const cryptoLock = cryptoTradeLock(market);
  if (cryptoLock) {
    return {
      ok: true,
      status: 'open',
      triggered: false,
      detail: cryptoLock.error,
    };
  }

  try {
    return order.side === 'buy'
      ? await fillBuyOrder(client, { order, market, reserves })
      : await fillSellOrder(client, { order, market, reserves });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-math') || msg.includes('drain')) {
      return { ok: true, status: 'open', triggered: false, detail: e.message };
    }
    throw e;
  }
}

export async function createLimitOrder(client, {
  marketId,
  username,
  side,
  outcomeIndex,
  limitPrice,
  amount,
  expiresAt = null,
}) {
  const normalizedSide = side === 'sell' ? 'sell' : 'buy';
  const price = normalizeLimitPrice(limitPrice);
  const qty = Number(amount);
  if (!price) {
    const err = new Error('invalid_limit_price'); err.status = 400; throw err;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('invalid_amount'); err.status = 400; throw err;
  }
  if (normalizedSide === 'buy' && tournamentRulesActive() && qty < TOURNAMENT_MIN_ENTRY_MXNP) {
    const err = new Error('tournament_min_entry');
    err.status = 400;
    err.detail = `El mínimo por entrada durante el torneo es ${TOURNAMENT_MIN_ENTRY_MXNP} MXNP.`;
    throw err;
  }

  const market = await lockMarket(client, marketId);
  assertMarketCanTrade(market);
  reservesForMarket(market, outcomeIndex);

  if (normalizedSide === 'buy') {
    const balance = await lockBalance(client, username);
    if (balance < qty) {
      const err = new Error('insufficient_available_balance'); err.status = 400; throw err;
    }
    await setBalance(client, username, balance - qty);
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       VALUES ($1, $2, 'limit_buy_reserve', $3, $4)`,
      [username, -qty, marketId, `Bid reservado a ${round(price * 100, 2)}c`],
    );
  } else {
    const positionResult = await client.query(
      `SELECT shares
         FROM points_positions
        WHERE market_id = $1
          AND username = $2
          AND outcome_index = $3
        FOR UPDATE`,
      [marketId, username, outcomeIndex],
    );
    const held = positionResult.rows.length > 0 ? Number(positionResult.rows[0].shares) : 0;
    const reserved = await lockedReservedShares(client, { marketId, username, outcomeIndex });
    if (held - reserved < qty) {
      const err = new Error('insufficient_available_shares'); err.status = 400; throw err;
    }
  }

  const insert = await client.query(
    `INSERT INTO points_limit_orders (
       market_id, username, side, outcome_index, limit_price,
       amount, remaining_amount, reserved_collateral, reserved_shares,
       expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)
     RETURNING *`,
    [
      marketId,
      username,
      normalizedSide,
      outcomeIndex,
      price,
      qty,
      normalizedSide === 'buy' ? qty : 0,
      normalizedSide === 'sell' ? qty : 0,
      expiresAt || null,
    ],
  );

  const order = insert.rows[0];
  const fill = await executeLimitOrderById(client, order.id);
  const fresh = await client.query(
    `SELECT * FROM points_limit_orders WHERE id = $1`,
    [order.id],
  );
  return { order: fresh.rows[0] || order, fill };
}

export async function cancelLimitOrder(client, { orderId, username, admin = false }) {
  const result = await client.query(
    `SELECT *
       FROM points_limit_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId],
  );
  if (result.rows.length === 0) {
    const err = new Error('order_not_found'); err.status = 404; throw err;
  }
  const order = result.rows[0];
  if (!admin && order.username !== username) {
    const err = new Error('order_not_found'); err.status = 404; throw err;
  }
  if (order.status !== 'open') {
    const err = new Error('order_not_open'); err.status = 400; throw err;
  }
  const market = await lockMarket(client, Number(order.market_id));
  const reserves = reservesForMarket(market, Number(order.outcome_index));
  const accruedOrder = await accrueMakerRewardForOrder(client, order, market, reserves);
  const makerReward = await payMakerRewardForOrder(client, accruedOrder.id, 'Orden límite cancelada');
  await expireOrders(client, [accruedOrder], 'order_cancelled', 'cancelled');
  return { ok: true, orderId: Number(order.id), status: 'cancelled', makerReward };
}

async function expireOrders(client, orders, reason, status = 'expired') {
  const buyOrders = orders.filter(order => order.side === 'buy' && Number(order.remaining_amount) > 0);
  for (const order of buyOrders) {
    const refund = Number(order.remaining_amount);
    const balance = await lockBalance(client, order.username);
    await setBalance(client, order.username, balance + refund);
    await client.query(
      `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
       VALUES ($1, $2, 'limit_buy_release', $3, $4)`,
      [order.username, refund, order.market_id, reason],
    );
  }

  if (orders.length > 0) {
    await client.query(
      `UPDATE points_limit_orders
          SET status = $2,
              remaining_amount = 0,
              reserved_collateral = 0,
              reserved_shares = 0,
              reason = $3,
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN NOW() ELSE cancelled_at END,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'open'`,
      [orders.map(order => Number(order.id)), status, reason],
    );
  }
}

export async function releaseOpenLimitOrdersForMarkets(client, marketIds, {
  reason = 'market_closed',
  status = 'expired',
} = {}) {
  const ids = (Array.isArray(marketIds) ? marketIds : [marketIds])
    .map(Number)
    .filter(Number.isInteger);
  if (ids.length === 0) return { releasedOrders: 0, refundedCollateral: 0 };

  const result = await client.query(
    `SELECT *
       FROM points_limit_orders
      WHERE market_id = ANY($1::int[])
        AND status = 'open'
      FOR UPDATE`,
    [ids],
  );
  const orders = result.rows;
  const refundedCollateral = orders
    .filter(order => order.side === 'buy')
    .reduce((sum, order) => sum + Number(order.remaining_amount || 0), 0);
  const accruedOrders = [];
  const marketCache = new Map();
  for (const order of orders) {
    try {
      let market = marketCache.get(Number(order.market_id));
      if (!market) {
        market = await lockMarket(client, Number(order.market_id));
        marketCache.set(Number(order.market_id), market);
      }
      const reserves = reservesForMarket(market, Number(order.outcome_index));
      const accruedOrder = await accrueMakerRewardForOrder(client, order, market, reserves);
      await payMakerRewardForOrder(client, accruedOrder.id, reason === 'market_cancelled'
        ? 'Mercado anulado'
        : 'Mercado cerrado');
      accruedOrders.push(accruedOrder);
    } catch (e) {
      accruedOrders.push(order);
      console.warn('[points-limit-orders] maker reward skipped during release', {
        orderId: order.id,
        marketId: order.market_id,
        message: e?.message,
      });
    }
  }
  await expireOrders(client, accruedOrders, reason, status);
  return { releasedOrders: orders.length, refundedCollateral };
}

export async function executeTriggeredLimitOrders(client, {
  marketId,
  outcomeIndex,
  maxOrders = MAX_TRIGGERED_PER_PASS,
} = {}) {
  const filled = [];
  const skipped = [];
  const skippedKeys = new Set();
  const outcomeIndices = await resolveTriggeredOutcomeIndices(client, { marketId, outcomeIndex });
  const limit = Math.max(1, Number.parseInt(maxOrders, 10) || MAX_TRIGGERED_PER_PASS);
  const sides = [
    { side: 'sell', order: 'limit_price ASC, created_at ASC, id ASC' },
    { side: 'buy', order: 'limit_price DESC, created_at ASC, id ASC' },
  ];

  for (let pass = 0; pass < limit && filled.length < limit; pass++) {
    let filledThisPass = 0;

    for (const triggerOutcomeIndex of outcomeIndices) {
      for (const cfg of sides) {
        if (filled.length >= limit) break;

        const result = await client.query(
          `SELECT id
             FROM points_limit_orders
            WHERE market_id = $1
              AND outcome_index = $2
              AND side = $3
              AND status = 'open'
            ORDER BY ${cfg.order}
            LIMIT 1`,
          [marketId, triggerOutcomeIndex, cfg.side],
        );
        if (result.rows.length === 0) continue;

        const orderId = result.rows[0].id;
        const execution = await executeLimitOrderById(client, orderId);
        if (execution.triggered) {
          filled.push({
            orderId: Number(orderId),
            outcomeIndex: triggerOutcomeIndex,
            side: cfg.side,
            ...execution,
          });
          filledThisPass++;
          continue;
        }

        const skippedKey = `${orderId}:${cfg.side}`;
        if (!skippedKeys.has(skippedKey)) {
          skippedKeys.add(skippedKey);
          skipped.push({
            orderId: Number(orderId),
            outcomeIndex: triggerOutcomeIndex,
            side: cfg.side,
            status: execution.status,
          });
        }
      }
    }

    if (filledThisPass === 0) break;
  }
  return { filled, skipped, outcomeIndices };
}

async function resolveTriggeredOutcomeIndices(client, { marketId, outcomeIndex } = {}) {
  const explicitOutcomeIndex = Number(outcomeIndex);
  if (Number.isInteger(explicitOutcomeIndex) && explicitOutcomeIndex >= 0) {
    return [explicitOutcomeIndex];
  }

  const result = await client.query(
    `SELECT reserves, outcomes
       FROM points_markets
      WHERE id = $1`,
    [marketId],
  );
  const row = result.rows[0];
  if (!row) return [];

  const reserves = parseJsonb(row.reserves, []);
  const outcomes = parseJsonb(row.outcomes, []);
  const count = Math.max(
    Array.isArray(reserves) ? reserves.length : 0,
    Array.isArray(outcomes) ? outcomes.length : 0,
  );

  return Array.from({ length: count }, (_, index) => index);
}

export function aggregateLimitOrderRows(rows = []) {
  const bySide = { asks: new Map(), bids: new Map() };
  for (const row of rows) {
    const side = row.side === 'sell' ? 'asks' : 'bids';
    const price = round(row.limit_price, 6);
    const remaining = Number(row.remaining_amount || 0);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(remaining) || remaining <= 0) continue;
    const key = price.toFixed(6);
    const existing = bySide[side].get(key) || {
      side: side === 'asks' ? 'ask' : 'bid',
      source: 'limit',
      price,
      shares: 0,
      total: 0,
      orderCount: 0,
    };
    existing.orderCount += Number(row.order_count || 1);
    if (side === 'asks') {
      existing.shares += remaining;
      existing.total += remaining * price;
    } else {
      existing.total += remaining;
      existing.shares += remaining / price;
    }
    bySide[side].set(key, existing);
  }
  const asks = [...bySide.asks.values()]
    .map(row => ({ ...row, shares: round(row.shares), total: round(row.total) }))
    .sort((a, b) => a.price - b.price);
  const bids = [...bySide.bids.values()]
    .map(row => ({ ...row, shares: round(row.shares), total: round(row.total) }))
    .sort((a, b) => b.price - a.price);
  return { asks, bids };
}

import {
  binaryBuyQuote,
  binaryPrices,
  binarySellQuote,
  multiBuyQuote,
  multiSellQuote,
} from './amm-math.js';
import { seriesTradeLockFromRows } from './series-markets.js';
import { bestEffortInsertPointsPriceSnapshot } from './points-price-snapshots.js';
import {
  combineBuyOrderbookMatches,
  combineSellOrderbookMatches,
  executeTriggeredLimitOrders,
  lockedReservedShares,
  matchPronosMakerAsksForBuy,
  matchPronosMakerInventoryBidsForSell,
  matchRestingAsksForBuy,
  matchRestingBidsForSell,
  PRONOS_TREASURY_USERNAME,
} from './points-limit-orders.js';
import {
  binaryPricesWithBookTrade,
  monotonicBuyDisplayPrice,
} from './points-display-prices.js';
import { assertCryptoTradeAllowed } from './points-crypto-trade-guard.js';
import {
  TOURNAMENT_MAX_SHARES_PER_MARKET,
  tournamentRulesActive,
} from './points-tournament-config.js';
import { assertTournamentMinimumEntry } from './points-tournament-entry.js';
import { normalizeExecutableSellShares } from './points-sell-shares.js';

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

function buyOrderbookPriceCap(reserves, outcomeIndex, collateral) {
  const amount = Number(collateral);
  if (!Array.isArray(reserves) || reserves.length < 2 || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  try {
    const quote = reserves.length === 2
      ? binaryBuyQuote(reserves, outcomeIndex, amount)
      : multiBuyQuote(reserves, outcomeIndex, amount);
    const cap = Number(quote?.avgPrice);
    return Number.isFinite(cap) && cap > 0 ? cap : null;
  } catch {
    return null;
  }
}

function sellOrderbookPriceFloor(reserves, outcomeIndex, shares) {
  const amount = Number(shares);
  if (!Array.isArray(reserves) || reserves.length < 2 || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  try {
    const quote = reserves.length === 2
      ? binarySellQuote(reserves, outcomeIndex, amount)
      : multiSellQuote(reserves, outcomeIndex, amount);
    const floor = Number(quote?.collateralOut) / amount;
    return Number.isFinite(floor) && floor > 0 ? floor : null;
  } catch {
    return null;
  }
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

async function assertTournamentShareCap(client, { marketId, username, additionalShares }) {
  if (!tournamentRulesActive()) return;
  const rows = await client.query(
    `SELECT outcome_index, shares
       FROM points_positions
      WHERE market_id = $1
        AND username = $2
      FOR UPDATE`,
    [marketId, username],
  );
  const currentShares = rows.rows.reduce((sum, row) => sum + Number(row.shares || 0), 0);
  if (currentShares + Number(additionalShares || 0) > TOURNAMENT_MAX_SHARES_PER_MARKET + EPSILON) {
    throw apiError(
      'tournament_share_cap',
      400,
      `Máximo ${TOURNAMENT_MAX_SHARES_PER_MARKET.toLocaleString('es-MX')} acciones por mercado en el torneo.`,
    );
  }
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

  const minShares = Number.isFinite(Number(minSharesOut)) ? Number(minSharesOut) : null;
  const maxPrice = Number.isFinite(Number(maxAvgPrice)) ? Number(maxAvgPrice) : null;
  const tradeSource = normalizeTradeSource(source);
  const tradeApiKeyId = normalizeApiKeyId(apiKeyId);

  const marketResult = await client.query(
    `SELECT m.id, m.question, m.status, m.reserves, m.outcomes, m.start_time, m.end_time,
            m.created_at, m.resolver_type, m.resolver_config, m.sport, m.league,
            m.seed_liquidity, m.seed_liquidities, m.amm_mode, m.parent_id,
            COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
       FROM points_markets m
       LEFT JOIN points_markets p ON p.id = m.parent_id
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [mid],
  );
  if (marketResult.rows.length === 0) throw apiError('market_not_found', 404);
  const market = marketResult.rows[0];
  if (market.status !== 'active') throw apiError('market_closed', 400);
  if (market.end_time && new Date(market.end_time) <= new Date()) throw apiError('market_expired', 400);

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

  let displayPriceBefore = 0;
  if (reserves.length === 2) {
    const pricesBefore = binaryPrices(reserves);
    const displayTradeResult = await client.query(
      `SELECT outcome_index, price_at_trade,
              (reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after) AS is_book_trade
         FROM points_trades
        WHERE market_id = $1
          AND username <> $2
          AND price_at_trade IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [mid, PRONOS_TREASURY_USERNAME],
    );
    const displayPricesBefore = binaryPricesWithBookTrade(pricesBefore, {
      status: market.status,
      outcomeIndex: displayTradeResult.rows[0]?.outcome_index,
      price: displayTradeResult.rows[0]?.price_at_trade,
      isBookTrade: displayTradeResult.rows[0]?.is_book_trade,
    });
    displayPriceBefore = Number(displayPricesBefore[oi] ?? pricesBefore[oi] ?? 0);
  }

  const balanceResult = await client.query(
    `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
    [username],
  );
  const currentBalance = balanceResult.rows.length > 0
    ? Number(balanceResult.rows[0].balance)
    : 0;
  if (currentBalance < amt) throw apiError('insufficient_balance', 400);

  const bookMaxPrice = buyOrderbookPriceCap(reserves, oi, amt);
  const realOrderbookMatch = await matchRestingAsksForBuy(client, {
    market,
    marketId: mid,
    username,
    outcomeIndex: oi,
    collateralBudget: amt,
    maxPrice: bookMaxPrice,
    source: tradeSource,
    apiKeyId: tradeApiKeyId,
  });
  const makerOrderbookMatch = realOrderbookMatch.remainingCollateral > EPSILON
    ? await matchPronosMakerAsksForBuy(client, {
      market,
      marketId: mid,
      username,
      outcomeIndex: oi,
      collateralBudget: realOrderbookMatch.remainingCollateral,
      currentPrice: displayPriceBefore || null,
      maxPrice: bookMaxPrice,
      source: tradeSource,
      apiKeyId: tradeApiKeyId,
    })
    : null;
  const orderbookMatch = combineBuyOrderbookMatches(realOrderbookMatch, makerOrderbookMatch);
  const ammCollateral = orderbookMatch.remainingCollateral > EPSILON
    ? orderbookMatch.remainingCollateral
    : 0;

  let quote = null;
  if (ammCollateral > 0) {
    try {
      quote = reserves.length === 2
        ? binaryBuyQuote(reserves, oi, ammCollateral)
        : multiBuyQuote(reserves, oi, ammCollateral);
    } catch (e) {
      throw apiError('invalid_quote', 400, e.message);
    }
  }

  const totalSharesOut = orderbookMatch.sharesOut + Number(quote?.sharesOut || 0);
  const totalSpent = orderbookMatch.collateralSpent + ammCollateral;
  const totalFee = Number(quote?.fee || 0);
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

  if (quote) {
    await assertTournamentShareCap(client, {
      marketId: mid,
      username,
      additionalShares: quote.sharesOut,
    });
    await client.query(
      `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
      [JSON.stringify(quote.reservesAfter), mid],
    );
  }

  const newBalance = currentBalance - totalSpent;
  await client.query(
    `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
    [newBalance, username],
  );

  if (quote) {
    await client.query(
      `INSERT INTO points_trades (
         market_id, username, side, outcome_index,
         shares, collateral, fee, price_at_trade,
         reserves_before, reserves_after, source, api_key_id
       ) VALUES ($1, $2, 'buy', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        mid, username, oi,
        quote.sharesOut, ammCollateral, quote.fee, quote.avgPrice,
        JSON.stringify(reserves),
        JSON.stringify(quote.reservesAfter),
        tradeSource,
        tradeApiKeyId,
      ],
    );

    await client.query(
      `INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (market_id, username, outcome_index) DO UPDATE
       SET shares     = points_positions.shares + EXCLUDED.shares,
           cost_basis = points_positions.cost_basis + EXCLUDED.cost_basis,
           dismissed_at = NULL,
           updated_at = NOW()`,
      [mid, username, oi, quote.sharesOut, ammCollateral],
    );
  }

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

  if (quote) {
    await bestEffortInsertPointsPriceSnapshot(client, {
      marketId: mid,
      reserves: quote.reservesAfter,
      logLabel: 'points-buy-price-snapshot',
    });
  }

  const triggeredLimitOrders = await executeTriggeredLimitOrders(client, { marketId: mid });
  const lastOrderbookFillPrice = [...(orderbookMatch.fills || [])]
    .reverse()
    .map(fill => Number(fill.price))
    .find(price => Number.isFinite(price) && price > 0);
  const rawPriceBefore = quote?.priceBefore ?? orderbookMatch.avgPrice;
  const responsePriceBefore = displayPriceBefore || rawPriceBefore;
  const responsePriceAfter = reserves.length === 2
    ? monotonicBuyDisplayPrice(responsePriceBefore, [
      quote?.priceAfter,
      lastOrderbookFillPrice,
      combinedAvgPrice,
    ])
    : (quote?.priceAfter ?? orderbookMatch.avgPrice);

  return {
    balance: newBalance,
    sharesOut: totalSharesOut,
    fee: totalFee,
    priceBefore: responsePriceBefore,
    priceAfter: responsePriceAfter,
    orderbookFills: orderbookMatch.fills,
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

  const minOut = Number.isFinite(Number(minCollateralOut)) ? Number(minCollateralOut) : null;
  const tradeSource = normalizeTradeSource(source);
  const tradeApiKeyId = normalizeApiKeyId(apiKeyId);

  const marketResult = await client.query(
    `SELECT m.id, m.status, m.reserves, m.end_time, m.resolver_config,
            m.seed_liquidity, m.seed_liquidities,
            COALESCE(m.tournament_featured, p.tournament_featured, false) AS tournament_featured
       FROM points_markets m
       LEFT JOIN points_markets p ON p.id = m.parent_id
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [mid],
  );
  if (marketResult.rows.length === 0) throw apiError('market_not_found', 404);
  const market = marketResult.rows[0];
  if (market.status !== 'active') throw apiError('market_closed', 400);
  if (market.end_time && new Date(market.end_time) <= new Date()) throw apiError('market_expired', 400);
  assertCryptoTradeAllowed(market);

  const reserves = parseJsonb(market.reserves, []).map(Number);
  if (reserves.length < 2) throw apiError('degenerate_reserves', 400);
  if (oi >= reserves.length) throw apiError('invalid_outcome_index', 400);

  let displayPriceBefore = 0;
  if (reserves.length === 2) {
    const pricesBefore = binaryPrices(reserves);
    const displayTradeResult = await client.query(
      `SELECT outcome_index, price_at_trade,
              (reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after) AS is_book_trade
         FROM points_trades
        WHERE market_id = $1
          AND username <> $2
          AND price_at_trade IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [mid, PRONOS_TREASURY_USERNAME],
    );
    const displayPricesBefore = binaryPricesWithBookTrade(pricesBefore, {
      status: market.status,
      outcomeIndex: displayTradeResult.rows[0]?.outcome_index,
      price: displayTradeResult.rows[0]?.price_at_trade,
      isBookTrade: displayTradeResult.rows[0]?.is_book_trade,
    });
    displayPriceBefore = Number(displayPricesBefore[oi] ?? pricesBefore[oi] ?? 0);
  }

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

  const bookMinPrice = sellOrderbookPriceFloor(reserves, oi, sharesToSell);
  const realOrderbookMatch = await matchRestingBidsForSell(client, {
    market,
    marketId: mid,
    username,
    outcomeIndex: oi,
    sharesToSell,
    minPrice: bookMinPrice,
    source: tradeSource,
    apiKeyId: tradeApiKeyId,
  });
  const makerOrderbookMatch = realOrderbookMatch.remainingShares > EPSILON
    ? await matchPronosMakerInventoryBidsForSell(client, {
      market,
      marketId: mid,
      username,
      outcomeIndex: oi,
      sharesToSell: realOrderbookMatch.remainingShares,
      source: tradeSource,
      apiKeyId: tradeApiKeyId,
    })
    : null;
  const orderbookMatch = combineSellOrderbookMatches(realOrderbookMatch, makerOrderbookMatch);
  const ammShares = orderbookMatch.remainingShares > EPSILON
    ? orderbookMatch.remainingShares
    : 0;
  const reservesForAmm = Array.isArray(orderbookMatch.reservesAfter)
    ? orderbookMatch.reservesAfter.map(Number)
    : reserves;

  let quote = null;
  let addedAmmRealized = 0;
  if (ammShares > 0) {
    const freshPositionResult = await client.query(
      `SELECT shares, cost_basis, realized_pnl
         FROM points_positions
        WHERE market_id = $1 AND username = $2 AND outcome_index = $3
        FOR UPDATE`,
      [mid, username, oi],
    );
    if (freshPositionResult.rows.length === 0) throw apiError('no_position', 400);
    const freshPosition = freshPositionResult.rows[0];
    const freshHeld = Number(freshPosition.shares);
    const freshCostBasis = Number(freshPosition.cost_basis);
    const freshRealized = Number(freshPosition.realized_pnl || 0);
    if (freshHeld + EPSILON < ammShares) throw apiError('insufficient_available_shares', 400);

    try {
      quote = reservesForAmm.length === 2
        ? binarySellQuote(reservesForAmm, oi, ammShares)
        : multiSellQuote(reservesForAmm, oi, ammShares);
    } catch (e) {
      throw apiError('invalid_quote', 400, e.message);
    }

    const minAmmOut = minOut !== null
      ? Math.max(0, minOut - orderbookMatch.collateralOut)
      : null;
    if (minAmmOut !== null && quote.collateralOut < minAmmOut) {
      throw apiError(
        'price_moved',
        409,
        `out=${(orderbookMatch.collateralOut + quote.collateralOut).toFixed(6)} below min=${minOut}`,
      );
    }

    await client.query(
      `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
      [JSON.stringify(quote.reservesAfter), mid],
    );

    const avgCost = freshHeld > 0 ? freshCostBasis / freshHeld : 0;
    const soldCostBasis = avgCost * ammShares;
    addedAmmRealized = quote.collateralOut - soldCostBasis;
    const newShares = Math.max(0, freshHeld - ammShares);
    const newCostBasis = newShares > 0 ? freshCostBasis - soldCostBasis : 0;
    const newRealized = freshRealized + addedAmmRealized;

    await client.query(
      `UPDATE points_positions
       SET shares       = $1,
           cost_basis   = $2,
           realized_pnl = $3,
           updated_at   = NOW()
       WHERE market_id = $4 AND username = $5 AND outcome_index = $6`,
      [newShares, newCostBasis, newRealized, mid, username, oi],
    );

    await client.query(
      `INSERT INTO points_trades (
         market_id, username, side, outcome_index,
         shares, collateral, fee, price_at_trade,
         reserves_before, reserves_after, source, api_key_id
       ) VALUES ($1, $2, 'sell', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        mid, username, oi,
        ammShares, quote.collateralOut, quote.fee, quote.priceBefore || 0,
        JSON.stringify(reservesForAmm),
        JSON.stringify(quote.reservesAfter),
        tradeSource,
        tradeApiKeyId,
      ],
    );

    await bestEffortInsertPointsPriceSnapshot(client, {
      marketId: mid,
      reserves: quote.reservesAfter,
      logLabel: 'points-sell-price-snapshot',
    });
  } else if (Array.isArray(orderbookMatch.reservesAfter)) {
    await bestEffortInsertPointsPriceSnapshot(client, {
      marketId: mid,
      reserves: orderbookMatch.reservesAfter,
      logLabel: 'points-sell-price-snapshot',
    });
  }

  const totalCollateralOut = orderbookMatch.collateralOut + Number(quote?.collateralOut || 0);
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
    sharesSold: sharesToSell,
    realizedPnl: orderbookMatch.realizedPnl + addedAmmRealized,
    priceBefore: (displayPriceBefore || orderbookMatch.priceBefore) ?? quote?.priceBefore ?? orderbookMatch.avgPrice,
    priceAfter: quote?.priceAfter ?? orderbookMatch.priceAfter ?? orderbookMatch.avgPrice,
    orderbookFills: orderbookMatch.fills,
    triggeredLimitOrders,
  };
}

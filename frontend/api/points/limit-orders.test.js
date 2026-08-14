/**
 * Run with:
 *   node --test frontend/api/points/limit-orders.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  combineBuyOrderbookMatches,
  estimateMakerReward,
  makerUsageFromRows,
  previewPronosMakerAsksForBuy,
  pronosMakerDepthForMarket,
  previewRestingAsksForBuy,
  previewRestingBidsForSell,
} from '../_lib/points-limit-orders.js';

const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('../_lib/points-limit-orders.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../_lib/points-tournament-entry.js', import.meta.url), 'utf8');
const orderbookSource = await readFile(new URL('./orderbook.js', import.meta.url), 'utf8');
const limitOrdersSource = await readFile(new URL('./limit-orders.js', import.meta.url), 'utf8');
const cancelOrderSource = await readFile(new URL('./cancel-limit-order.js', import.meta.url), 'utf8');
const makerRewardsSource = await readFile(new URL('./maker-rewards.js', import.meta.url), 'utf8');
const makerRewardsCronSource = await readFile(new URL('../cron/points-maker-rewards.js', import.meta.url), 'utf8');
const buySource = await readFile(new URL('./buy.js', import.meta.url), 'utf8');
const quoteBuySource = await readFile(new URL('./quote-buy.js', import.meta.url), 'utf8');
const quoteSellSource = await readFile(new URL('./quote-sell.js', import.meta.url), 'utf8');
const topHoldersSource = await readFile(new URL('./top-holders.js', import.meta.url), 'utf8');
const sellSource = await readFile(new URL('./sell.js', import.meta.url), 'utf8');
const resolveSource = await readFile(new URL('./admin/resolve-market.js', import.meta.url), 'utf8');
const cancelMarketSource = await readFile(new URL('./admin/cancel-market.js', import.meta.url), 'utf8');
const voidMarketSource = await readFile(new URL('./admin/void-market.js', import.meta.url), 'utf8');
const cronResolveSource = await readFile(new URL('../cron/points-auto-resolve.js', import.meta.url), 'utf8');
const vercelSource = await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8');

test('points schema and manual migration create reserved limit-order book storage', () => {
  for (const source of [schemaSource, migrateSource]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS points_limit_orders/);
    assert.match(source, /side\s+TEXT NOT NULL CHECK \(side IN \('buy', 'sell'\)\)/);
    assert.match(source, /reserved_collateral/);
    assert.match(source, /reserved_shares/);
    assert.match(source, /maker_reward_accrued/);
    assert.match(source, /maker_reward_paid/);
    assert.match(source, /maker_reward_last_at/);
    assert.match(source, /idx_points_limit_orders_market_outcome/);
    assert.match(source, /idx_points_limit_orders_user/);
  }
  for (const source of [schemaSource, migrateSource]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS points_cycle_position_snapshots/);
    assert.match(source, /idx_points_cycle_position_snapshots_cycle_user/);
  }
});

test('limit-order helper reserves funds, rewards makers, and fills against AMM quotes', () => {
  assert.match(helperSource, /export async function createLimitOrder/);
  assert.match(helperSource, /export async function cancelLimitOrder/);
  assert.match(helperSource, /export async function executeTriggeredLimitOrders/);
  assert.match(helperSource, /resolveTriggeredOutcomeIndices/);
  assert.match(helperSource, /assertCryptoTradeAllowed/);
  assert.match(helperSource, /cryptoTradeLock/);
  assert.match(helperSource, /export async function lockedReservedShares/);
  assert.match(helperSource, /export async function payDailyMakerRewards/);
  assert.match(helperSource, /export function estimateMakerReward/);
  assert.match(helperSource, /POINTS_MAKER_REWARD_MAX_DAILY_PER_USER', 100/);
  assert.doesNotMatch(helperSource, /MAKER_REWARD_MAX_PER_ORDER/);
  assert.match(helperSource, /MAKER_REWARD_MAX_DISTANCE/);
  assert.match(helperSource, /qualityMultiplier/);
  assert.match(helperSource, /limit_maker_reward/);
  assert.match(helperSource, /limit_buy_reserve/);
  assert.match(helperSource, /limit_buy_release/);
  assert.match(helperSource, /limit_sell_fill/);
  assert.match(helperSource, /binaryBuyQuote|multiBuyQuote/);
  assert.match(helperSource, /binarySellQuote|multiSellQuote/);
  assert.match(helperSource, /Pago diario por liquidez/);
});

test('tournament minimum applies only before a market is covered', () => {
  assert.match(entrySource, /export async function hasCoveredTournamentMarket/);
  assert.match(entrySource, /export async function assertTournamentMinimumEntry/);
  assert.match(entrySource, /resolveTournamentScoringWindow/);
  assert.match(entrySource, /TOURNAMENT_START_ISO/);
  assert.match(entrySource, /TOURNAMENT_RANKING_CUTOFF_ISO/);
  assert.match(entrySource, /WHERE id = \$1 OR parent_id = \$1/);
  assert.match(entrySource, /side = 'buy'/);
  assert.match(entrySource, /market_id = ANY\(\$2::int\[\]\)/);
  assert.match(entrySource, /ABS\(COALESCE\(collateral, 0\)\) >= \$3/);
  assert.match(entrySource, /created_at >= \$4::timestamptz/);
  assert.match(entrySource, /created_at <= \$5::timestamptz/);
  assert.match(entrySource, /if \(await hasCoveredTournamentMarket\(client, \{ market, username \}\)\) return/);
  assert.match(entrySource, /primera entrada/);
  assert.match(helperSource, /import \{ assertTournamentMinimumEntry \} from '\.\/points-tournament-entry\.js'/);
  assert.match(helperSource, /SELECT id, question, status, reserves, outcomes, end_time, resolver_config,\s*amm_mode, parent_id/s);
  assert.match(helperSource, /await assertTournamentMinimumEntry\(client, \{\s*market,\s*username,\s*amount: qty,\s*\}\)/s);
  assert.doesNotMatch(helperSource, /qty < TOURNAMENT_MIN_ENTRY_MXNP/);
  assert.match(buySource, /import \{ assertTournamentMinimumEntry \} from '\.\.\/_lib\/points-tournament-entry\.js'/);
  assert.match(buySource, /m\.seed_liquidity, m\.seed_liquidities, m\.amm_mode, m\.parent_id/);
  assert.match(buySource, /COALESCE\(m\.tournament_featured, p\.tournament_featured, false\) AS tournament_featured/);
  assert.match(buySource, /await assertTournamentMinimumEntry\(client, \{\s*market: m,\s*username,\s*amount: amt,\s*\}\)/s);
  assert.doesNotMatch(buySource, /amt < TOURNAMENT_MIN_ENTRY_MXNP/);
});

test('maker rewards accrue after resting near the current price with no per-order cap', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const market = { end_time: '2026-08-05T12:00:00.000Z' };
  const baseOrder = {
    id: 1,
    status: 'open',
    side: 'buy',
    outcome_index: 0,
    remaining_amount: 1000,
    maker_reward_accrued: 0,
    maker_reward_paid: 0,
    created_at: '2026-08-04T11:00:00.000Z',
    maker_reward_last_at: '2026-08-04T11:00:00.000Z',
  };

  const near = estimateMakerReward({ ...baseOrder, limit_price: 0.49 }, market, [500, 500], now);
  const far = estimateMakerReward({ ...baseOrder, limit_price: 0.20 }, market, [500, 500], now);
  const tooFresh = estimateMakerReward({
    ...baseOrder,
    limit_price: 0.49,
    created_at: '2026-08-04T11:58:00.000Z',
    maker_reward_last_at: '2026-08-04T11:58:00.000Z',
  }, market, [500, 500], now);
  const alreadyPaidOrder = estimateMakerReward({
    ...baseOrder,
    limit_price: 0.49,
    remaining_amount: 10_000_000,
    maker_reward_paid: 10_000,
    created_at: '2026-07-04T12:00:00.000Z',
    maker_reward_last_at: '2026-07-04T12:00:00.000Z',
  }, market, [500, 500], now);

  assert.ok(near > 0, 'near-the-market order should earn a reward');
  assert.equal(far, 0, 'far-away order should not earn');
  assert.equal(tooFresh, 0, 'fresh order should wait for the minimum resting time');
  assert.ok(alreadyPaidOrder > 10, 'paid order should keep accruing because there is no per-order cap');
});

test('orderbook taker previews consume real resting orders before AMM fallback', () => {
  const buyPreview = previewRestingAsksForBuy([
    { id: 1, username: 'maker-a', limit_price: 0.45, remaining_amount: 100 },
    { id: 2, username: 'maker-b', limit_price: 0.50, remaining_amount: 100 },
  ], { collateral: 70 });
  assert.equal(buyPreview.fills.length, 2);
  assert.equal(buyPreview.fills[0].orderId, 1);
  assert.equal(buyPreview.sharesOut, 150);
  assert.equal(buyPreview.collateralSpent, 70);
  assert.equal(buyPreview.remainingCollateral, 0);

  const sellPreview = previewRestingBidsForSell([
    { id: 3, username: 'maker-c', limit_price: 0.60, remaining_amount: 30 },
    { id: 4, username: 'maker-d', limit_price: 0.55, remaining_amount: 30 },
  ], { shares: 120 });
  assert.equal(sellPreview.fills.length, 2);
  assert.equal(sellPreview.fills[0].orderId, 3);
  assert.equal(sellPreview.sharesSold, 104.545455);
  assert.equal(sellPreview.collateralOut, 60);
  assert.equal(sellPreview.remainingShares, 15.454545);
});

test('buy quotes display orderbook-only execution price instead of stale AMM price', () => {
  assert.match(quoteBuySource, /binaryPricesWithBookTrade/);
  assert.match(quoteBuySource, /displayTradeRows/);
  assert.match(quoteBuySource, /reserves_before = reserves_after/);
  assert.match(quoteBuySource, /const priceBefore = displayPricesBefore\[oi\] \|\| pricesBefore\[oi\] \|\| 0/);
  assert.match(quoteBuySource, /const executionPrice = avgPrice > 0 \? avgPrice : null/);
  assert.match(quoteBuySource, /const lastBookFillPrice = \[\.\.\.\(orderbook\.fills \|\| \[\]\)\]/);
  assert.match(quoteBuySource, /const priceAfter = q\?\.pricesAfter\?\.\[oi\] \?\? lastBookFillPrice \?\? executionPrice \?\? priceBefore/);
  assert.match(quoteBuySource, /priceImpactPts: \(priceAfter - priceBefore\) \* 100/);
});

test('sell quotes and orderbook current price only trust latest book-only fills', () => {
  for (const source of [quoteSellSource, orderbookSource]) {
    assert.match(source, /reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after/);
    assert.match(source, /is_book_trade/);
  }
  assert.match(quoteSellSource, /binaryPricesWithBookTrade/);
  assert.match(quoteSellSource, /const priceBefore = displayPricesBefore\[oi\] \|\| pricesBefore\[oi\] \|\| 0/);
  assert.match(quoteSellSource, /const lastBookFillPrice = \[\.\.\.\(orderbook\.fills \|\| \[\]\)\]/);
  assert.match(quoteSellSource, /const priceAfter = q\?\.priceAfter \?\? lastBookFillPrice \?\? executionPrice \?\? priceBefore/);
  assert.match(orderbookSource, /const lastBookPrice = lastRows\[0\]\?\.is_book_trade/);
  assert.match(orderbookSource, /const currentPrice = Number\.isFinite\(lastBookPrice\) \? lastBookPrice : depth\.currentPrice/);
});

test('top holders price positions with displayed book-trade odds', () => {
  assert.match(topHoldersSource, /SELECT id, parent_id, outcomes, reserves, amm_mode, status, outcome/);
  assert.match(topHoldersSource, /binaryPricesWithBookTrade/);
  assert.match(topHoldersSource, /display_trade_outcome_index/);
  assert.match(topHoldersSource, /display_trade_is_book/);
  assert.match(topHoldersSource, /PRONOS_TREASURY_USERNAME/);
  assert.match(topHoldersSource, /const prices = basePrices\.length === 2/);
  assert.match(topHoldersSource, /const legPrices = legBasePrices\.length === 2/);
});

test('Pronos maker previews use seeded depth after real resting orders', () => {
  const realPreview = previewRestingAsksForBuy([
    { id: 1, username: 'maker-a', limit_price: 0.45, remaining_amount: 100 },
  ], { collateral: 100 });
  assert.equal(realPreview.collateralSpent, 45);
  assert.equal(realPreview.remainingCollateral, 55);

  const makerPreview = previewPronosMakerAsksForBuy({
    reserves: JSON.stringify([500, 500]),
    seed_liquidity: 7500,
    seed_liquidities: null,
  }, {
    outcomeIndex: 0,
    collateral: realPreview.remainingCollateral,
    levels: [10, 25, 50, 100],
  });
  const combined = combineBuyOrderbookMatches(realPreview, makerPreview);

  assert.equal(combined.remainingCollateral, 0);
  assert.ok(combined.sharesOut > realPreview.sharesOut);
  assert.equal(combined.fills[0].source, 'limit');
  assert.equal(combined.fills[1].source, 'maker');
});

test('Pronos maker depth uses lightweight targets instead of legacy seed walls', () => {
  const market = {
    reserves: JSON.stringify([500, 500]),
    seed_liquidity: 7500,
    seed_liquidities: JSON.stringify([7500, 7500]),
  };
  const normalDepth = pronosMakerDepthForMarket(market, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });
  const trophyDepth = pronosMakerDepthForMarket({
    ...market,
    tournament_featured: true,
  }, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });

  assert.equal(normalDepth.perSideDepth, 500);
  assert.equal(trophyDepth.perSideDepth, 750);
});

test('Pronos maker depth keeps the middle light and adds shared edge walls', () => {
  const midMarket = {
    reserves: JSON.stringify([500, 500]),
  };
  const edgeMarket = {
    // binaryPrices([65, 435])[0] ~= 87%, matching a high-probability side.
    reserves: JSON.stringify([65, 435]),
  };
  const edgeCryptoMarket = {
    reserves: JSON.stringify([65, 435]),
    resolver_config: JSON.stringify({ source: 'chainlink', shape: 'binary-direction', asset: 'btc' }),
  };
  const midDepth = pronosMakerDepthForMarket(midMarket, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });
  const edgeDepth = pronosMakerDepthForMarket(edgeMarket, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });
  const edgeCryptoDepth = pronosMakerDepthForMarket(edgeCryptoMarket, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });
  const bestAsk = (depth) => depth.asks.reduce((best, row) => (
    best == null || row.price < best.price ? row : best
  ), null);

  assert.ok(bestAsk(edgeDepth).total > bestAsk(midDepth).total * 3);
  assert.ok(edgeDepth.asks.reduce((sum, row) => sum + row.total, 0) > midDepth.asks.reduce((sum, row) => sum + row.total, 0) * 3);
  assert.equal(bestAsk(edgeCryptoDepth).total, bestAsk(edgeDepth).total);
});

test('Pronos maker depth depletes from treasury trade usage', () => {
  const market = {
    reserves: JSON.stringify([500, 500]),
    seed_liquidity: 7500,
    seed_liquidities: null,
  };
  const before = previewPronosMakerAsksForBuy(market, {
    outcomeIndex: 0,
    collateral: 200,
    levels: [10, 25, 50, 100],
  });
  const usage = makerUsageFromRows([{ side: 'sell', collateral: 200 }]);
  const after = previewPronosMakerAsksForBuy(market, {
    outcomeIndex: 0,
    collateral: 200,
    levels: [10, 25, 50, 100],
    usage,
  });

  assert.ok(after.avgPrice > before.avgPrice);
  assert.ok(after.fills[0].price > before.fills[0].price);
});

test('orderbook exposes executable user rows with depleted Pronos maker depth', () => {
  assert.match(orderbookSource, /Hybrid points order book/);
  assert.match(orderbookSource, /aggregateLimitOrderRows/);
  assert.match(orderbookSource, /FROM points_limit_orders/);
  assert.match(helperSource, /source: 'limit'/);
  assert.match(helperSource, /matchPronosMakerAsksForBuy/);
  assert.match(helperSource, /matchPronosMakerBidsForSell/);
  assert.match(orderbookSource, /pronosMakerDepthForMarket/);
  assert.match(orderbookSource, /makerUsageFromRows/);
  assert.match(orderbookSource, /PRONOS_TREASURY_USERNAME/);
  assert.match(orderbookSource, /m\.seed_liquidity,\s*m\.seed_liquidities/);
  assert.match(orderbookSource, /LEFT JOIN points_markets p ON p\.id = m\.parent_id/);
  assert.match(orderbookSource, /bookType: 'mock_orderbook'/);
  assert.doesNotMatch(orderbookSource, /source: 'amm'/);
});

test('public endpoints create, list, and cancel authenticated limit orders', () => {
  assert.match(limitOrdersSource, /GET\s+\/api\/points\/limit-orders/);
  assert.match(limitOrdersSource, /POST \/api\/points\/limit-orders/);
  assert.match(limitOrdersSource, /requireSession/);
  assert.match(limitOrdersSource, /withTransaction/);
  assert.match(limitOrdersSource, /createLimitOrder/);
  assert.match(limitOrdersSource, /makerRewardAccrued/);
  assert.match(limitOrdersSource, /makerRewardPaid/);
  assert.match(limitOrdersSource, /makerRewardEstimated/);
  assert.match(limitOrdersSource, /estimateMakerReward/);
  assert.match(limitOrdersSource, /JOIN points_markets/);
  assert.match(cancelOrderSource, /cancelLimitOrder/);
  assert.match(cancelOrderSource, /orderId/);
});

test('portfolio and cron expose daily maker-reward payouts', () => {
  assert.match(makerRewardsSource, /GET \/api\/points\/maker-rewards/);
  assert.match(makerRewardsSource, /limit_maker_reward/);
  assert.match(makerRewardsSource, /totalPaid/);
  assert.match(makerRewardsSource, /paidToday/);
  assert.match(makerRewardsSource, /parentMarketId/);
  assert.match(makerRewardsCronSource, /payDailyMakerRewards/);
  assert.match(makerRewardsCronSource, /CRON_SECRET/);
  assert.match(makerRewardsCronSource, /dailyCap:\s*MAKER_REWARD_MAX_DAILY_PER_USER/);
  assert.match(vercelSource, /\/api\/cron\/points-maker-rewards/);
  assert.match(vercelSource, /0 16 \* \* \*/);
});

test('market writes trigger orders and close paths release open reserves', () => {
  assert.match(buySource, /executeTriggeredLimitOrders\(client, \{\s*marketId: mid,\s*\}\)/s);
  assert.match(sellSource, /executeTriggeredLimitOrders\(client, \{\s*marketId: mid,\s*\}\)/s);
  assert.match(buySource, /dismissed_at = NULL/);
  assert.match(helperSource, /dismissed_at = NULL/);
  assert.match(buySource, /assertCryptoTradeAllowed/);
  assert.match(sellSource, /assertCryptoTradeAllowed/);
  assert.match(helperSource, /const outcomeIndices = await resolveTriggeredOutcomeIndices/);
  assert.match(sellSource, /lockedReservedShares/);
  for (const source of [resolveSource, cancelMarketSource, voidMarketSource, cronResolveSource]) {
    assert.match(source, /releaseOpenLimitOrdersForMarkets/);
  }
});

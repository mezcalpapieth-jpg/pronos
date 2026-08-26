/**
 * Run with:
 *   node --test frontend/api/points/limit-orders.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  combineBuyOrderbookMatches,
  combineSellOrderbookMatches,
  estimateMakerReward,
  makerUsageFromRows,
  previewAmmCappedBidsForSell,
  previewPronosMakerAsksForBuy,
  previewPronosMakerBidsForSell,
  previewPronosMakerInventoryBidsForSell,
  pronosMakerDepthForMarket,
  pronosMakerExecutableBidDepthForMarket,
  pronosMakerInventoryBidDepthFromRows,
  previewRestingAsksForBuy,
  previewRestingBidsForSell,
} from '../_lib/points-limit-orders.js';
import { monotonicBuyDisplayPrice } from '../_lib/points-display-prices.js';
import { binaryBuyQuote, binaryPrices, binarySellQuote } from '../_lib/amm-math.js';
import { readTopHolderSnapshot } from '../_lib/points-top-holders.js';

const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('../_lib/points-limit-orders.js', import.meta.url), 'utf8');
const displayPriceSource = await readFile(new URL('../_lib/points-display-prices.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../_lib/points-tournament-entry.js', import.meta.url), 'utf8');
const orderbookSource = await readFile(new URL('./orderbook.js', import.meta.url), 'utf8');
const limitOrdersSource = await readFile(new URL('./limit-orders.js', import.meta.url), 'utf8');
const cancelOrderSource = await readFile(new URL('./cancel-limit-order.js', import.meta.url), 'utf8');
const makerRewardsSource = await readFile(new URL('./maker-rewards.js', import.meta.url), 'utf8');
const makerRewardsCronSource = await readFile(new URL('../cron/points-maker-rewards.js', import.meta.url), 'utf8');
const buySource = await readFile(new URL('./buy.js', import.meta.url), 'utf8');
const tradeServiceSource = await readFile(new URL('../_lib/points-trading-service.js', import.meta.url), 'utf8');
const quoteBuySource = await readFile(new URL('./quote-buy.js', import.meta.url), 'utf8');
const quoteSellSource = await readFile(new URL('./quote-sell.js', import.meta.url), 'utf8');
const topHoldersSource = await readFile(new URL('./top-holders.js', import.meta.url), 'utf8');
const topHoldersHelperSource = await readFile(new URL('../_lib/points-top-holders.js', import.meta.url), 'utf8');
const sellSource = await readFile(new URL('./sell.js', import.meta.url), 'utf8');
const resolveSource = await readFile(new URL('./admin/resolve-market.js', import.meta.url), 'utf8');
const cancelMarketSource = await readFile(new URL('./admin/cancel-market.js', import.meta.url), 'utf8');
const voidMarketSource = await readFile(new URL('./admin/void-market.js', import.meta.url), 'utf8');
const cronResolveSource = await readFile(new URL('../cron/points-auto-resolve.js', import.meta.url), 'utf8');
const crypto5MinSource = await readFile(new URL('../_lib/crypto-5min.js', import.meta.url), 'utf8');
const vercelSource = await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8');

function approxEqual(actual, expected, epsilon, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= epsilon,
    `${message || 'values'}: expected ${actual} to be within ${epsilon} of ${expected} (diff = ${diff})`,
  );
}

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
  for (const source of [schemaSource, migrateSource]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS points_top_holder_snapshots/);
    assert.match(source, /holders\s+JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(source, /idx_points_top_holder_snapshots_time/);
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
  assert.match(helperSource, /assertTournamentMinimumEntry/);
  assert.match(helperSource, /SELECT id, question, status, reserves, outcomes, end_time, resolver_config,\s*amm_mode, parent_id/s);
  assert.match(helperSource, /await assertTournamentMinimumEntry\(client, \{\s*market,\s*username,\s*amount: qty,\s*\}\)/s);
  assert.doesNotMatch(helperSource, /qty < TOURNAMENT_MIN_ENTRY_MXNP/);
  assert.match(tradeServiceSource, /assertTournamentMinimumEntry/);
  assert.match(tradeServiceSource, /assertTournamentCutoffSnapshotReady/);
  assert.match(tradeServiceSource, /assertTournamentSettlementAllowed/);
  assert.match(tradeServiceSource, /m\.seed_liquidity, m\.seed_liquidities, m\.amm_mode, m\.parent_id/);
  assert.match(tradeServiceSource, /COALESCE\(m\.tournament_featured, p\.tournament_featured, false\) AS tournament_featured/);
  assert.match(tradeServiceSource, /assertTournamentSettlementAllowed\(market\)/);
  assert.match(tradeServiceSource, /await assertTournamentCutoffSnapshotReady\(client, \{ market \}\)/);
  assert.match(tradeServiceSource, /await assertTournamentMinimumEntry\(client, \{\s*market,\s*username,\s*amount: amt,\s*\}\)/s);
  assert.doesNotMatch(tradeServiceSource, /amt < TOURNAMENT_MIN_ENTRY_MXNP/);
  assert.match(entrySource, /tournament_market_after_cutoff/);
  assert.match(entrySource, /tournament_snapshot_pending/);
  assert.match(quoteBuySource, /tournamentSettlementLock/);
  assert.match(quoteBuySource, /tournamentCutoffSnapshotLock/);
  assert.match(quoteSellSource, /tournamentCutoffSnapshotLock/);
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

test('synthetic sell previews cap maker bids to AMM unwind value', () => {
  const reserves = [671.397244, 1489.4312];
  const shares = 100;
  const amm = binarySellQuote(reserves, 0, shares);
  const preview = previewAmmCappedBidsForSell([
    { id: 'maker-bid-high', username: 'pronos_treasury', limit_price: 0.9, remaining_amount: 1000, source: 'maker' },
  ], {
    reserves,
    outcomeIndex: 0,
    shares,
  });

  assert.equal(preview.fills.length, 1);
  assert.equal(preview.remainingShares, 0);
  approxEqual(preview.collateralOut, amm.collateralOut, 0.000001, 'maker payout should match AMM sell quote');
  assert.ok(preview.fills[0].cappedToAmm);
  assert.ok(preview.fills[0].price < preview.fills[0].makerLimitPrice);
  assert.ok(preview.reservesAfter[0] > reserves[0], 'selling YES should add YES reserve');
  assert.ok(preview.reservesAfter[1] < reserves[1], 'selling YES should remove NO reserve');
});

test('synthetic maker sell cap is identity-independent across coordinated exits', () => {
  const initialReserves = [1000, 1000];
  const buyA = binaryBuyQuote(initialReserves, 0, 100);
  const buyB = binaryBuyQuote(buyA.reservesAfter, 0, 100);
  const pumpedReserves = buyB.reservesAfter;
  const generousBid = { username: 'pronos_treasury', limit_price: 0.99, remaining_amount: 1000, source: 'maker' };

  const sellA = previewAmmCappedBidsForSell([
    { ...generousBid, id: 'maker-bid-a' },
  ], {
    reserves: pumpedReserves,
    outcomeIndex: 0,
    shares: buyA.sharesOut,
  });
  const sellB = previewAmmCappedBidsForSell([
    { ...generousBid, id: 'maker-bid-b' },
  ], {
    reserves: sellA.reservesAfter,
    outcomeIndex: 0,
    shares: buyB.sharesOut,
  });

  const combinedOut = sellA.collateralOut + sellB.collateralOut;
  const netIntoPool = 200 - buyA.fee - buyB.fee;
  approxEqual(combinedOut, netIntoPool, 0.00001, 'coordinated synthetic exits should recover only net AMM input');
  assert.ok(sellA.priceAfter > sellB.priceAfter, 'second exit should continue unwinding the same virtual pool');
});

test('Pronos maker inventory buybacks unwind synthetic shares before AMM shares', () => {
  let tradeId = 1;
  let reserves = [500, 500];
  let usage = {};
  let totalShares = 0;
  let totalSpent = 0;
  let ammGrossSpent = 0;
  let ammFees = 0;
  const treasuryRows = [];

  for (const collateral of [700, 300]) {
    const maker = previewPronosMakerAsksForBuy({
      reserves: JSON.stringify(reserves),
      seed_liquidity: 500,
      seed_liquidities: null,
    }, {
      outcomeIndex: 0,
      collateral,
      usage,
      currentPrice: binaryPrices(reserves)[0],
    });

    for (const fill of maker.fills) {
      treasuryRows.push({
        id: tradeId,
        side: 'sell',
        shares: fill.shares,
        collateral: fill.collateral,
        price_at_trade: fill.price,
        created_at: new Date(1_800_000_000_000 + tradeId).toISOString(),
      });
      tradeId += 1;
    }

    const remainingCollateral = Math.max(0, collateral - maker.collateralSpent);
    if (remainingCollateral > 0.000001) {
      const amm = binaryBuyQuote(reserves, 0, remainingCollateral);
      reserves = amm.reservesAfter;
      totalShares += amm.sharesOut;
      ammGrossSpent += remainingCollateral;
      ammFees += amm.fee;
    }

    totalShares += maker.sharesOut;
    totalSpent += collateral;
    usage = makerUsageFromRows(treasuryRows);
  }

  const buyback = previewPronosMakerInventoryBidsForSell(treasuryRows, {
    shares: totalShares,
  });
  const ammShares = buyback.remainingShares;
  const ammSell = binarySellQuote(reserves, 0, ammShares);
  const totalOut = buyback.collateralOut + ammSell.collateralOut;

  approxEqual(ammSell.priceAfter, 0.5, 0.00001, 'AMM shares should return the pool to the starting price');
  approxEqual(totalOut, totalSpent - ammFees, 0.0001, 'full self-unwind should return spent collateral minus buy fees');
  assert.ok(buyback.remainingShares > 0, 'AMM-created shares should remain for the AMM fallback');
  assert.ok(buyback.remainingShares < totalShares, 'synthetic inventory should absorb the maker-created shares first');
  assert.ok(buyback.fills.length > 0);
  assert.ok(pronosMakerInventoryBidDepthFromRows(treasuryRows).length > 0);
});

test('Pronos maker sell preview feeds post-maker reserves into combined fallback', () => {
  const reserves = [671.397244, 1489.4312];
  const maker = previewPronosMakerBidsForSell({
    reserves: JSON.stringify(reserves),
    seed_liquidity: 500,
    seed_liquidities: null,
  }, {
    outcomeIndex: 0,
    shares: 120,
    levels: [10, 25, 50, 100],
    currentPrice: 0.7,
  });
  const combined = combineSellOrderbookMatches(
    { fills: [], sharesSold: 0, collateralOut: 0, remainingShares: 120, realizedPnl: 0, avgPrice: 0 },
    maker,
  );

  assert.ok(maker.fills.length > 0);
  assert.ok(Array.isArray(combined.reservesAfter));
  assert.equal(combined.reservesAfter, maker.reservesAfter);
  assert.equal(combined.priceAfter, maker.priceAfter);
});

test('orderbook maker bid depth displays AMM-capped synthetic prices', () => {
  const rawDepth = pronosMakerDepthForMarket({
    reserves: JSON.stringify([671.397244, 1489.4312]),
  }, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    currentPrice: 0.7,
  });
  const executableDepth = pronosMakerExecutableBidDepthForMarket({
    reserves: JSON.stringify([671.397244, 1489.4312]),
  }, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    currentPrice: 0.7,
  });

  assert.ok(rawDepth.bids.length > 0);
  assert.ok(executableDepth.bids.length > 0);
  assert.ok(executableDepth.bids[0].price <= rawDepth.bids[0].price);
  assert.ok(executableDepth.bids.every(row => row.source === 'maker'));
  assert.ok(executableDepth.bids.every(row => row.total <= row.shares * row.makerLimitPrice + 0.000001));
});

test('buy quotes display orderbook-only execution price instead of stale AMM price', () => {
  assert.match(quoteBuySource, /function buyOrderbookPriceCap/);
  assert.match(quoteBuySource, /const bookMaxPrice = buyOrderbookPriceCap\(reserves, oi, amt\)/);
  assert.match(quoteBuySource, /previewRestingAsksForBuy\(askRows, \{\s*collateral: amt,\s*maxPrice: bookMaxPrice,\s*\}\)/s);
  assert.match(quoteBuySource, /binaryPricesWithBookTrade/);
  assert.match(quoteBuySource, /monotonicBuyDisplayPrice/);
  assert.match(quoteBuySource, /displayTradeRows/);
  assert.match(quoteBuySource, /reserves_before = reserves_after/);
  assert.match(quoteBuySource, /const priceBefore = displayPricesBefore\[oi\] \|\| pricesBefore\[oi\] \|\| 0/);
  assert.match(quoteBuySource, /currentPrice: priceBefore/);
  assert.match(quoteBuySource, /const executionPrice = avgPrice > 0 \? avgPrice : null/);
  assert.match(quoteBuySource, /const lastBookFillPrice = \[\.\.\.\(orderbook\.fills \|\| \[\]\)\]/);
  assert.match(quoteBuySource, /const rawPriceAfter = q\?\.pricesAfter\?\.\[oi\] \?\? null/);
  assert.match(quoteBuySource, /const priceAfter = monotonicBuyDisplayPrice\(priceBefore, \[/);
  assert.match(quoteBuySource, /priceImpactPts: \(priceAfter - priceBefore\) \* 100/);
  assert.match(tradeServiceSource, /binaryPricesWithBookTrade/);
  assert.match(tradeServiceSource, /function buyOrderbookPriceCap/);
  assert.match(tradeServiceSource, /const bookMaxPrice = buyOrderbookPriceCap\(reserves, oi, amt\)/);
  assert.match(tradeServiceSource, /matchRestingAsksForBuy\(client, \{[\s\S]*maxPrice: bookMaxPrice,[\s\S]*\}\)/);
  assert.match(tradeServiceSource, /matchPronosMakerAsksForBuy\(client, \{[\s\S]*maxPrice: bookMaxPrice,[\s\S]*\}\)/);
  assert.match(tradeServiceSource, /PRONOS_TREASURY_USERNAME/);
  assert.match(tradeServiceSource, /currentPrice: displayPriceBefore \|\| null/);
  assert.match(tradeServiceSource, /const responsePriceAfter = reserves\.length === 2\s*\?\s*monotonicBuyDisplayPrice\(responsePriceBefore, \[/s);
  assert.match(quoteBuySource, /orderbookFillCount/);
  assert.doesNotMatch(quoteBuySource, /orderbookFills: orderbook\.fills/);
  assert.doesNotMatch(quoteBuySource, /ammCollateral,/);
  assert.match(buySource, /const \{ orderbookFills, triggeredLimitOrders, \.\.\.publicResult \} = result/);
});

test('buy display prices never report the selected side moving backward', () => {
  assert.match(displayPriceSource, /export function monotonicBuyDisplayPrice/);
  assert.equal(monotonicBuyDisplayPrice(0.76, [0.71]), 0.76);
  assert.equal(monotonicBuyDisplayPrice(0.76, [0.82]), 0.82);
  assert.equal(monotonicBuyDisplayPrice(0.5, [null, 0.49, 0.53]), 0.53);
});

test('sell quotes and orderbook current price only trust latest book-only fills', () => {
  for (const source of [quoteSellSource, orderbookSource]) {
    assert.match(source, /reserves_before IS NOT NULL AND reserves_after IS NOT NULL AND reserves_before = reserves_after/);
    assert.match(source, /is_book_trade/);
  }
  assert.match(quoteSellSource, /binaryPricesWithBookTrade/);
  assert.match(quoteSellSource, /function sellOrderbookPriceFloor/);
  assert.match(quoteSellSource, /const bookMinPrice = sellOrderbookPriceFloor\(reserves, oi, n\)/);
  assert.match(quoteSellSource, /previewRestingBidsForSell\(bidRows, \{\s*shares: n,\s*minPrice: bookMinPrice,\s*\}\)/s);
  assert.match(quoteSellSource, /const reservesForAmm = Array\.isArray\(orderbook\.reservesAfter\)/);
  assert.match(quoteSellSource, /binarySellQuote\(reservesForAmm, oi, ammShares\)/);
  assert.match(tradeServiceSource, /function sellOrderbookPriceFloor/);
  assert.match(tradeServiceSource, /const bookMinPrice = sellOrderbookPriceFloor\(reserves, oi, sharesToSell\)/);
  assert.match(tradeServiceSource, /matchRestingBidsForSell\(client, \{[\s\S]*minPrice: bookMinPrice,[\s\S]*\}\)/);
  assert.match(tradeServiceSource, /matchPronosMakerInventoryBidsForSell\(client, \{/);
  assert.match(tradeServiceSource, /const reservesForAmm = Array\.isArray\(orderbookMatch\.reservesAfter\)/);
  assert.match(tradeServiceSource, /binarySellQuote\(reservesForAmm, oi, ammShares\)/);
  assert.match(quoteSellSource, /previewPronosMakerInventoryBidsForSell\(makerTradeRows, \{/);
  assert.match(quoteSellSource, /const priceBefore = displayPricesBefore\[oi\] \|\| pricesBefore\[oi\] \|\| 0/);
  assert.match(quoteSellSource, /const lastBookFillPrice = \[\.\.\.\(orderbook\.fills \|\| \[\]\)\]/);
  assert.match(quoteSellSource, /const priceAfter = q\?\.priceAfter \?\? orderbook\.priceAfter \?\? lastBookFillPrice \?\? executionPrice \?\? priceBefore/);
  assert.match(orderbookSource, /binaryPricesWithBookTrade/);
  assert.match(orderbookSource, /outcomeIndex: lastRows\[0\]\?\.outcome_index/);
  assert.match(orderbookSource, /currentPrice: Number\.isFinite\(displayCurrentPrice\) \? displayCurrentPrice : null/);
  assert.match(orderbookSource, /const currentPrice = Number\.isFinite\(displayCurrentPrice\) \? displayCurrentPrice : depth\.currentPrice/);
  assert.match(quoteSellSource, /orderbookFillCount/);
  assert.doesNotMatch(quoteSellSource, /orderbookFills: orderbook\.fills/);
  assert.doesNotMatch(quoteSellSource, /ammShares,/);
  assert.match(sellSource, /const \{ orderbookFills, triggeredLimitOrders, \.\.\.publicResult \} = result/);
});

test('top holders price positions with displayed book-trade odds', () => {
  assert.match(topHoldersSource, /readTopHolderSnapshot/);
  assert.match(topHoldersSource, /buildTopHoldersForMarket/);
  assert.match(topHoldersHelperSource, /binaryPricesWithBookTrade/);
  assert.match(topHoldersHelperSource, /display_trade_outcome_index/);
  assert.match(topHoldersHelperSource, /display_trade_is_book/);
  assert.match(topHoldersHelperSource, /PRONOS_TREASURY_USERNAME/);
  assert.match(topHoldersHelperSource, /points_top_holder_snapshots/);
  assert.match(topHoldersHelperSource, /payoutValue/);
  assert.match(topHoldersHelperSource, /winningOutcomeIndex/);
  assert.match(topHoldersHelperSource, /independentLegOutcomes/);
  assert.match(topHoldersHelperSource, /holderHasDisplayValue/);
  assert.match(topHoldersHelperSource, /Math\.round\(Math\.max\(0, beforeValue, payoutValue\)\) > 0/);
  assert.match(topHoldersHelperSource, /\.filter\(holderHasDisplayValue\)/);
  assert.match(topHoldersHelperSource, /ammMode === 'parallel' && !m\.parent_id/);
  assert.match(topHoldersHelperSource, /resolvedParallelLegOutcomes/);
  assert.match(topHoldersHelperSource, /parallelSnapshotMatchesResolvedLegs/);
  assert.match(topHoldersHelperSource, /if \(!parallelSnapshotMatchesResolvedLegs\(holders, expectedByLabel\)\) return null/);
  assert.doesNotMatch(topHoldersHelperSource, /leg_not_addressable/);
});

test('stale parallel top-holder snapshots are ignored after resolution correction', async () => {
  const staleSnapshotClient = {
    async query(sql) {
      if (/FROM points_top_holder_snapshots/.test(sql)) {
        return {
          rows: [{
            market_id: 92265,
            amm_mode: 'parallel',
            outcomes: JSON.stringify(['0-255', '256-275']),
            holders: JSON.stringify([
              {
                username: 'alexis',
                outcomeLabel: '256-275 — Sí',
                shares: 5400.84,
                costBasis: 2000,
                value: 3251.16,
                payoutValue: 0,
              },
              {
                username: 'mrtriangulo',
                outcomeLabel: '0-255 — Sí',
                shares: 3481.1,
                costBasis: 1586,
                value: 1546.77,
                payoutValue: 3481.1,
              },
            ]),
            snapshotted_at: '2026-08-22T11:11:41.534Z',
          }],
        };
      }
      if (/FROM points_markets/.test(sql) && /parent_id = \$1/.test(sql)) {
        return {
          rows: [
            { id: 92266, leg_label: '0-255', status: 'resolved', outcome: 1 },
            { id: 92267, leg_label: '256-275', status: 'resolved', outcome: 0 },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  assert.equal(await readTopHolderSnapshot(staleSnapshotClient, 92265), null);
});

test('market resolution freezes top-holder snapshots before final odds collapse', () => {
  for (const source of [resolveSource, cronResolveSource, crypto5MinSource]) {
    assert.match(source, /bestEffortPersistTopHolderSnapshot/);
  }
  assert.match(resolveSource, /resolution: \{ winningOutcomeIndex: oi \}/);
  assert.match(cronResolveSource, /resolution: \{ winningOutcomeIndex: winningIdx \}/);
  assert.match(cronResolveSource, /independentLegOutcomes: independentLegResolutions\.map/);
  assert.match(crypto5MinSource, /resolution: \{ winningOutcomeIndex: closingOutcome \}/);
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

test('Pronos maker previews can anchor to displayed binary odds', () => {
  const market = {
    reserves: JSON.stringify([500, 500]),
    seed_liquidity: 500,
    seed_liquidities: null,
  };
  const stalePreview = previewPronosMakerAsksForBuy(market, {
    outcomeIndex: 1,
    collateral: 100,
    levels: [10, 25, 50, 100],
  });
  const anchoredPreview = previewPronosMakerAsksForBuy(market, {
    outcomeIndex: 1,
    collateral: 100,
    levels: [10, 25, 50, 100],
    currentPrice: 0.4,
  });
  const highestFillPrice = Math.max(...anchoredPreview.fills.map(fill => fill.price));

  assert.ok(stalePreview.avgPrice > 0.5);
  assert.ok(anchoredPreview.avgPrice < 0.5);
  assert.ok(highestFillPrice < 0.5);
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

test('Pronos maker depth lets corrective edge flow reach the AMM', () => {
  const lowOutcomeMarket = {
    // outcome 0 is about 5.5%, like a longshot tournament leg.
    reserves: JSON.stringify([1715.54, 100]),
  };
  const highOutcomeMarket = {
    // outcome 0 is about 94.5%, the opposite edge.
    reserves: JSON.stringify([100, 1715.54]),
  };
  const lowDepth = pronosMakerDepthForMarket(lowOutcomeMarket, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    currentPrice: 0.055,
  });
  const highDepth = pronosMakerDepthForMarket(highOutcomeMarket, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    currentPrice: 0.945,
  });
  const midDepth = pronosMakerDepthForMarket({
    reserves: JSON.stringify([500, 500]),
  }, {
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    currentPrice: 0.5,
  });

  assert.equal(lowDepth.asks.length, 0);
  assert.ok(lowDepth.bids.length > 0);
  assert.ok(highDepth.asks.length > 0);
  assert.equal(highDepth.bids.length, 0);
  assert.ok(midDepth.asks.length > 0);
  assert.ok(midDepth.bids.length > 0);
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
  assert.match(helperSource, /matchPronosMakerInventoryBidsForSell/);
  assert.match(helperSource, /pronosMakerInventoryBidDepthFromRows/);
  assert.match(orderbookSource, /pronosMakerInventoryBidDepthFromRows/);
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
  assert.match(tradeServiceSource, /executeTriggeredLimitOrders\(client, \{\s*marketId: mid\s*\}\)/s);
  assert.match(tradeServiceSource, /executeTriggeredLimitOrders\(client, \{\s*marketId: mid\s*\}\)/s);
  assert.match(tradeServiceSource, /dismissed_at = NULL/);
  assert.match(helperSource, /dismissed_at = NULL/);
  assert.match(tradeServiceSource, /assertCryptoTradeAllowed/);
  assert.match(tradeServiceSource, /assertCryptoTradeAllowed/);
  assert.match(helperSource, /const outcomeIndices = await resolveTriggeredOutcomeIndices/);
  assert.match(tradeServiceSource, /lockedReservedShares/);
  for (const source of [resolveSource, cancelMarketSource, voidMarketSource, cronResolveSource]) {
    assert.match(source, /releaseOpenLimitOrdersForMarkets/);
  }
});

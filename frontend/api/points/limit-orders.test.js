/**
 * Run with:
 *   node --test frontend/api/points/limit-orders.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateMakerReward } from '../_lib/points-limit-orders.js';

const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('../_lib/points-limit-orders.js', import.meta.url), 'utf8');
const orderbookSource = await readFile(new URL('./orderbook.js', import.meta.url), 'utf8');
const limitOrdersSource = await readFile(new URL('./limit-orders.js', import.meta.url), 'utf8');
const cancelOrderSource = await readFile(new URL('./cancel-limit-order.js', import.meta.url), 'utf8');
const makerRewardsSource = await readFile(new URL('./maker-rewards.js', import.meta.url), 'utf8');
const makerRewardsCronSource = await readFile(new URL('../cron/points-maker-rewards.js', import.meta.url), 'utf8');
const buySource = await readFile(new URL('./buy.js', import.meta.url), 'utf8');
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
});

test('limit-order helper reserves funds, rewards makers, and fills against AMM quotes', () => {
  assert.match(helperSource, /export async function createLimitOrder/);
  assert.match(helperSource, /export async function cancelLimitOrder/);
  assert.match(helperSource, /export async function executeTriggeredLimitOrders/);
  assert.match(helperSource, /resolveTriggeredOutcomeIndices/);
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

test('orderbook exposes real user rows with AMM fallback liquidity', () => {
  assert.match(orderbookSource, /Hybrid points order book/);
  assert.match(orderbookSource, /aggregateLimitOrderRows/);
  assert.match(orderbookSource, /FROM points_limit_orders/);
  assert.match(helperSource, /source: 'limit'/);
  assert.match(orderbookSource, /source: 'amm'/);
  assert.match(orderbookSource, /bookType: 'hybrid'/);
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
  assert.match(helperSource, /const outcomeIndices = await resolveTriggeredOutcomeIndices/);
  assert.match(sellSource, /lockedReservedShares/);
  for (const source of [resolveSource, cancelMarketSource, voidMarketSource, cronResolveSource]) {
    assert.match(source, /releaseOpenLimitOrdersForMarkets/);
  }
});

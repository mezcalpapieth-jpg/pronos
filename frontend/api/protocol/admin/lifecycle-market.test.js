/**
 * Static behavior checks for protocol market lifecycle shell actions.
 *
 * Run with:
 *   node --test frontend/api/protocol/admin/lifecycle-market.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readOptional(url) {
  return readFile(url, 'utf8').catch(() => '');
}

const source = await readOptional(new URL('./lifecycle-market.js', import.meta.url));
const pushRefundsSource = await readOptional(new URL('./push-cancel-refunds.js', import.meta.url));
const schemaSource = await readFile(new URL('../../_lib/protocol-schema.js', import.meta.url), 'utf8');
const marketsSource = await readFile(new URL('../markets.js', import.meta.url), 'utf8');
const marketSource = await readFile(new URL('../market.js', import.meta.url), 'utf8');
const payloadSource = await readFile(new URL('../../_lib/protocol-market-payload.js', import.meta.url), 'utf8');
const indexerSource = await readFile(new URL('../../indexer.js', import.meta.url), 'utf8');
const buySource = await readFile(new URL('../buy.js', import.meta.url), 'utf8');
const sellSource = await readFile(new URL('../sell.js', import.meta.url), 'utf8');
const quoteBuySource = await readFile(new URL('../quote-buy.js', import.meta.url), 'utf8');
const quoteSellSource = await readFile(new URL('../quote-sell.js', import.meta.url), 'utf8');
const onchainTraderSource = await readFile(new URL('../../_lib/onchain-trader.js', import.meta.url), 'utf8');

test('protocol schema stores shell lifecycle audit fields', () => {
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS previous_status TEXT/);
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS lifecycle_note TEXT/);
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ/);
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS lifecycle_updated_by TEXT/);
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ/);
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMPTZ/);
});

test('lifecycle-market can shell cancel, dispute, clear dispute, reopen, and optionally call contract lifecycle', () => {
  assert.match(source, /POST \/api\/protocol\/admin\/lifecycle-market/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /ensureProtocolSchema/);
  assert.match(source, /action === 'cancel'/);
  assert.match(source, /action === 'dispute'/);
  assert.match(source, /action === 'clear_dispute'/);
  assert.match(source, /action === 'reopen'/);
  assert.match(source, /status = 'canceled'/);
  assert.match(source, /status = 'disputed'/);
  assert.match(source, /previous_status/);
  assert.match(source, /onchain.*true/);
  assert.match(source, /lifecycleMarketOnChain/);
  assert.match(source, /ONCHAIN_OWNER_SUBORG_ID/);
  assert.match(source, /onchainPaused:\s*Boolean\(onchainResult && action === 'cancel'\)/);
  assert.match(source, /onchainRefunded:\s*false/);
});

test('lifecycle-market returns an indexed refund report for admin push-refunds', () => {
  assert.match(source, /refundReport/);
  assert.match(source, /outcome_positions/);
  assert.match(source, /positions/);
  assert.match(source, /trades/);
  assert.match(source, /openCost/);
  assert.match(source, /openShares/);
  assert.match(source, /traderCount/);
  assert.match(source, /grossBuy/);
  assert.match(source, /grossSell/);
});

test('protocol public reads expose canceled and disputed statuses', () => {
  assert.match(marketsSource, /'canceled'/);
  assert.match(marketsSource, /'disputed'/);
  assert.match(marketSource, /lifecycle_note/);
  assert.match(marketsSource, /lifecycle_note/);
  assert.match(payloadSource, /lifecycleNote/);
  assert.match(payloadSource, /previousStatus/);
  assert.match(payloadSource, /canceledAt/);
  assert.match(payloadSource, /disputeOpenedAt/);
});

test('indexer does not overwrite manual shell cancel or dispute statuses with delayed resolution events', () => {
  assert.match(indexerSource, /status IN \('canceled', 'disputed'\)/);
  assert.match(indexerSource, /THEN status ELSE 'resolved'/);
  assert.match(indexerSource, /THEN outcome ELSE \$\{outcome\}/);
  assert.match(indexerSource, /MarketCanceled/);
  assert.match(indexerSource, /ResolutionDisputeOpened/);
  assert.match(indexerSource, /ResolutionDisputeCleared/);
  assert.match(indexerSource, /MarketResolutionCorrected/);
  assert.match(indexerSource, /CancelRefundPushed/);
});

test('all protocol trade and quote paths reject non-active lifecycle statuses', () => {
  for (const fileSource of [buySource, sellSource, quoteBuySource, quoteSellSource]) {
    assert.match(fileSource, /m\.status !== 'active'/);
    assert.match(fileSource, /market_closed/);
  }
});

test('onchain trader knows native cancel, dispute, correction, and cancel-refund factory calls', () => {
  assert.match(onchainTraderSource, /function cancelMarket\(uint256 marketId\) external/);
  assert.match(onchainTraderSource, /function openResolutionDispute\(uint256 marketId\) external/);
  assert.match(onchainTraderSource, /function clearResolutionDispute\(uint256 marketId\) external/);
  assert.match(onchainTraderSource, /function correctResolution\(uint256 marketId, uint8 newOutcome\) external/);
  assert.match(onchainTraderSource, /function pushCancelRefund\(uint256 marketId, address\[\] holders, uint8\[\]\[\] outcomeIndexes/);
  assert.match(onchainTraderSource, /export async function lifecycleMarketOnChain/);
  assert.match(onchainTraderSource, /export async function pushCancelRefundsOnChain/);
  assert.match(onchainTraderSource, /factory\.owner\(\)/);
});

test('push-cancel-refunds endpoint sends explicit owner-signed refund batches', () => {
  assert.match(pushRefundsSource, /POST \/api\/protocol\/admin\/push-cancel-refunds/);
  assert.match(pushRefundsSource, /requirePointsAdmin/);
  assert.match(pushRefundsSource, /pushCancelRefundsOnChain/);
  assert.match(pushRefundsSource, /market\.status !== 'canceled'/);
  assert.match(pushRefundsSource, /ONCHAIN_OWNER_SUBORG_ID/);
  assert.match(pushRefundsSource, /refund_batch_too_large/);
  assert.match(pushRefundsSource, /yesShares/);
  assert.match(pushRefundsSource, /noShares/);
});

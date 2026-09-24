import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildProtocolApprovalTransaction,
  buildProtocolBuyTransaction,
  buildProtocolRedeemTransaction,
  buildProtocolSellTransaction,
} from './onchain-trader.js';
import {
  normalizeAction,
  normalizeLimit,
  normalizeMarketLookup,
  normalizeStatus,
  normalizeWalletAddress,
  toPartnerMarket,
  withPartnerEnvelope,
} from './partner-onchain.js';

test('partner onchain normalizers keep public inputs bounded', () => {
  assert.equal(normalizeStatus('resolved'), 'resolved');
  assert.equal(normalizeStatus('weird'), 'active');
  assert.equal(normalizeAction('sell'), 'sell');
  assert.equal(normalizeAction('redeem'), 'redeem');
  assert.equal(normalizeAction('bad'), null);
  assert.equal(normalizeLimit('999', { max: 200 }), 200);
  assert.equal(normalizeLimit('-1'), 100);
  assert.deepEqual(normalizeMarketLookup('123'), {
    dbId: 123,
    chainMarketId: 123,
    poolAddress: null,
  });
  assert.deepEqual(normalizeMarketLookup('0x1234567890123456789012345678901234567890'), {
    dbId: null,
    chainMarketId: null,
    poolAddress: '0x1234567890123456789012345678901234567890',
  });
  assert.equal(
    normalizeWalletAddress('0x1234567890123456789012345678901234567890'),
    '0x1234567890123456789012345678901234567890',
  );
  assert.equal(normalizeWalletAddress('not-a-wallet'), null);
});

test('partner onchain market payload exposes localized labels and venue metadata', () => {
  const market = toPartnerMarket({
    mode: 'onchain',
    id: 7,
    marketId: 42,
    poolAddress: '0x1234567890123456789012345678901234567890',
    factoryAddress: '0x0000000000000000000000000000000000000001',
    chainId: 42161,
    protocolVersion: 'v2',
    question: '¿Llueve mañana en CDMX?',
    title_es: '¿Llueve mañana en CDMX?',
    title_en: 'Will it rain tomorrow in Mexico City?',
    outcomes: ['Sí', 'No'],
    outcomes_es: ['Sí', 'No'],
    outcomes_en: ['Yes', 'No'],
    prices: [0.62, 0.38],
    status: 'active',
    endTime: new Date(Date.now() + 86_400_000).toISOString(),
    category: 'clima',
    liquidity: 1000,
  });

  assert.equal(market.id, '7');
  assert.equal(market.venueMarketId, 'pronos:42161:42');
  assert.equal(market.tradable, true);
  assert.equal(market.question.en, 'Will it rain tomorrow in Mexico City?');
  assert.equal(market.outcomes[0].labels.en, 'Yes');
  assert.equal(market.outcomes[0].price, 0.62);
});

test('partner onchain envelope advertises capabilities without secrets', () => {
  const envelope = withPartnerEnvelope({ headers: { host: 'pronos.io', 'x-forwarded-proto': 'https' } }, {
    ok: true,
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.venue.id, 'pronos');
  assert.equal(envelope.capabilities.calldata, true);
  assert.equal(envelope.capabilities.serverSideExecution, false);
  assert.equal(envelope.links.documentationPath, 'docs/bitso-onchain-integration.md');
});

test('protocol calldata builders return wallet-signable transaction requests', () => {
  const priorCollateral = process.env.ONCHAIN_COLLATERAL_ADDRESS;
  const priorChainId = process.env.ONCHAIN_CHAIN_ID;
  process.env.ONCHAIN_COLLATERAL_ADDRESS = '0x0000000000000000000000000000000000000001';
  process.env.ONCHAIN_CHAIN_ID = '42161';
  try {
    const market = {
      chain_address: '0x1234567890123456789012345678901234567890',
      outcomes: ['Sí', 'No'],
    };
    const approval = buildProtocolApprovalTransaction({ spender: market.chain_address, amount: 'max' });
    const buy = buildProtocolBuyTransaction({
      market,
      outcomeIndex: 0,
      collateral: 25,
      minSharesOut: 20,
    });
    const sell = buildProtocolSellTransaction({
      market,
      outcomeIndex: 1,
      shares: 10,
      minCollateralOut: 8,
    });
    const redeem = buildProtocolRedeemTransaction({ market, amount: 5 });

    assert.equal(approval.type, 'erc20_approval');
    assert.equal(approval.chainId, 42161);
    assert.match(approval.data, /^0x095ea7b3/);
    assert.equal(buy.type, 'market_buy');
    assert.equal(buy.outcomeIndex, 0);
    assert.equal(buy.collateral, '25.0');
    assert.equal(sell.type, 'market_sell');
    assert.equal(sell.outcomeIndex, 1);
    assert.equal(redeem.type, 'market_redeem');
    assert.equal(redeem.amount, '5.0');
  } finally {
    if (priorCollateral === undefined) delete process.env.ONCHAIN_COLLATERAL_ADDRESS;
    else process.env.ONCHAIN_COLLATERAL_ADDRESS = priorCollateral;
    if (priorChainId === undefined) delete process.env.ONCHAIN_CHAIN_ID;
    else process.env.ONCHAIN_CHAIN_ID = priorChainId;
  }
});

test('partner onchain route skeleton exposes market, quote, calldata and positions surfaces', async () => {
  const routePaths = [
    '../partners/onchain/health.js',
    '../partners/onchain/markets.js',
    '../partners/onchain/market.js',
    '../partners/onchain/quote.js',
    '../partners/onchain/calldata.js',
    '../partners/onchain/positions.js',
  ];
  const routes = await Promise.all(routePaths.map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(routes[1], /readPartnerMarketRows/);
  assert.match(routes[2], /readPartnerMarketRow/);
  assert.match(routes[3], /quoteBuyOnChain/);
  assert.match(routes[4], /buildProtocolBuyTransaction/);
  assert.match(routes[4], /buildProtocolApprovalTransaction/);
  assert.match(routes[5], /outcome_positions/);
});

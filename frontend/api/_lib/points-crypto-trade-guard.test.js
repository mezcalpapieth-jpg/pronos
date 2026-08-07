import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCryptoTradeAllowed,
  cryptoTradeLock,
  isCrypto5MinMarket,
} from './points-crypto-trade-guard.js';

const baseMarket = {
  status: 'active',
  end_time: '2026-08-07T12:00:00.000Z',
  resolver_config: {
    shape: 'binary-direction',
    source: 'chainlink',
    asset: 'btc',
    closesAt: '2026-08-07T12:00:00.000Z',
  },
};

test('crypto guard detects Chainlink 5-minute markets', () => {
  assert.equal(isCrypto5MinMarket(baseMarket), true);
  assert.equal(isCrypto5MinMarket({ resolver_config: { source: 'espn' } }), false);
});

test('crypto guard allows trading until the close boundary', () => {
  assert.equal(cryptoTradeLock(baseMarket, new Date('2026-08-07T11:59:30.000Z')), null);
  assert.equal(cryptoTradeLock(baseMarket, new Date('2026-08-07T11:59:45.000Z')), null);
  assert.equal(cryptoTradeLock(baseMarket, new Date('2026-08-07T11:59:59.999Z')), null);
});

test('crypto guard treats the close boundary as expired', () => {
  const lock = cryptoTradeLock(baseMarket, new Date('2026-08-07T12:00:00.000Z'));
  assert.equal(lock?.error, 'market_expired');
  assert.equal(lock?.status, 400);
});

test('crypto guard parses string resolver configs and throws structured errors', () => {
  const market = {
    ...baseMarket,
    resolver_config: JSON.stringify(baseMarket.resolver_config),
  };

  assert.doesNotThrow(
    () => assertCryptoTradeAllowed(market, new Date('2026-08-07T11:59:50.000Z')),
  );
  assert.throws(
    () => assertCryptoTradeAllowed(market, new Date('2026-08-07T12:00:00.000Z')),
    (err) => err?.message === 'market_expired' && err?.status === 400,
  );
});

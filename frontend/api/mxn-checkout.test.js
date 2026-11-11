import assert from 'node:assert/strict';
import test from 'node:test';
import { createMxnCheckoutHandler } from './mxn-checkout.js';
import { quoteMxn } from './_lib/mxn-checkout-quote.js';

const NOW = Date.parse('2026-11-11T03:00:00Z');
const path = '/api/mxn-checkout';
const endpoint = `${path}?action=quote&venue=hip4&marketId=27986&outcomeIndex=0&side=buy&amountMxn=300`;
const fx = { bid: '19.90000000', ask: '20.10000000', timeMs: NOW - 1000 };
const level = (price, size = '1000') => ({ price, size });
const snapshot = {
  market: { venue: 'hip4', id: '27986' },
  bids: [level('0.49')], asks: [level('0.51')],
  bookTimeMs: NOW - 1000, expiresAtMs: NOW + 10_000, minOrderSize: '1',
  builderFeeBps: 25, venueFeeBps: 10, builderFeeStatus: 'scenario', venueFeeStatus: 'scenario',
};
const quote = (side, overrides, ticketMxn = 100, overridesFx = fx) => quoteMxn({
  snapshot: { ...snapshot, ...overrides }, side, ticketMxn, fx: overridesFx, nowMs: NOW,
});

test('MXN buys stay within cash budget and sells sweep the midpoint-sized position', () => {
  const buy = quote('buy');
  assert.equal(buy.status, 'eligible');
  assert.equal(buy.filledShares, '9');
  assert.equal(buy.requestedShares, null);
  assert.equal(buy.netMxn, '92.581906');
  assert.equal(buy.remainingMxn, '7.418093');
  assert.equal(buy.fxRate, '20.1');
  assert.equal(buy.midpoint, '0.5');
  assert.equal(buy.vwap, '0.51');
  assert.equal(buy.pronosFeeMxn, '0.230647');
  assert.equal(buy.feeBps, 35);
  const sell = quote('sell');
  assert.equal(sell.status, 'eligible');
  assert.equal(sell.requestedShares, '10');
  assert.equal(sell.filledShares, '10');
  assert.equal(sell.netMxn, '97.168715');
  assert.equal(sell.fxRate, '19.9');
  assert.equal(sell.fundingCostMxn, null);
  assert.equal(sell.executable, false);
});

test('accepts exactly 5% and rejects over 5% with the dynamic fee', () => {
  const fee = { venueFeeRate: '0.05', builderFeeBps: 50, builderFeeStatus: 'public_effective',
    venueFeeStatus: 'public_curve', bids: [level('0.09')] };
  const exact = quote('buy', { ...fee, asks: [level('0.1')] });
  assert.equal(exact.feeBps, 500);
  assert.equal(exact.eligible, true);
  const above = quote('buy', { ...fee, asks: [level('0.099')] });
  assert.equal(above.feeBps, 500.5);
  assert.equal(above.status, 'fee_cap_exceeded');
  const aboveSell = quote('sell', { ...fee, asks: [level('0.1')] });
  assert.equal(aboveSell.status, 'fee_cap_exceeded');
  assert.equal(aboveSell.feeBps, 505);
  const currentRate = quote('buy', { ...fee, builderFeeBps: 0, asks: [level('0.099')] });
  assert.equal(currentRate.eligible, true);
  assert.equal(currentRate.pronosFeeMxn, '0');
});

test('distinguishes partial displayed depth and venue minimums', () => {
  assert.equal(quote('buy', { asks: [level('0.51', '2')] }).status, 'partial_depth');
  assert.equal(quote('buy', { asks: [level('0.51', '9')] }).status, 'eligible');
  assert.equal(quote('sell', { bids: [level('0.49', '2.5')] }).status, 'partial_depth');
  assert.equal(quote('buy', { minOrderSize: '10' }).status, 'below_minimum');
  assert.equal(quote('sell', { minOrderSize: '11' }).status, 'below_minimum');
});

test('a multi-level quote uses actual fill prices for fees and averages', () => {
  const result = quote('sell', { bids: [level('0.4', '6.5'), level('0.49', '4.5')] });
  assert.equal(result.filledShares, '10');
  assert.equal(result.worstPrice, '0.4');
  assert.equal(result.vwap, '0.4405');
  assert.equal(result.status, 'eligible');
});

test('stale, crossed or malformed data cannot pass the gate', () => {
  assert.throws(() => quote('buy', { bookTimeMs: NOW - 15_000 }), /stale_quote/);
  assert.throws(() => quote('buy', { expiresAtMs: NOW }), /stale_quote/);
  assert.throws(() => quote('buy', { bids: [level('0.51')] }), /invalid_depth/);
  assert.throws(() => quote('buy', { asks: [level('0.51'), level('0.51')] }), /invalid_depth/);
  assert.throws(() => quote('buy', {}, 100, { ...fx, timeMs: NOW - 120_000 }), /stale_quote/);
  assert.throws(() => quote('buy', {}, 100, { ...fx, ask: '19' }), /invalid_fx/);
});

function request(handler, url, method = 'GET', query) {
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return handler({ method, url, query, headers: {} }, res).then(() => res);
}

test('only valid enabled GETs can read venue and FX data', async () => {
  const calls = [];
  const data = {
    async markets() { calls.push('markets'); return { markets: [snapshot.market], unavailableVenues: [] }; },
    async snapshot(input) { calls.push(input); return snapshot; },
    async fx() { calls.push('fx'); return fx; },
  };
  const disabled = createMxnCheckoutHandler({ data, env: {}, now: () => NOW });
  assert.equal((await request(disabled, endpoint)).code, 404);
  const handler = createMxnCheckoutHandler({ data, env: { MXN_CHECKOUT_ENABLED: 'true' }, now: () => NOW });
  assert.equal((await request(handler, endpoint, 'POST')).code, 405);
  assert.equal((await request(handler, endpoint + '&amountMxn=100')).code, 400);
  assert.equal((await request(handler, endpoint + '&order=true')).code, 400);
  assert.equal((await request(handler, endpoint.replace('300', '200'))).code, 400);
  assert.equal((await request(handler, endpoint.replace('hip4', 'unknown'))).code, 400);
  assert.deepEqual(calls, []);
  const list = await request(handler, path + '?action=markets');
  assert.equal(list.code, 200);
  assert.deepEqual(list.body.markets, [snapshot.market]);
  const result = await request(handler, endpoint);
  assert.equal(result.code, 200);
  assert.equal(result.body.quote.eligible, true);
  assert.equal(result.body.policy.subsidizesFunding, false);
  assert.equal(result.body.policy.subsidizesVenueFees, false);
  assert.deepEqual(calls, ['markets', {
    venue: 'hip4', marketId: '27986', outcomeIndex: 0, side: 'buy', ticketMxn: 300,
  }, 'fx']);
});

test('funding quotes use the read-only gate and accept the three peso tickets on both venues', async () => {
  const calls = [];
  const funding = {
    async quote(input) {
      calls.push(input);
      return { ...input, executable: false, pronosSubsidyMxn: '0' };
    },
  };
  const disabled = createMxnCheckoutHandler({ funding, env: { MXN_CHECKOUT_ENABLED: 'false' } });
  const handler = createMxnCheckoutHandler({ funding, env: { MXN_CHECKOUT_ENABLED: 'true' } });
  const url = `${path}?action=funding&venue=hip4&direction=deposit&amountMxn=100`;

  assert.equal((await request(disabled, url)).code, 404);
  assert.equal((await request(handler, url, 'POST')).code, 405);
  for (const invalid of [url + '&wallet=abc', url + '&amountMxn=300', url.replace('100', '200'),
    url.replace('deposit', 'buy'), url.replace('hip4', 'native')]) {
    assert.equal((await request(handler, invalid)).code, 400);
  }
  assert.deepEqual(calls, []);

  for (const venue of ['hip4', 'polymarket']) {
    for (const direction of ['deposit', 'withdrawal']) {
      for (const ticketMxn of [100, 300, 1000]) {
        const input = { venue, direction, ticketMxn };
        const result = await request(handler,
          `${path}?action=funding&venue=${venue}&direction=${direction}&amountMxn=${ticketMxn}`);
        assert.equal(result.code, 200);
        assert.equal(result.headers['Cache-Control'], 'no-store');
        assert.equal(result.body.policy.fundingEnabled, false);
        assert.equal(result.body.policy.subsidizesFunding, false);
        assert.deepEqual(calls.at(-1), input);
        assert.deepEqual(result.body.quote, { ...input, executable: false, pronosSubsidyMxn: '0' });
      }
    }
  }
  assert.equal(calls.length, 12);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverSportsMarkets, loadPolymarketSnapshot, normalizePolymarketMarket, quotePolymarket,
} from './polymarket-distribution.js';
import { POLYMARKET_BUILDER_PROFILE } from './polymarket-builder.js';

const NOW = Date.parse('2026-11-11T01:00:00.000Z');
const CONDITION = `0x${'a'.repeat(64)}`;
const OTHER_CONDITION = `0x${'b'.repeat(64)}`;
const clone = (value) => structuredClone(value);
const throwsCode = (fn, code) => assert.throws(fn, (error) => error.code === code);
const rejectsCode = (fn, code) => assert.rejects(fn, (error) => error.code === code);

function fixtures() {
  const market = {
    id: '123', question: 'Heat vs. Jazz',
    description: `In the upcoming NBA game between Heat and Jazz, originally scheduled for Tuesday, November 10, 2026 at 9:00 PM ET (as of creation of the first market related to the event):
If the Heat win, the market will resolve to "Heat".
If the Jazz win, the market will resolve to "Jazz".
If this market's outcome was definitively determined under its rules by the listed resolution sources before abandonment, that outcome will stand. Otherwise, the following no-result provisions apply. If the game is canceled, does not start by Thursday, November 12, 2026, 11:59 PM ET, or is abandoned with no official result by that time, this market will resolve 50-50.
The result will be determined based on the final score including any overtime periods.`,
    resolutionSource: 'https://www.nba.com/', endDate: '2026-11-11T02:00:00Z',
    version: 'v1', conditionId: CONDITION, clobTokenIds: '["101","102"]',
    positionIds: ['201', '202'], outcomes: '["Heat","Jazz"]',
    active: true, closed: false, archived: false, enableOrderBook: true, acceptingOrders: true,
    sportsMarketType: 'moneyline', negRisk: false, restricted: true,
  };
  const details = {
    c: CONDITION, v: 'v1', ao: true, t: [{ t: '101', o: 'Heat' }, { t: '102', o: 'Jazz' }],
    mts: 0.01, mos: 5, mbf: 1000, tbf: 1000, fd: { r: 0.05, e: 1, to: true },
  };
  const book = {
    market: CONDITION, asset_id: '101', timestamp: String(NOW),
    bids: [{ price: '0.4', size: '100' }], asks: [{ price: '0.5', size: '100' }],
    min_order_size: '5', tick_size: '0.01', neg_risk: false,
  };
  const event = { active: true, closed: false, archived: false, tags: [{ id: '1', slug: 'sports' }], markets: [market] };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    let data;
    if (parsed.hostname === 'gamma-api.polymarket.com' && parsed.pathname === '/markets') data = event.markets;
    else if (parsed.hostname === 'gamma-api.polymarket.com' && parsed.pathname === '/markets/123') data = market;
    else if (parsed.hostname === 'clob.polymarket.com' && parsed.pathname === `/clob-markets/${CONDITION}`) data = details;
    else if (parsed.hostname === 'clob.polymarket.com' && parsed.pathname === '/book') data = book;
    else throw new Error(`Unexpected URL ${url}`);
    return { ok: true, async json() { return clone(data); } };
  };
  const load = (extra = {}) => loadPolymarketSnapshot({ marketId: '123', fetchImpl, now: () => NOW, ...extra });
  return { market, details, book, event, calls, fetchImpl, load };
}

test('version chooses its own explicit identifiers even when both API fields coexist', () => {
  const { market } = fixtures();
  assert.deepEqual(normalizePolymarketMarket(market).outcomes.map((o) => o.tokenId), ['101', '102']);
  market.version = 'v2';
  assert.deepEqual(normalizePolymarketMarket(market).outcomes.map((o) => o.tokenId), ['201', '202']);
  delete market.positionIds;
  throwsCode(() => normalizePolymarketMarket(market), 'UNSUPPORTED_MARKET');
  market.version = null;
  throwsCode(() => normalizePolymarketMarket(market), 'UNSUPPORTED_VERSION');
  market.version = 'v3';
  throwsCode(() => normalizePolymarketMarket(market), 'UNSUPPORTED_VERSION');
});

test('normalization preserves rules, resolution source and unverified restricted access', () => {
  const { market } = fixtures();
  const result = normalizePolymarketMarket(market);
  assert.equal(result.rules, market.description);
  assert.equal(result.cancellationPayoutPerShare, '0.50');
  assert.equal(result.cancellationDeadline, 'Thursday, November 12, 2026, 11:59 PM ET');
  assert.equal(result.resolutionSource, 'https://www.nba.com/');
  assert.equal(result.restricted, true);
  assert.equal(result.accessEligibility, 'unverified');
  for (const mutate of [
    (m) => { m.active = false; }, (m) => { m.closed = true; }, (m) => { m.acceptingOrders = false; },
    (m) => { delete m.enableOrderBook; }, (m) => { m.archived = true; },
  ]) {
    const bad = clone(market); mutate(bad);
    throwsCode(() => normalizePolymarketMarket(bad), 'MARKET_NOT_TRADING');
  }
  const nonsports = { ...market, sportsMarketType: null };
  throwsCode(() => normalizePolymarketMarket(nonsports), 'UNSUPPORTED_MARKET');
  throwsCode(() => normalizePolymarketMarket(nonsports, { sportsEvent: true }), 'UNSUPPORTED_CANCELLATION');
});

test('discovery returns up to five eligible moneylines and an empty list when none qualify', async () => {
  const f = fixtures();
  f.event.markets = Array.from({ length: 9 }, (_, i) => ({ ...f.market, id: String(100 + i) }));
  assert.equal((await discoverSportsMarkets({ fetchImpl: f.fetchImpl, now: () => NOW })).length, 5);
  const requested = new URL(f.calls[0].url);
  assert.equal(requested.searchParams.get('tag_id'), '745');
  assert.equal(requested.searchParams.get('sports_market_types'), 'moneyline');
  assert.equal(requested.searchParams.get('limit'), '20');
  assert.equal(requested.searchParams.get('end_date_min'), new Date(NOW).toISOString());
  assert.equal(requested.searchParams.get('end_date_max'), new Date(NOW + 7 * 86_400_000).toISOString());
  await rejectsCode(() => discoverSportsMarkets({ limit: 6 }), 'INVALID_LIMIT');
  f.event.markets = [{ ...f.market, outcomes: '["A","B","C"]' }, { ...f.market, version: null }];
  assert.deepEqual(await discoverSportsMarkets({ fetchImpl: f.fetchImpl, now: () => NOW }), []);
});

test('cancellation eligibility requires the entire rule to match the outcomes of the standalone contract', () => {
  const { market } = fixtures();
  assert.equal(normalizePolymarketMarket({ ...market, rules: market.description.replaceAll('\n', '\r\n\r\n') })
    .cancellationPayoutPerShare, '0.50');
  for (const overrides of [
    { description: 'If the teams tie, this market will resolve 50-50.' },
    { description: market.description.replace('will resolve 50-50', 'will resolve to Jazz') },
    { description: market.description + '\nIn the event of cancellation, Jazz wins.' },
    { description: market.description + ' '.repeat(16_000) + 'Cancellation resolves to Jazz.' },
    { rules: 'If the game is canceled, resolve to Jazz.' },
    { description: null, rules: market.description },
    { outcomes: ['Yes', 'No'] },
    { negRisk: true },
    { sportsMarketType: 'spreads' },
  ]) {
    throwsCode(() => normalizePolymarketMarket({ ...market, ...overrides }), 'UNSUPPORTED_CANCELLATION');
  }
});

test('direct quote reload rejects a market with changed cancellation rules before fetching its book', async () => {
  const f = fixtures();
  const listed = await discoverSportsMarkets({ fetchImpl: f.fetchImpl, now: () => NOW });
  assert.equal(listed[0].id, '123');
  f.market.description = f.market.description.replace('will resolve 50-50', 'will resolve to Jazz');
  await rejectsCode(() => f.load(), 'UNSUPPORTED_CANCELLATION');
  assert.deepEqual(f.calls.map(({ url }) => new URL(url).pathname), ['/markets', '/markets/123']);
});

test('snapshot uses only fixed official GETs and fresh live curve, minimum and tick parameters', async () => {
  const f = fixtures();
  const snapshot = await f.load();
  assert.equal(snapshot.market.version, 'v1');
  assert.equal(snapshot.fee.rate, '0.05');
  assert.equal(snapshot.minOrderSize, '5');
  assert.equal(snapshot.expiresAt, new Date(NOW + 15_000).toISOString());
  assert.equal(f.calls.length, 3);
  for (const { url, options } of f.calls) {
    assert.ok(['https://gamma-api.polymarket.com', 'https://clob.polymarket.com'].includes(new URL(url).origin));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(new URL(f.calls[2].url).searchParams.get('token_id'), '101');
});

test('buy budget includes sports taker fee and target 50bps builder fee, without adding legacy base fees', async () => {
  const snapshot = await fixtures().load();
  const quote = quotePolymarket({ snapshot, side: 'buy', amount: '51.5', now: () => NOW });
  assert.equal(quote.filledShares, '100');
  assert.equal(quote.grossNotional, '50');
  assert.equal(quote.venueFee, '1.25'); // 100 * .05 * .5 * (1-.5)
  assert.equal(quote.pronosFee, '0.25');
  assert.equal(quote.totalSpend, '51.5');
  assert.equal(quote.netProceeds, null);
  assert.equal(quote.status, 'filled');
  assert.equal(quote.coveragePct, 100);
  assert.deepEqual(POLYMARKET_BUILDER_PROFILE, {
    name: 'Pronos', code: '0x64fd36a8de3203124ffd34c4457e139fcf0aedac33fa1b4904dae451900dd30c',
    makerFeeBps: 0, takerFeeBps: 50, feeCollectionVerified: false,
  });
  assert.equal(Object.isFrozen(POLYMARKET_BUILDER_PROFILE), true);
  assert.equal(quote.builderCode, POLYMARKET_BUILDER_PROFILE.code);
  assert.equal(quote.builderFeeBps, 50);
  assert.equal(quote.builderFeeStatus, 'target_unverified');
  assert.equal(quote.executable, false);
  assert.ok(quote.warnings.some((w) => w.startsWith('access_eligibility_unverified:')));
  assert.ok(quote.warnings.some((w) => w.includes('target fee simulation') && w.includes('not a verified effective fee or credited revenue')));
  assert.ok(quote.warnings.some((w) => w.includes('No fee collection or builder credit has been verified.')));
  assert.ok(!Object.hasOwn(quote, 'collectedFee'));
});

test('sell net proceeds subtract both customer fees and retain the gross notional separately', async () => {
  const snapshot = await fixtures().load();
  const quote = quotePolymarket({ snapshot, side: 'sell', amount: '100', now: () => NOW });
  assert.equal(quote.grossNotional, '40');
  assert.equal(quote.venueFee, '1.2');
  assert.equal(quote.pronosFee, '0.2');
  assert.equal(quote.netProceeds, '38.6');
  assert.equal(quote.totalSpend, null);
  assert.equal(quote.filledShares, '100');
});

test('multi-level quotes walk the best prices after validating worst-first API arrays', async () => {
  const f = fixtures();
  f.book.asks = [{ price: '0.6', size: '10' }, { price: '0.5', size: '10' }];
  f.book.bids = [{ price: '0.3', size: '10' }, { price: '0.4', size: '10' }];
  const snapshot = await f.load();
  const buy = quotePolymarket({ snapshot, side: 'buy', amount: '100', now: () => NOW });
  assert.equal(buy.filledShares, '20');
  assert.equal(buy.grossNotional, '11');
  assert.equal(buy.venueFee, '0.245');
  assert.equal(buy.pronosFee, '0.055');
  assert.equal(buy.totalSpend, '11.3');
  assert.equal(buy.remainingAmount, '88.7');
  assert.equal(buy.status, 'partial');
  assert.equal(buy.levelsTouched, 2);
  const sell = quotePolymarket({ snapshot, side: 'sell', amount: '15', now: () => NOW });
  assert.equal(sell.grossNotional, '5.5');
  assert.equal(sell.venueFee, '0.1725');
  assert.equal(sell.pronosFee, '0.0275');
  assert.equal(sell.netProceeds, '5.3');
  assert.equal(sell.status, 'filled');
});

test('cash-capped buy maximizes supported micro-share quantity without exceeding its all-in budget', async () => {
  const snapshot = await fixtures().load();
  const quote = quotePolymarket({ snapshot, side: 'buy', amount: '10', now: () => NOW });
  const micro = (s) => BigInt(s.split('.')[0]) * 1_000_000n + BigInt((s.split('.')[1] || '').padEnd(6, '0'));
  assert.ok(micro(quote.totalSpend) <= 10_000_000n);
  const next = micro(quote.filledShares) + 1n;
  // Independent .5-price closed form: notional=q/2, venue=q/80, builder=notional/200.
  const gross = (next + 1n) / 2n;
  const venue = ((next + 799n) / 800n) * 10n;
  const builder = (gross + 199n) / 200n;
  assert.ok(gross + venue + builder > 10_000_000n);
  assert.equal(quote.status, 'filled');
});

test('partial depth and below-minimum results cannot be represented as executable fills', async () => {
  const snapshot = await fixtures().load();
  const sell = quotePolymarket({ snapshot, side: 'sell', amount: '300', now: () => NOW });
  assert.equal(sell.status, 'partial');
  assert.equal(sell.remainingAmount, '200');
  assert.equal(sell.coveragePct, 33.3333);
  const small = quotePolymarket({ snapshot, side: 'buy', amount: '1', now: () => NOW });
  assert.equal(small.status, 'below_minimum');
  assert.equal(small.executable, false);
  const dust = quotePolymarket({ snapshot, side: 'buy', amount: '0.000001', now: () => NOW });
  assert.equal(dust.filledShares, '0');
  assert.equal(dust.status, 'insufficient_depth');
  assert.equal(dust.totalSpend, '0');
});

test('explicit fee-free markets preserve the extra target builder fee and unsupported curves fail closed', async () => {
  const f = fixtures();
  f.details.fd.r = 0;
  const quote = quotePolymarket({ snapshot: await f.load(), side: 'buy', amount: '50.25', now: () => NOW });
  assert.equal(quote.venueFee, '0');
  assert.equal(quote.pronosFee, '0.25');
  assert.equal(quote.totalSpend, '50.25');
  assert.equal(quote.filledShares, '100');
  for (const fd of [null, { r: .05, e: 2, to: true }, { r: .05, e: 1, to: false }]) {
    f.details.fd = fd;
    await rejectsCode(() => f.load(), 'UNSUPPORTED_FEES');
  }
});

test('five-decimal venue fee rounding is conservative and never described as collected revenue', async () => {
  const f = fixtures();
  f.book.asks[0] = { price: '0.51', size: '5.000001' };
  const quote = quotePolymarket({ snapshot: await f.load(), side: 'buy', amount: '100', now: () => NOW });
  assert.equal(quote.venueFee, '0.06248'); // exact .062475012495, rounded upward to 5 decimals
  assert.equal(quote.roundingPolicy, 'conservative_per_displayed_level');
  assert.ok(quote.warnings.some((w) => w.includes('actual per-fill fees')));
});

test('freshness is bounded by both the exchange timestamp and receipt TTL', async () => {
  const f = fixtures();
  f.book.timestamp = String(NOW - 14_000);
  const snapshot = await f.load();
  assert.equal(snapshot.expiresAt, new Date(NOW + 1000).toISOString());
  quotePolymarket({ snapshot, side: 'sell', amount: '10', now: () => NOW + 999 });
  throwsCode(() => quotePolymarket({ snapshot, side: 'sell', amount: '10', now: () => NOW + 1000 }), 'STALE_QUOTE');
  for (const time of [NOW - 15_001, NOW + 1]) {
    f.book.timestamp = String(time);
    await rejectsCode(() => f.load(), 'STALE_BOOK');
  }
  f.book.timestamp = String(Math.floor(NOW / 1000));
  await rejectsCode(() => f.load(), 'INVALID_BOOK_TIME');
  const forged = { ...snapshot, expiresAt: new Date(NOW + 100_000).toISOString() };
  throwsCode(() => quotePolymarket({ snapshot: forged, side: 'sell', amount: '10', now: () => NOW }), 'STALE_QUOTE');
});

test('slow metadata capture expires rather than extending stale fee assumptions', async () => {
  const f = fixtures();
  let calls = 0;
  await rejectsCode(() => f.load({ now: () => calls++ ? NOW + 15_001 : NOW }), 'STALE_SNAPSHOT');
});

test('condition, token, label mapping, version and trading status are bound across both APIs', async () => {
  for (const mutate of [
    (f) => { f.details.c = OTHER_CONDITION; },
    (f) => { f.details.v = 'v2'; },
    (f) => { f.details.t[1].t = '999'; },
    (f) => { f.details.t.reverse(); [f.details.t[0].o, f.details.t[1].o] = [f.details.t[1].o, f.details.t[0].o]; },
  ]) {
    const f = fixtures(); mutate(f);
    await rejectsCode(() => f.load(), 'MARKET_ID_MISMATCH');
  }
  const notTrading = fixtures(); notTrading.details.ao = false;
  await rejectsCode(() => notTrading.load(), 'MARKET_NOT_TRADING');
  for (const mutate of [
    (f) => { f.book.market = OTHER_CONDITION; }, (f) => { f.book.asset_id = '102'; },
    (f) => { f.book.version = 'v2'; }, (f) => { f.book.neg_risk = true; },
  ]) {
    const f = fixtures(); mutate(f);
    await rejectsCode(() => f.load(), 'BOOK_ID_MISMATCH');
  }
});

test('v2 requires its own position ids, CLOB version and explicit v2 order-book version', async () => {
  const f = fixtures();
  f.market.version = 'v2'; f.details.v = 'v2';
  f.details.t[0].t = '201'; f.details.t[1].t = '202'; f.book.asset_id = '201';
  await rejectsCode(() => f.load(), 'BOOK_ID_MISMATCH');
  f.book.version = 'v2';
  const snapshot = await f.load();
  assert.equal(snapshot.tokenId, '201');
  assert.equal(quotePolymarket({ snapshot, side: 'buy', amount: '10', now: () => NOW }).marketId, '123');
});

test('book parameters, crossed books, malformed prices/sizes and excessive depth are rejected', async () => {
  for (const mutate of [
    (f) => { f.book.tick_size = '0.001'; }, (f) => { f.book.min_order_size = '6'; },
  ]) {
    const f = fixtures(); mutate(f);
    await rejectsCode(() => f.load(), 'BOOK_PARAMETERS_CHANGED');
  }
  for (const level of [
    { price: 'NaN', size: '10' }, { price: '0', size: '10' }, { price: '1', size: '10' },
    { price: '0.5', size: 'Infinity' }, { price: '0.5', size: '-1' }, { price: '0.5', size: '1e9' },
    { price: '0.5', size: '0' }, { price: '0.5', size: '0.0000001' },
  ]) {
    const f = fixtures(); f.book.asks = [level];
    await rejectsCode(() => f.load(), 'INVALID_DECIMAL');
  }
  for (const levels of [[], Array.from({ length: 1001 }, () => ({ price: '0.5', size: '10' })),
    [{ price: '0.501', size: '10' }], [{ price: '0.5', size: '10' }, { price: '0.5', size: '20' }]]) {
    const f = fixtures(); f.book.asks = levels;
    await rejectsCode(() => f.load(), 'INVALID_DEPTH');
  }
  const crossed = fixtures(); crossed.book.bids[0].price = '0.5';
  await rejectsCode(() => crossed.load(), 'CROSSED_BOOK');
});

test('malformed/capped user inputs cannot become floating-point financial amounts or remote URLs', async () => {
  const f = fixtures();
  const snapshot = await f.load();
  for (const amount of ['NaN', 'Infinity', '-1', '1e3', '01', '0', '0.0000001', '1000000.000001', {}, null]) {
    throwsCode(() => quotePolymarket({ snapshot, side: 'buy', amount, now: () => NOW }), 'INVALID_DECIMAL');
  }
  await rejectsCode(() => f.load({ marketId: 'https://attacker.invalid/123' }), 'INVALID_MARKET');
  await rejectsCode(() => f.load({ outcomeIndex: 2 }), 'INVALID_OUTCOME');
  assert.equal(f.calls.length, 3);
  throwsCode(() => quotePolymarket({ snapshot, side: 'hold', amount: '10', now: () => NOW }), 'INVALID_SIDE');
  const corrupted = clone(snapshot); corrupted.tokenId = '102';
  throwsCode(() => quotePolymarket({ snapshot: corrupted, side: 'buy', amount: '10', now: () => NOW }), 'BOOK_ID_MISMATCH');
});

test('transport failure, oversized response and malformed JSON are explicit upstream errors', async () => {
  await rejectsCode(() => discoverSportsMarkets({ fetchImpl: async () => ({ ok: false, status: 429 }) }), 'UPSTREAM_UNAVAILABLE');
  await rejectsCode(() => discoverSportsMarkets({ fetchImpl: async () => { throw new Error('network'); } }), 'UPSTREAM_UNAVAILABLE');
  await rejectsCode(() => discoverSportsMarkets({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('json'); } }) }), 'UPSTREAM_MALFORMED');
  await rejectsCode(() => discoverSportsMarkets({ fetchImpl: async () => ({ ok: true, headers: { get: () => '1048577' }, json: async () => [] }) }), 'UPSTREAM_TOO_LARGE');
  await rejectsCode(() => discoverSportsMarkets({ fetchImpl: async () => new Response(' '.repeat(1_048_577)) }), 'UPSTREAM_TOO_LARGE');
});

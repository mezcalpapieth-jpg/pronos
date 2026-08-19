import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateStockMarkets, nextFridayStockCloseUtc } from './stocks.js';
import { STOCKS } from '../stockprice.js';

const source = await readFile(new URL('./stocks.js', import.meta.url), 'utf8');

test('stock markets close on Friday at the US equity cutoff, not Sunday', () => {
  assert.match(source, /nextFridayStockCloseUtc/);
  assert.match(source, /America\/New_York/);
  assert.match(source, /hour:\s*15/);
  assert.match(source, /minute:\s*59/);
  assert.match(source, /formatMexicoDateYmd\(end\)/);
  assert.match(source, /formatMexicoDateEs\(end\)/);
  assert.doesNotMatch(source, /nextSundayEndUtc/);
});

test('stock market cutoff resolves to Friday 3:59 p.m. New York time', () => {
  const cutoff = nextFridayStockCloseUtc(new Date('2026-08-13T16:00:00.000Z'));
  assert.equal(cutoff.toISOString(), '2026-08-14T19:59:00.000Z');
});

test('stock generator includes SpaceX with the public SPCX ticker', async () => {
  const previousKey = process.env.FINNHUB_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FINNHUB_API_KEY = 'test-key';
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    const symbol = parsed.searchParams.get('symbol');
    assert.ok(STOCKS[symbol], `unexpected symbol ${symbol}`);
    return {
      ok: true,
      async json() {
        return { c: symbol === 'SPCX' ? 142.42 : 100, pc: 99, o: 100, h: 101, l: 98, t: 1787025600 };
      },
    };
  };

  try {
    const specs = await generateStockMarkets();
    const spacex = specs.find(spec => spec.resolver_config?.symbol === 'SPCX');
    assert.ok(spacex, 'SpaceX market was not generated');
    assert.equal(spacex.category, 'finanzas');
    assert.equal(spacex.resolver_type, 'api_price');
    assert.equal(spacex.resolver_config.source, 'finnhub');
    assert.equal(spacex.resolver_config.op, 'gt');
    assert.equal(spacex.source_data.label, 'SpaceX');
    assert.equal(spacex.source_data.symbol, 'SPCX');
    assert.match(spacex.source_event_id, /^stocks:SPCX:/);
    assert.match(spacex.question, /SpaceX cerrará por encima/);
  } finally {
    if (previousKey == null) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});

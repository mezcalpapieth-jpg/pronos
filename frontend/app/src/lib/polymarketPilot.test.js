import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPolymarketPilot, createPolymarketQuoteSession, polymarketQuoteExpired,
  polymarketErrorMessage, polymarketTimestamp, polymarketWarningMessage,
  validatePolymarketQuote,
} from './polymarketPilot.js';

const input = { marketId: '12345', outcomeIndex: 0, side: 'buy', amount: '10.000000' };

test('validates identifiers and plain positive decimal budget or share quantity', () => {
  assert.deepEqual(validatePolymarketQuote(input), { ...input, amount: '10' });
  assert.deepEqual(validatePolymarketQuote({ ...input, outcomeIndex: '1', side: 'sell', amount: '0.000001' }),
    { ...input, outcomeIndex: 1, side: 'sell', amount: '0.000001' });
  for (const amount of ['0', '-1', '1e3', 'Infinity', '1.0000001', '1000001', '1,000', '']) {
    assert.throws(() => validatePolymarketQuote({ ...input, amount }));
  }
  for (const changed of [{ marketId: 'a?b=1' }, { marketId: '0123' }, { marketId: '1234567890123456789' },
    { outcomeIndex: 2 }, { outcomeIndex: '' },
    { outcomeIndex: null }, { side: 'order' }]) {
    assert.throws(() => validatePolymarketQuote({ ...input, ...changed }));
  }
});

test('only requests public market and quote endpoints with GET and no body', async () => {
  const calls = [];
  const client = createPolymarketPilot({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => url.includes('action=markets')
        ? { ok: true, markets: [{ id: '12345' }] } : { ok: true, quote: { expiresAt: 100 } } };
    },
  });
  await client.getMarkets();
  await client.getQuote(input);
  assert.equal(calls[0].url, '/api/polymarket-pilot?action=markets');
  assert.match(calls[1].url, /action=quote&marketId=12345&outcomeIndex=0&side=buy&amount=10$/);
  assert.ok(calls.every(({ options }) => options.method === 'GET' && options.body === undefined));
  assert.deepEqual(Object.keys(client).sort(), ['getMarkets', 'getQuote']);
});

test('structured provider failures and invalid payloads do not become empty success', async () => {
  const client = body => createPolymarketPilot({ fetchImpl: async () => ({
    ok: true, status: 200, json: async () => body,
  }) });
  await assert.rejects(client({ ok: false, error: { message: 'Book unavailable' } }).getMarkets(), /Book unavailable/);
  await assert.rejects(client({ markets: Array(6).fill({}) }).getMarkets(), /formato/);
  await assert.rejects(client({ quote: null }).getQuote(input), /formato/);
  const malformed = createPolymarketPilot({ fetchImpl: async () => ({ ok: true, json: async () => {
    throw new SyntaxError('HTML response');
  } }) });
  await assert.rejects(malformed.getMarkets(), /respuesta válida/);
});

test('cancellation reaches the transport and cancelled requests never publish results', async () => {
  const controller = new AbortController();
  const client = createPolymarketPilot({ fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
  }) });
  const waiting = client.getMarkets({ signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  let called = false;
  const never = createPolymarketPilot({ fetchImpl: async () => { called = true; } });
  await assert.rejects(never.getMarkets({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(called, false);
});

test('latest quote wins even when old transport ignores cancellation', async () => {
  const pending = [];
  const session = createPolymarketQuoteSession({ getQuote: (_input, { signal }) => new Promise(resolve => {
    pending.push({ resolve, signal });
  }) });
  const first = session.getQuote(input);
  const second = session.getQuote({ ...input, amount: '20' });
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ quote: { amount: '20' } });
  assert.deepEqual(await second, { quote: { amount: '20' } });
  pending[0].resolve({ quote: { amount: '10' } });
  await assert.rejects(first, { name: 'AbortError' });
});

test('editing input cancels an in-flight quote and expiry includes the exact boundary', async () => {
  let resolve;
  const session = createPolymarketQuoteSession({ getQuote: () => new Promise(done => { resolve = done; }) });
  const waiting = session.getQuote(input);
  session.cancel();
  resolve({ quote: { expiresAt: 200 } });
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(polymarketQuoteExpired({ expiresAt: 200 }, 199), false);
  assert.equal(polymarketQuoteExpired({ expiresAt: 200 }, 200), true);
  assert.equal(polymarketQuoteExpired({}, 199), true);
});

test('real provider ISO timestamps expire at the exact boundary', () => {
  const expiresAt = '2026-11-11T02:00:15.000Z';
  const epoch = Date.parse(expiresAt);
  assert.equal(polymarketTimestamp(expiresAt), epoch);
  assert.equal(polymarketQuoteExpired({ expiresAt }, epoch - 1), false);
  assert.equal(polymarketQuoteExpired({ expiresAt }, epoch), true);
  assert.equal(polymarketTimestamp(String(epoch)), epoch);
  assert.equal(polymarketQuoteExpired({ expiresAt: 'invalid' }, epoch), true);
});

test('provider conditions display useful messages without implying trading eligibility', () => {
  assert.match(polymarketErrorMessage('stale_book', 409), /desactualizado/);
  assert.match(polymarketErrorMessage({ code: 'UNSUPPORTED_FEES' }, 409), /comisiones/);
  assert.match(polymarketErrorMessage('new_provider_condition', 400), /Referencia/);
  assert.match(polymarketWarningMessage('access_eligibility_unverified: restricted=true'), /no confirma tu elegibilidad/);
  assert.match(polymarketWarningMessage('Indicative read-only simulation; displayed liquidity and actual per-fill fees can change before execution.'), /No garantiza una ejecución/);
  assert.match(polymarketWarningMessage('Displayed depth does not cover the requested amount.'), /cobertura/);
});

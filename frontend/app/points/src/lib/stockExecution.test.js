import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStockOrder, stockTradeNeedsRetry } from './stockExecution.js';

for (const side of ['buy', 'sell']) {
  test(`one ${side} action fetches a fresh quote and executes the quoted order`, async () => {
    const request = { ticker: 'BTC', side, quantity: '0.00013' };
    const calls = [];
    const result = { ok: true, quantity: request.quantity, balance: '201.46' };
    const quote = { quoteId: 'quote-1', quantity: request.quantity, total: '197.85' };
    assert.equal(await executeStockOrder({ request,
      quoteStock: async body => { calls.push(['quote', body]); return quote; },
      onQuote: (value, attempt) => calls.push(['ready', value, attempt]),
      tradeStock: async (value, body) => { calls.push(['trade', value, body]); return result; },
      createIdempotencyKey: () => 'attempt-1',
    }), result);
    const attempt = { quoteId: 'quote-1', idempotencyKey: 'attempt-1' };
    assert.deepEqual(calls, [['quote', request], ['ready', quote, attempt], ['trade', side, attempt]]);
  });
}

test('a failed quote never executes or creates an uncertain purchase', async () => {
  const error = Object.assign(new Error('unavailable'), { status: 503 });
  let pendingAttempt = null;
  await assert.rejects(executeStockOrder({ request: { ticker: 'AAPL', side: 'buy', amount: '100' },
    quoteStock: async () => { throw error; },
    onQuote: (_, attempt) => { pendingAttempt = attempt; },
    tradeStock: () => assert.fail('Failed quotes cannot execute'),
  }), error);
  assert.equal(stockTradeNeedsRetry(error, pendingAttempt), false);
});

test('leaving the instrument while fetching its quote cancels execution', async () => {
  let current = true;
  assert.equal(await executeStockOrder({ request: { ticker: 'AAPL', side: 'buy', amount: '100' },
    quoteStock: async () => { current = false; return { quoteId: 'unused' }; },
    isCurrent: () => current,
    onQuote: () => assert.fail('An abandoned quote cannot update the new screen'),
    tradeStock: () => assert.fail('An abandoned screen cannot execute'),
  }), null);
});

test('a lost execution response retries the same identity without quoting or buying twice', async () => {
  let pendingAttempt = null;
  let quoteCalls = 0;
  let fills = 0;
  const committed = new Map();
  const request = { ticker: 'BTC', side: 'buy', amount: '100' };
  const result = { ok: true, tradeId: 'trade-1', balance: '300' };
  const quoteStock = async () => { quoteCalls++; return { quoteId: 'quote-1', expiresAt: 1 }; };
  const tradeStock = async (_, attempt) => {
    if (committed.has(attempt.idempotencyKey)) return { ...committed.get(attempt.idempotencyKey), replayed: true };
    fills++;
    committed.set(attempt.idempotencyKey, result);
    throw new TypeError('Response lost after commit');
  };
  const options = { request, quoteStock, tradeStock,
    onQuote: (_, attempt) => { pendingAttempt = attempt; }, createIdempotencyKey: () => 'attempt-1' };
  await assert.rejects(executeStockOrder(options), error => stockTradeNeedsRetry(error, pendingAttempt));
  assert.deepEqual(pendingAttempt, { quoteId: 'quote-1', idempotencyKey: 'attempt-1' });
  assert.deepEqual(await executeStockOrder({ ...options, pendingAttempt,
    createIdempotencyKey: () => assert.fail('Retries must retain their identity'),
  }), { ...result, replayed: true });
  assert.equal(quoteCalls, 1);
  assert.equal(fills, 1);
});

test('only ambiguous execution failures need to retain the original attempt', () => {
  const attempt = { quoteId: 'quote-1', idempotencyKey: 'attempt-1' };
  for (const status of [400, 401, 409, 429]) assert.equal(stockTradeNeedsRetry({ status }, attempt), false);
  for (const status of [500, 502, 503]) assert.equal(stockTradeNeedsRetry({ status }, attempt), true);
  assert.equal(stockTradeNeedsRetry(new Error('timeout'), attempt), true);
  assert.equal(stockTradeNeedsRetry({ status: 503 }, null), false);
});

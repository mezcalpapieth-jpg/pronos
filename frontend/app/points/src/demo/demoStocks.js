// Explicit demo only. These prices never reach a production stock endpoint.
import { STOCK_ASSETS, STOCK_CHART_RANGES } from '../../../../api/_lib/stock-assets.js';
import { applyStockFill, buildStockFill, fixed, decimal, stockPositionValue } from '../../../../api/_lib/stock-math.js';
import { getDemoState, updateDemoState } from './demoStore.js';

const PRICES = [336.3, 231.18, 383.41, 352.15, 716.93, 263.07, 534.56, 6812.5, 4128.6];
const quotes = new Map();
const results = new Map();
const response = (body, status = 200) => ({ body, status });
function market() {
  const fx = { rate: '18.3', date: new Date().toISOString().slice(0, 10), source: 'DEMO · synthetic FX' };
  return { demo: true, fx, fetchedAt: Date.now(), source: 'DEMO · synthetic prices', stale: false,
    assets: STOCK_ASSETS.map((asset, i) => ({ ...asset, available: true, szDecimals: asset.ticker === 'GOLD' ? 4 : 3,
      priceUsd: String(PRICES[i]), priceMxn: PRICES[i] * Number(fx.rate), change24h: [0.14, 0.41, 0.25, -0.25, 0.39, 0.32, 0.08, 0.18, 0.25][i] })) };
}
function book(ticker) {
  const data = market();
  const asset = data.assets.find(item => item.ticker === ticker);
  if (!asset) throw Object.assign(new Error('stock_not_found'), { status: 404 });
  const price = Number(asset.priceUsd);
  return { ticker, szDecimals: asset.szDecimals, fx: data.fx, markPriceUsd: asset.priceUsd,
    bookTime: Date.now(), fetchedAt: Date.now(),
    levels: [[{ px: (price - 0.05).toFixed(2), sz: '10000' }], [{ px: price.toFixed(2), sz: '10000' }]] };
}
function portfolio(scope) {
  const state = getDemoState();
  const data = market();
  let value = 0;
  let basis = 0;
  let realized = 0;
  const positions = Object.entries(scope === 'previous' ? {} : state.stockPositions || {}).flatMap(([ticker, p]) => {
    const asset = data.assets.find(item => item.ticker === ticker);
    const currentValue = stockPositionValue(p.quantity, asset.priceUsd, data.fx.rate);
    value += Number(currentValue); basis += Number(p.cost_basis); realized += Number(p.realized_pnl);
    return Number(p.quantity) > 0 ? [{ ...asset, ...p, costBasis: p.cost_basis, currentValue,
      unrealizedPnl: Number(currentValue) - Number(p.cost_basis), realizedPnl: p.realized_pnl, archived: false, stale: false }] : [];
  });
  return { positions, trades: scope === 'previous' ? [] : state.stockTrades || [],
    series: scope === 'previous' ? [] : state.stockSeries || [], cycle: { id: 1, label: 'Demo', scope },
    summary: { currentValue: value, costBasis: basis, realizedPnl: realized, unrealizedPnl: value - basis, pnl: value - basis + realized } };
}

export function routeDemoStocks(path, method, params, body = {}) {
  try {
    const action = path.split('/').at(-1);
    if (method === 'GET' && action === 'assets') {
      const result = market();
      if (params.get('ticker')) result.book = book(params.get('ticker'));
      return response(result);
    }
    if (method === 'GET' && action === 'candles') {
      const asset = market().assets.find(item => item.ticker === params.get('ticker'));
      const range = params.get('range') || '7D';
      if (!asset) return response({ error: 'stock_not_found' }, 404);
      const duration = STOCK_CHART_RANGES[range]?.durationMs || 86400000;
      const count = range === 'SPARK' ? 24 : 100;
      const end = Date.now();
      const candles = Array.from({ length: count }, (_, i) => ({ t: end - duration + i / (count - 1) * duration,
        close: Number(asset.priceUsd) * (1 + Math.sin(i * 0.45 + asset.order) * 0.006 + Math.cos(i * 0.12) * 0.008 + (i / count - 1) * 0.01) }));
      return response({ ticker: asset.ticker, candles, range, demo: true, currency: 'USD' });
    }
    if (method === 'GET' && action === 'positions') return response(portfolio(params.get('cycle') || 'current'));
    const state = getDemoState();
    if (method === 'POST' && action === 'quote') {
      const data = book(body.ticker);
      const fill = buildStockFill({ ...body, positionQuantity: state.stockPositions?.[body.ticker]?.quantity || '0', quote: data });
      const result = { quoteId: crypto.randomUUID(), ticker: body.ticker, ...fill, expiresAt: Date.now() + 10000, bookTime: data.bookTime };
      quotes.set(result.quoteId, { ...result, book: data });
      return response(result);
    }
    if (method === 'POST' && ['buy', 'sell'].includes(action)) {
      const prior = results.get(body.idempotencyKey);
      if (prior) return prior.quoteId === body.quoteId && prior.side === action ? response({ ...prior.result, replayed: true }) : response({ error: 'idempotency_conflict' }, 409);
      const quote = quotes.get(body.quoteId);
      if (!quote || quote.side !== action) return response({ error: 'invalid_quote' }, 400);
      if (quote.used) return response({ error: 'stock_quote_used' }, 409);
      if (Date.now() >= quote.expiresAt) return response({ error: 'stock_quote_expired' }, 409);
      const updated = applyStockFill(state.stockPositions?.[quote.ticker], quote);
      const balance = fixed(Number(state.user.balance).toFixed(6)) + (action === 'buy' ? -fixed(quote.total) : fixed(quote.total));
      if (balance < 0n) return response({ error: 'insufficient_balance' }, 400);
      const tradeId = Date.now();
      updateDemoState(s => {
        s.user.balance = Number(decimal(balance));
        s.stockPositions ||= {};
        s.stockPositions[quote.ticker] = { quantity: updated.quantity, cost_basis: updated.costBasis, realized_pnl: updated.realizedPnl };
        s.stockTrades ||= [];
        s.stockTrades.unshift({ id: tradeId, ticker: quote.ticker, side: action, quantity: quote.quantity,
          total: quote.total, fee: quote.fee, created_at: new Date().toISOString() });
        s.stockSeries ||= [{ t: Math.floor(Date.now() / 1000) - 1, v: 0 }];
      });
      const snapshot = portfolio('current');
      updateDemoState(s => s.stockSeries.push({ t: Math.floor(Date.now() / 1000), v: snapshot.summary.pnl }));
      quote.used = true;
      const result = { ok: true, tradeId, ticker: quote.ticker, side: action, quantity: quote.quantity, total: quote.total, balance: decimal(balance) };
      results.set(body.idempotencyKey, { quoteId: body.quoteId, side: action, result });
      return response(result);
    }
    return response({ error: 'method_not_allowed' }, 405);
  } catch (error) { return response({ error: error.code || error.message }, error.status || 400); }
}

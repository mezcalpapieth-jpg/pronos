import { neon } from '@neondatabase/serverless';
import { applyCors } from './cors.js';
import { requireSession } from './session.js';
import { rateLimit, clientIp } from './rate-limit.js';
import { ensurePointsSchema } from './points-schema.js';
import { withTransaction } from './db-tx.js';
import { ensureStockSchema } from './stock-schema.js';
import { createStockData } from './stock-data.js';
import { createStockQuote, executeStockTrade, stockOrderRequest } from './stock-trading.js';
import { readStockPortfolio } from './stock-portfolio.js';
import { readStockCycle, readStockCyclePhase, stockTradingIsPaused } from './stock-cycle.js';
import { capturePointsRiskEvent } from './points-risk.js';

let sql;
let data;
export function stockHandler(action) {
  const method = ['quote', 'buy', 'sell'].includes(action) ? 'POST' : 'GET';
  return async (req, res) => {
    if (applyCors(req, res, { methods: `${method}, OPTIONS`, credentials: true })) return;
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== method) return res.status(405).json({ error: 'method_not_allowed' });
    if (process.env.POINTS_STOCKS_ENABLED !== 'true') return res.status(404).json({ error: 'stocks_disabled' });
    if (method === 'POST' && process.env.POINTS_STOCKS_TRADING_ENABLED === 'false') return res.status(503).json({ error: 'stock_trading_paused' });
    if (rateLimit(req, res, { key: `stocks:${action}:${clientIp(req)}`, limit: method === 'POST' ? 30 : 120, windowMs: 60000 })) return;
    const privateRoute = !['assets', 'candles', 'health'].includes(action);
    const session = privateRoute ? requireSession(req, res) : null;
    if (privateRoute && !session) return;
    if (privateRoute && !session.username) return res.status(400).json({ error: 'username_required' });
    try {
      sql ||= neon(process.env.DATABASE_URL);
      data ||= createStockData(sql);
      await ensurePointsSchema(sql);
      await ensureStockSchema(withTransaction);
      let result;
      if (action === 'assets' || action === 'health') {
        const [market, book, phase, paused] = await Promise.all([
          data.assets(false, action === 'assets' ? req.query.ticker : undefined),
          action === 'assets' && req.query.ticker ? data.book(req.query.ticker) : null,
          readStockCycle(sql).then(cycle => readStockCyclePhase(sql, cycle, Date.now())),
          stockTradingIsPaused(sql),
        ]);
        const tradingEnabled = process.env.POINTS_STOCKS_TRADING_ENABLED !== 'false'
          && Boolean(phase) && !paused;
        if (action === 'assets') {
          result = { ...market, ...(book ? { book } : {}), tradingEnabled, tradingPhase: phase };
        } else {
          const availableAssets = market.assets.filter(asset => asset.available).length;
          result = { ok: true, schemaVersion: 3, tradingEnabled, tradingPhase: phase, source: market.source,
            fetchedAt: market.fetchedAt, fxDate: market.fx.date, availableAssets, tradableAssets: availableAssets };
        }
      } else if (action === 'candles') result = await data.candles(req.query.ticker, req.query.range || '7D');
      else if (action === 'quote') {
        const request = stockOrderRequest(req.body);
        // A confirmation quote needs the newest book, rather than spending
        // part of its ten-second lifetime on the indicative UI cache.
        const book = await data.book(request.ticker, { fresh: true });
        result = await withTransaction(db => createStockQuote(db, { username: session.username, request, book }));
      } else if (action === 'positions') {
        const scope = req.query.cycle === 'previous' ? 'previous' : 'current';
        const market = scope === 'current' ? await data.assets(true).catch(() => null) : null;
        result = await withTransaction(db => readStockPortfolio(db, { username: session.username, scope, market,
          includeHistory: req.query.view !== 'holdings' }));
      } else result = await withTransaction(db => executeStockTrade(db, {
        username: session.username, side: action, quoteId: req.body?.quoteId, idempotencyKey: req.body?.idempotencyKey,
      }));
      if (['buy', 'sell'].includes(action) && !result.replayed) {
        await capturePointsRiskEvent(sql, req, {
          res, username: session.username, accountId: session.sub,
          eventType: `trade:stock_${action}`, tradeSide: action, amount: result.total,
          metadata: { ticker: result.ticker, stockTradeId: result.tradeId, quantity: result.quantity },
        });
      }
      return res.status(200).json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.code || error.message });
      console.error(`[points/stocks/${action}] failed`, { message: error.message, code: error.code });
      return res.status(500).json({ error: 'stock_request_failed' });
    }
  };
}

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { rateLimit } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { capturePointsRiskEvent } from '../_lib/points-risk.js';
import {
  authenticatePointsApiRequest,
  createApiRequestId,
  headerValue,
  PUBLIC_API_HEADERS,
  readRawRequestBody,
  recordApiRequest,
  sendApiError,
  stableApiRequestHash,
} from '../_lib/points-api-auth.js';
import { parseJsonb, roundNumber } from '../_lib/points-public-api.js';
import { executePointsBuy, executePointsSell } from '../_lib/points-trading-service.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

let _readSql = null;
let _schemaSql = null;
function getReadSql() {
  if (_readSql) return _readSql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _readSql = neon(cs);
  return _readSql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function apiError(code, status = 400, message = code) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normalizeLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(n, 200);
}

function normalizeMarketId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeSide(value) {
  const side = String(value || '').trim().toLowerCase();
  if (['buy', 'compra'].includes(side)) return 'buy';
  if (['sell', 'venta'].includes(side)) return 'sell';
  return null;
}

function normalizeOutcomeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function resolveOutcomeIndex(client, { marketId, outcomeIndex, outcome }) {
  const index = Number.parseInt(outcomeIndex, 10);
  if (Number.isInteger(index) && index >= 0) return index;

  const label = normalizeOutcomeText(outcome);
  if (!label) throw apiError('invalid_outcome', 400, 'Provide outcomeIndex or outcome.');

  const marketResult = await client.query(
    `SELECT outcomes FROM points_markets WHERE id = $1 LIMIT 1`,
    [marketId],
  );
  const outcomes = parseJsonb(marketResult.rows[0]?.outcomes, []);
  const normalized = outcomes.map(normalizeOutcomeText);
  const yesNo = label === 'yes' || label === 'si' ? 0 : label === 'no' ? 1 : -1;
  if (yesNo >= 0 && outcomes.length === 2) return yesNo;
  const matched = normalized.findIndex(item => item === label);
  if (matched >= 0) return matched;
  throw apiError('invalid_outcome', 400, 'Outcome does not match this market.');
}

function parseStoredJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeTradeRow(row) {
  const outcomes = parseJsonb(row.outcomes, []);
  const outcomeIndex = Number(row.outcome_index);
  return {
    id: Number(row.id),
    tradeId: String(row.id),
    marketId: String(row.market_id),
    question: row.question || null,
    side: String(row.side || '').toUpperCase(),
    outcomeIndex,
    outcome: outcomes[outcomeIndex] || null,
    shares: roundNumber(row.shares, 6),
    collateral: roundNumber(row.collateral, 2),
    fee: roundNumber(row.fee, 2),
    price: roundNumber(row.price_at_trade, 6),
    source: row.source || 'web',
    createdAt: row.created_at,
  };
}

async function listTrades(req, res, { auth, requestId, schemaSql }) {
  const marketId = normalizeMarketId(req.query?.marketId);
  const limit = normalizeLimit(req.query?.limit);
  const rows = await getReadSql()`
    SELECT
      t.id, t.market_id, t.side, t.outcome_index, t.shares, t.collateral,
      t.fee, t.price_at_trade, t.source, t.created_at,
      m.question, m.outcomes
    FROM points_trades t
    JOIN points_markets m ON m.id = t.market_id
   WHERE t.username = ${auth.username}
     AND COALESCE(m.mode, 'points') = 'points'
     AND (${marketId}::integer IS NULL OR t.market_id = ${marketId}::integer)
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT ${limit}
  `;
  await recordApiRequest(schemaSql, {
    requestId,
    apiKeyId: auth.apiKeyId,
    username: auth.username,
    method: req.method,
    endpoint: '/api/v1/trades',
    result: 'ok',
    statusCode: 200,
    req,
    metadata: { marketId, limit },
  });
  return res.status(200).json({
    trades: rows.map(serializeTradeRow),
    requestId,
  });
}

function idempotencyKey(req) {
  const value = String(headerValue(req, 'idempotency-key') || '').trim();
  if (!value || value.length < 8 || value.length > 128) return null;
  return value;
}

function publicTradeResponse({ side, marketId, outcomeIndex, amount, result, requestId }) {
  if (side === 'buy') {
    const sharesReceived = Number(result.sharesOut || 0);
    const amountSpent = Number(amount || 0);
    return {
      trade: {
        marketId: String(marketId),
        side: 'BUY',
        outcomeIndex,
        amountSpent: roundNumber(amountSpent, 2),
        sharesReceived: roundNumber(sharesReceived, 6),
        fee: roundNumber(result.fee || 0, 2),
        averagePrice: sharesReceived > 0 ? roundNumber(amountSpent / sharesReceived, 6) : 0,
        priceBefore: roundNumber(result.priceBefore, 6),
        priceAfter: roundNumber(result.priceAfter, 6),
        status: 'FILLED',
      },
      balance: roundNumber(result.balance, 2),
      execution: {
        orderbookFillCount: Array.isArray(result.orderbookFills) ? result.orderbookFills.length : 0,
        triggeredLimitOrderCount: Array.isArray(result.triggeredLimitOrders) ? result.triggeredLimitOrders.length : 0,
      },
      requestId,
    };
  }

  const sharesSold = Number(result.sharesSold || 0);
  const collateralOut = Number(result.collateralOut || 0);
  return {
    trade: {
      marketId: String(marketId),
      side: 'SELL',
      outcomeIndex,
      collateralReceived: roundNumber(collateralOut, 2),
      sharesSold: roundNumber(sharesSold, 6),
      averagePrice: sharesSold > 0 ? roundNumber(collateralOut / sharesSold, 6) : 0,
      realizedPnl: roundNumber(result.realizedPnl || 0, 2),
      priceBefore: roundNumber(result.priceBefore, 6),
      priceAfter: roundNumber(result.priceAfter, 6),
      status: 'FILLED',
    },
    balance: roundNumber(result.balance, 2),
    execution: {
      orderbookFillCount: Array.isArray(result.orderbookFills) ? result.orderbookFills.length : 0,
      triggeredLimitOrderCount: Array.isArray(result.triggeredLimitOrders) ? result.triggeredLimitOrders.length : 0,
    },
    requestId,
  };
}

async function executeIdempotentTrade(req, { auth, requestId }) {
  const key = idempotencyKey(req);
  if (!key) {
    throw apiError('missing_idempotency_key', 400, 'Trading requests require Idempotency-Key.');
  }
  const requestHash = stableApiRequestHash(req);
  const body = req.body || {};
  const side = normalizeSide(body.side);
  const marketId = normalizeMarketId(body.marketId || body.market_id);
  if (!side) throw apiError('invalid_side', 400, 'side must be BUY or SELL.');
  if (!marketId) throw apiError('invalid_market_id', 400, 'marketId must be a positive integer.');

  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT request_hash, status_code, response_body
         FROM points_api_idempotency_keys
        WHERE api_key_id = $1
          AND idempotency_key = $2
        FOR UPDATE`,
      [auth.apiKeyId, key],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw apiError('idempotency_conflict', 409, 'Idempotency-Key was already used with a different request.');
      }
      const stored = parseStoredJson(existing.rows[0].response_body, null);
      if (stored) {
        return {
          statusCode: Number(existing.rows[0].status_code || 200),
          body: { ...stored, idempotentReplay: true },
          replay: true,
        };
      }
    } else {
      await client.query(
        `INSERT INTO points_api_idempotency_keys (
           api_key_id, idempotency_key, request_hash, expires_at
         ) VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
        [auth.apiKeyId, key, requestHash],
      );
    }

    const outcomeIndex = await resolveOutcomeIndex(client, {
      marketId,
      outcomeIndex: body.outcomeIndex ?? body.outcome_index,
      outcome: body.outcome,
    });

    let result;
    let responseBody;
    if (side === 'buy') {
      const amount = Number(body.amount ?? body.collateral);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw apiError('invalid_amount', 400, 'amount must be greater than zero.');
      }
      result = await executePointsBuy(client, {
        username: auth.username,
        marketId,
        outcomeIndex,
        collateral: amount,
        minSharesOut: body.minSharesOut ?? body.min_shares_out,
        maxAvgPrice: body.maxPrice ?? body.maxAvgPrice ?? body.max_avg_price,
        source: 'api',
        apiKeyId: auth.apiKeyId,
      });
      responseBody = publicTradeResponse({ side, marketId, outcomeIndex, amount, result, requestId });
    } else {
      const shares = Number(body.shares);
      if (!Number.isFinite(shares) || shares <= 0) {
        throw apiError('invalid_shares', 400, 'shares must be greater than zero.');
      }
      result = await executePointsSell(client, {
        username: auth.username,
        marketId,
        outcomeIndex,
        shares,
        minCollateralOut: body.minCollateralOut ?? body.min_collateral_out,
        source: 'api',
        apiKeyId: auth.apiKeyId,
      });
      responseBody = publicTradeResponse({ side, marketId, outcomeIndex, result, requestId });
    }

    await client.query(
      `UPDATE points_api_idempotency_keys
          SET status_code = 200,
              response_body = $3::jsonb
        WHERE api_key_id = $1
          AND idempotency_key = $2`,
      [auth.apiKeyId, key, JSON.stringify(responseBody)],
    );

    return {
      statusCode: 200,
      body: responseBody,
      replay: false,
      tradeMeta: { side, marketId, outcomeIndex, result },
    };
  });
}

export default async function handler(req, res) {
  const requestId = createApiRequestId();
  const cors = applyCors(req, res, {
    methods: 'GET, POST, OPTIONS',
    headers: PUBLIC_API_HEADERS,
    credentials: false,
    enforceSameOriginForStateChanging: false,
  });
  if (cors) return cors;
  if (!['GET', 'POST'].includes(req.method)) {
    return sendApiError(res, 405, 'method_not_allowed', 'Only GET and POST are supported.', requestId);
  }

  let auth = null;
  try {
    const schemaSql = getSchemaSql();
    await ensurePointsSchema(schemaSql);
    if (req.method === 'POST') {
      await readRawRequestBody(req);
    }
    auth = await authenticatePointsApiRequest(schemaSql, req, {
      requiredPermission: req.method === 'POST' ? 'TRADE' : 'READ',
      requestId,
    });

    const limited = rateLimit(req, res, {
      key: req.method === 'POST' ? `public-api-trade:${auth.apiKeyId}` : `public-api-read:${auth.apiKeyId}`,
      limit: req.method === 'POST' ? 60 : 120,
      windowMs: 60_000,
      structuredError: true,
      requestId,
    });
    if (limited) return;

    if (req.method === 'GET') {
      return listTrades(req, res, { auth, requestId, schemaSql });
    }

    const executed = await executeIdempotentTrade(req, { auth, requestId });
    if (!executed.replay && executed.tradeMeta) {
      const { side, marketId, outcomeIndex, result } = executed.tradeMeta;
      await capturePointsRiskEvent(schemaSql, req, {
        username: auth.username,
        accountId: auth.userSub,
        eventType: `trade:${side}`,
        marketId,
        tradeSide: side,
        outcomeIndex,
        amount: side === 'buy' ? Number(req.body?.amount ?? req.body?.collateral) : result.collateralOut,
        shares: side === 'buy' ? result.sharesOut : result.sharesSold,
        metadata: {
          source: 'api',
          apiKeyId: auth.apiKeyId,
          orderbookFillCount: Array.isArray(result.orderbookFills) ? result.orderbookFills.length : 0,
          triggeredLimitOrderCount: Array.isArray(result.triggeredLimitOrders) ? result.triggeredLimitOrders.length : 0,
        },
      });
    }
    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth.apiKeyId,
      username: auth.username,
      method: req.method,
      endpoint: '/api/v1/trades',
      result: executed.replay ? 'replay' : 'ok',
      statusCode: executed.statusCode,
      req,
      metadata: { replay: executed.replay },
    });
    return res.status(executed.statusCode).json(executed.body);
  } catch (e) {
    const schemaSql = _schemaSql;
    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth?.apiKeyId || null,
      username: auth?.username || null,
      method: req.method,
      endpoint: '/api/v1/trades',
      result: 'error',
      statusCode: e?.status || 500,
      errorCode: e?.code || e?.message || 'trades_failed',
      req,
    });
    if (e?.status) {
      return sendApiError(
        res,
        e.status,
        e.code || e.message || 'trade_rejected',
        e.detail || e.message || 'Trade rejected.',
        requestId,
      );
    }
    console.error('[public-api/trades] failed', { requestId, message: e?.message, code: e?.code });
    return sendApiError(res, 500, 'trades_failed', 'Could not process trade request.', requestId);
  }
}

/**
 * GET /api/v1/market?id=<marketId>
 * GET /api/v1/markets/<marketId>
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import {
  createApiRequestId,
  PUBLIC_API_HEADERS,
  sendApiError,
} from '../_lib/points-api-auth.js';
import { PRONOS_TREASURY_USERNAME } from '../_lib/points-limit-orders.js';
import { serializePublicMarket } from '../_lib/points-public-api.js';

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function marketIdFromRequest(req) {
  const queryId = req.query?.marketId || req.query?.id;
  if (queryId) return Number.parseInt(queryId, 10);
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').pop();
  return Number.parseInt(last, 10);
}

async function readMarketRows(sql, id) {
  return sql`
    SELECT
      m.id, m.question, m.category, m.image_url, m.outcomes, m.reserves,
      m.end_time, m.status, m.outcome, m.created_at, m.resolved_at,
      m.mode, m.amm_mode, m.parent_id, m.leg_label, m.featured,
      m.tournament_featured, m.source, m.source_event_id, m.final_score,
      m.resolver_type, m.resolver_config, m.start_time, m.sport, m.league,
      (SELECT COALESCE(SUM(ABS(t.collateral)), 0)
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_volume,
      (SELECT t.outcome_index
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_outcome_index,
      (SELECT t.price_at_trade
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_price,
      (SELECT (
          t.reserves_before IS NOT NULL
          AND t.reserves_after IS NOT NULL
          AND t.reserves_before = t.reserves_after
        )
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_is_book
      FROM points_markets m
     WHERE m.id = ${id}
       AND COALESCE(m.mode, 'points') = 'points'
       AND m.archived_at IS NULL
       AND (m.hidden_from_home IS NOT TRUE OR m.parent_id IS NOT NULL)
     LIMIT 1
  `;
}

async function readChildRows(sql, id) {
  return sql`
    SELECT
      m.id, m.question, m.category, m.image_url, m.outcomes, m.reserves,
      m.end_time, m.status, m.outcome, m.created_at, m.resolved_at,
      m.mode, m.amm_mode, m.parent_id, m.leg_label, m.featured,
      m.tournament_featured, m.source, m.source_event_id, m.final_score,
      m.resolver_type, m.resolver_config, m.start_time, m.sport, m.league,
      (SELECT COALESCE(SUM(ABS(t.collateral)), 0)
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_volume,
      (SELECT t.outcome_index
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_outcome_index,
      (SELECT t.price_at_trade
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_price,
      (SELECT (
          t.reserves_before IS NOT NULL
          AND t.reserves_after IS NOT NULL
          AND t.reserves_before = t.reserves_after
        )
         FROM points_trades t
        WHERE t.market_id = m.id
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.price_at_trade IS NOT NULL
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1) AS display_trade_is_book
      FROM points_markets m
     WHERE m.parent_id = ${id}
       AND COALESCE(m.mode, 'points') = 'points'
       AND m.archived_at IS NULL
     ORDER BY m.start_time ASC NULLS LAST, m.end_time ASC NULLS LAST, m.id ASC
  `;
}

export default async function handler(req, res) {
  const requestId = createApiRequestId();
  const cors = applyCors(req, res, {
    methods: 'GET, OPTIONS',
    headers: PUBLIC_API_HEADERS,
    credentials: false,
    enforceSameOriginForStateChanging: false,
  });
  if (cors) return cors;
  if (req.method !== 'GET') {
    return sendApiError(res, 405, 'method_not_allowed', 'Only GET is supported.', requestId);
  }

  const limited = rateLimit(req, res, {
    key: `public-api-market:${clientIp(req)}`,
    limit: 300,
    windowMs: 60_000,
    structuredError: true,
    requestId,
  });
  if (limited) return;

  const id = marketIdFromRequest(req);
  if (!Number.isInteger(id) || id <= 0) {
    return sendApiError(res, 400, 'invalid_market_id', 'marketId must be a positive integer.', requestId);
  }

  try {
    await ensurePointsSchema(getSchemaSql());
    const sql = getSql();
    const marketRows = await readMarketRows(sql, id);
    if (!marketRows[0]) {
      return sendApiError(res, 404, 'market_not_found', 'Market not found.', requestId);
    }
    const childRows = marketRows[0].parent_id == null ? await readChildRows(sql, id) : [];
    return res.status(200).json({
      market: serializePublicMarket(marketRows[0]),
      childMarkets: childRows.map(serializePublicMarket),
      requestId,
    });
  } catch (e) {
    console.error('[public-api/market] failed', { requestId, message: e?.message, code: e?.code });
    return sendApiError(res, 500, 'market_failed', 'Could not load market.', requestId);
  }
}

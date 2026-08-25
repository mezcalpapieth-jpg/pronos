/**
 * GET /api/v1/markets
 *
 * Public market discovery for bots, dashboards and third-party clients.
 * This route is unauthenticated but keeps the payload intentionally small.
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

function normalizeStatus(value) {
  const status = String(value || 'active').toLowerCase();
  return ['active', 'resolved', 'all'].includes(status) ? status : 'active';
}

function normalizeCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return category || null;
}

function normalizeLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(n, 200);
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
    key: `public-api-markets:${clientIp(req)}`,
    limit: 300,
    windowMs: 60_000,
    structuredError: true,
    requestId,
  });
  if (limited) return;

  try {
    await ensurePointsSchema(getSchemaSql());

    const status = normalizeStatus(req.query?.status);
    const category = normalizeCategory(req.query?.category);
    const limit = normalizeLimit(req.query?.limit);
    const rows = await getSql()`
      SELECT
        m.id, m.question, m.category, m.outcomes, m.reserves,
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
       WHERE (${status}::text = 'all' OR m.status = ${status}::text)
         AND (${category}::text IS NULL OR m.category = ${category}::text)
         AND COALESCE(m.mode, 'points') = 'points'
         AND m.parent_id IS NULL
         AND m.archived_at IS NULL
         AND m.hidden_from_home IS NOT TRUE
       ORDER BY
         CASE WHEN m.status = 'active' THEN 0 ELSE 1 END,
         CASE WHEN m.status = 'active' THEN m.end_time END ASC NULLS LAST,
         m.created_at DESC,
         m.id DESC
       LIMIT ${limit}
    `;

    return res.status(200).json({
      markets: rows.map(serializePublicMarket),
      requestId,
    });
  } catch (e) {
    console.error('[public-api/markets] failed', { requestId, message: e?.message, code: e?.code });
    return sendApiError(res, 500, 'markets_failed', 'Could not load markets.', requestId);
  }
}

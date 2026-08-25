import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { rateLimit } from '../_lib/rate-limit.js';
import {
  authenticatePointsApiRequest,
  createApiRequestId,
  PUBLIC_API_HEADERS,
  recordApiRequest,
  sendApiError,
} from '../_lib/points-api-auth.js';
import { roundNumber, serializePublicPosition } from '../_lib/points-public-api.js';

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

function normalizeMarketId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
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

  let auth = null;
  try {
    const schemaSql = getSchemaSql();
    await ensurePointsSchema(schemaSql);
    auth = await authenticatePointsApiRequest(schemaSql, req, { requiredPermission: 'READ', requestId });

    const limited = rateLimit(req, res, {
      key: `public-api-read:${auth.apiKeyId}`,
      limit: 120,
      windowMs: 60_000,
      structuredError: true,
      requestId,
    });
    if (limited) return;

    const marketId = normalizeMarketId(req.query?.marketId);
    const rows = await getReadSql()`
      SELECT
        p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
        m.question, m.category, m.outcomes, m.reserves, m.status, m.outcome,
        m.end_time, m.created_at, m.resolved_at,
        m.mode, m.amm_mode, m.parent_id, m.leg_label,
        m.featured, m.tournament_featured, m.source, m.source_event_id,
        m.final_score, m.resolver_type, m.resolver_config, m.start_time,
        m.sport, m.league
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
     WHERE p.username = ${auth.username}
       AND p.shares >= 0.005
       AND p.dismissed_at IS NULL
       AND (${marketId}::integer IS NULL OR p.market_id = ${marketId}::integer)
       AND COALESCE(m.mode, 'points') = 'points'
     ORDER BY
       CASE m.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
       m.end_time ASC NULLS LAST,
       p.market_id ASC,
       p.outcome_index ASC
     LIMIT 500
    `;
    const positions = rows.map(serializePublicPosition);
    const activePositions = positions.filter(position => position.status === 'active');
    const invested = activePositions.reduce((sum, position) => sum + Number(position.costBasis || 0), 0);
    const currentValue = activePositions.reduce((sum, position) => sum + Number(position.currentValue || 0), 0);
    const realized = positions.reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0);

    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth.apiKeyId,
      username: auth.username,
      method: req.method,
      endpoint: '/api/v1/positions',
      result: 'ok',
      statusCode: 200,
      req,
      metadata: { marketId },
    });
    return res.status(200).json({
      positions,
      summary: {
        totalPositions: positions.length,
        activePositions: activePositions.length,
        totalInvested: roundNumber(invested, 2),
        currentValue: roundNumber(currentValue, 2),
        unrealizedPnl: roundNumber(currentValue - invested, 2),
        realizedPnl: roundNumber(realized, 2),
        pnl: roundNumber(currentValue - invested + realized, 2),
      },
      requestId,
    });
  } catch (e) {
    const schemaSql = _schemaSql;
    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth?.apiKeyId || null,
      username: auth?.username || null,
      method: req.method,
      endpoint: '/api/v1/positions',
      result: 'error',
      statusCode: e?.status || 500,
      errorCode: e?.code || 'positions_failed',
      req,
    });
    if (e?.status && e?.code) {
      return sendApiError(res, e.status, e.code, e.message, requestId);
    }
    console.error('[public-api/positions] failed', { requestId, message: e?.message, code: e?.code });
    return sendApiError(res, 500, 'positions_failed', 'Could not load positions.', requestId);
  }
}

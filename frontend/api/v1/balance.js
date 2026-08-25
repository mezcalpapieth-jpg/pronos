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
import { roundNumber } from '../_lib/points-public-api.js';

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

    const rows = await getReadSql()`
      SELECT balance
        FROM points_balances
       WHERE username = ${auth.username}
       LIMIT 1
    `;
    const balance = roundNumber(rows[0]?.balance || 0, 2);
    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth.apiKeyId,
      username: auth.username,
      method: req.method,
      endpoint: '/api/v1/balance',
      result: 'ok',
      statusCode: 200,
      req,
    });
    return res.status(200).json({ balance, currency: 'MXNP', requestId });
  } catch (e) {
    const schemaSql = _schemaSql;
    await recordApiRequest(schemaSql, {
      requestId,
      apiKeyId: auth?.apiKeyId || null,
      username: auth?.username || null,
      method: req.method,
      endpoint: '/api/v1/balance',
      result: 'error',
      statusCode: e?.status || 500,
      errorCode: e?.code || 'balance_failed',
      req,
    });
    if (e?.status && e?.code) {
      return sendApiError(res, e.status, e.code, e.message, requestId);
    }
    console.error('[public-api/balance] failed', { requestId, message: e?.message, code: e?.code });
    return sendApiError(res, 500, 'balance_failed', 'Could not load balance.', requestId);
  }
}

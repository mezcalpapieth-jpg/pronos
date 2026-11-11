import { neon } from '@neondatabase/serverless';
import { applyCors } from './cors.js';
import { ensurePointsSchema } from './points-schema.js';
import { rateLimit } from './rate-limit.js';
import { withTransaction } from './db-tx.js';
import { capturePointsRiskEvent } from './points-risk.js';
import { authenticatePointsApiRequest, createApiRequestId, PUBLIC_API_HEADERS,
  readRawRequestBody, recordApiRequest, sendApiError } from './points-api-auth.js';
import { executeApiRedemption, listApiClaimablePositions } from './points-api-redemption.js';

let sql;
function primarySql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

export function createApiRedemptionHandler(action, {
  getSql = primarySql, ensureSchema = ensurePointsSchema, transaction = withTransaction,
  captureRisk = capturePointsRiskEvent,
} = {}) {
  const write = action === 'redeem';
  const method = write ? 'POST' : 'GET';
  const endpoint = write ? '/api/v1/redeem' : '/api/v1/claimable';
  return async function handler(req, res) {
    const requestId = createApiRequestId();
    res.setHeader('Cache-Control', 'private, no-store');
    const cors = applyCors(req, res, { methods: `${method}, OPTIONS`, headers: PUBLIC_API_HEADERS,
      credentials: false, enforceSameOriginForStateChanging: false });
    if (cors) return cors;
    if (req.method !== method) return sendApiError(res, 405, 'method_not_allowed', `Only ${method} is supported.`, requestId);
    let db, auth;
    try {
      db = getSql();
      await ensureSchema(db);
      if (write) await readRawRequestBody(req);
      auth = await authenticatePointsApiRequest(db, req, { requiredPermission: write ? 'TRADE' : 'READ', requestId });
      if (rateLimit(req, res, { key: write ? `public-api-trade:${auth.apiKeyId}` : `public-api-read:${auth.apiKeyId}`,
        limit: write ? 60 : 120, windowMs: 60_000, structuredError: true, requestId })) return;
      const executed = write
        ? await transaction(client => executeApiRedemption(client, { req, auth, requestId }))
        : { body: { ...await listApiClaimablePositions(db, { username: auth.username, query: req.query }), requestId } };
      if (write && !executed.replay) {
        const claim = executed.body.redemption;
        await captureRisk(db, req, { username: auth.username, accountId: auth.userSub,
          eventType: 'trade:redeem', tradeSide: 'redeem', marketId: Number(claim.marketId), outcomeIndex: claim.outcomeIndex,
          amount: claim.payout, shares: claim.sharesRedeemed, metadata: { source: 'api', apiKeyId: auth.apiKeyId } });
      }
      await recordApiRequest(db, { requestId, apiKeyId: auth.apiKeyId, username: auth.username,
        method, endpoint, result: executed.replay ? 'replay' : 'ok', statusCode: 200, req,
        metadata: { replay: executed.replay === true } });
      return res.status(200).json(executed.body);
    } catch (error) {
      const status = error.status || 500;
      const code = status === 500 ? (write ? 'redeem_failed' : 'claimable_failed') : error.code || error.message;
      await recordApiRequest(db, { requestId, apiKeyId: auth?.apiKeyId, username: auth?.username,
        method, endpoint, result: 'error', statusCode: status, errorCode: code, req });
      if (status === 500) console.error('[public-api/redemption] failed', { requestId, message: error.message, code: error.code });
      return sendApiError(res, status, code, status === 500 ? 'Could not process winnings claim.' : error.detail || error.message, requestId);
    }
  };
}

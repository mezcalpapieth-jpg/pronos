import { headerValue, stableApiRequestHash } from './points-api-auth.js';
import { readActiveCycleWindow, scoringStartIsoForWindow } from './points-cycle-window.js';
import { redeemWinningPosition, SHARE_EPSILON } from './points-redemption.js';
import { roundNumber } from './points-public-api.js';

function fail(code, status = 400, detail = code) {
  throw Object.assign(new Error(code), { code, status, detail });
}

function integer(value, { min = 1, code = 'invalid_market_id' } = {}) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) fail(code);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > 2_147_483_647) fail(code);
  return number;
}

async function queryRows(db, text, values = []) {
  const result = await db.query(text, values);
  return Array.isArray(result) ? result : result.rows;
}

export async function listApiClaimablePositions(db, { username, query = {} }) {
  const marketId = query.marketId == null ? null : integer(query.marketId);
  const after = query.afterMarketId == null ? 0 : integer(query.afterMarketId);
  const limit = query.limit == null ? 100 : Math.min(200, integer(query.limit, { code: 'invalid_limit' }));
  const window = await readActiveCycleWindow(db);
  const scoringStartIso = scoringStartIsoForWindow(window);
  if (!scoringStartIso) return { claims: [], count: 0, nextCursor: null, cycleId: null, currency: 'MXNP' };
  // Match voluntary redemption: purchases after the tournament cutoff count until rollover.
  // Include hidden winning positions too; dismissal does not remove the right to claim.
  const rows = await queryRows(db, `
    SELECT eligible.* FROM (
      SELECT p.market_id, p.outcome_index, m.question,
        LEAST(p.shares, GREATEST(0, COALESCE((
          SELECT SUM(CASE WHEN t.side = 'buy' THEN t.shares ELSE -t.shares END)
          FROM points_trades t
          WHERE LOWER(t.username) = LOWER(p.username)
            AND t.market_id = p.market_id AND t.outcome_index = p.outcome_index
            AND t.created_at >= $2::timestamptz AND t.side IN ('buy', 'sell', 'redeem')
        ), 0))) AS claimable_shares
      FROM points_positions p JOIN points_markets m ON m.id = p.market_id
      WHERE p.username = $1 AND p.shares > $3
        AND m.status = 'resolved' AND m.outcome = p.outcome_index
        AND COALESCE(m.mode, 'points') = 'points'
        AND ($4::integer IS NULL OR p.market_id = $4)
        AND p.market_id > $5
    ) eligible
    WHERE claimable_shares > $3
    ORDER BY market_id, outcome_index LIMIT $6
  `, [username, scoringStartIso, SHARE_EPSILON, marketId, after, limit + 1]);
  const claims = rows.slice(0, limit).map(row => ({
    marketId: String(row.market_id), outcomeIndex: Number(row.outcome_index), question: row.question,
    shares: roundNumber(row.claimable_shares, 6), payout: roundNumber(row.claimable_shares, 6),
  }));
  return {
    claims, count: claims.length, nextCursor: rows.length > limit ? claims.at(-1).marketId : null,
    cycleId: window.id, currency: 'MXNP',
  };
}

// Called inside the same transaction as the canonical payout. Claim and retry receipt
// commit together; concurrent inserts with the same key wait for the first transaction.
export async function executeApiRedemption(client, { req, auth, requestId }) {
  const key = String(headerValue(req, 'idempotency-key') || '').trim();
  if (key.length < 8 || key.length > 128) fail('missing_idempotency_key', 400, 'Claims require an Idempotency-Key of 8–128 characters.');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_body');
  const marketId = integer(body.marketId ?? body.market_id);
  const outcomeIndex = integer(body.outcomeIndex ?? body.outcome_index, { min: 0, code: 'invalid_outcome_index' });
  const requestHash = stableApiRequestHash(req);
  await client.query(`
    INSERT INTO points_api_idempotency_keys (api_key_id, idempotency_key, request_hash, expires_at)
    VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
    ON CONFLICT (api_key_id, idempotency_key) DO NOTHING
  `, [auth.apiKeyId, key, requestHash]);
  const receipt = (await client.query(`
    SELECT request_hash, status_code, response_body FROM points_api_idempotency_keys
    WHERE api_key_id = $1 AND idempotency_key = $2 FOR UPDATE
  `, [auth.apiKeyId, key])).rows[0];
  if (receipt.request_hash !== requestHash) fail('idempotency_conflict', 409, 'Idempotency-Key was already used with a different request.');
  if (receipt.response_body) {
    const stored = typeof receipt.response_body === 'string' ? JSON.parse(receipt.response_body) : receipt.response_body;
    return { replay: true, body: { ...stored, idempotentReplay: true } };
  }
  const result = await redeemWinningPosition(client, {
    username: auth.username, marketId, outcomeIndex, source: 'api', apiKeyId: auth.apiKeyId,
  });
  const response = {
    redemption: { marketId: String(marketId), outcomeIndex, sharesRedeemed: roundNumber(result.shares, 6),
      payout: roundNumber(result.payout, 6), status: 'CLAIMED' },
    balance: roundNumber(result.balance, 6), currency: 'MXNP', requestId,
  };
  await client.query(`
    UPDATE points_api_idempotency_keys SET status_code = 200, response_body = $3::jsonb
    WHERE api_key_id = $1 AND idempotency_key = $2
  `, [auth.apiKeyId, key, JSON.stringify(response)]);
  return { replay: false, body: response };
}

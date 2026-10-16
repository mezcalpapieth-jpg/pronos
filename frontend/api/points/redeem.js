/**
 * POST /api/points/redeem
 * Body: { marketId, outcomeIndex }
 *
 * Claim winnings on a resolved market. 1 MXNP per winning share, 0 per
 * losing share. Atomic: market read + position lock + balance update +
 * trade + distribution audit all inside one Postgres transaction.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { capturePointsRiskEvent } from '../_lib/points-risk.js';
import { redeemWinningPosition } from '../_lib/points-redemption.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `redeem:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)     return res.status(400).json({ error: 'invalid_outcome_index' });

  const username = session.username;

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(client => redeemWinningPosition(client, {
      username, marketId: mid, outcomeIndex: oi,
    }));

    await capturePointsRiskEvent(schemaSql, req, {
      username,
      accountId: session.sub,
      eventType: 'trade:redeem',
      marketId: mid,
      tradeSide: 'redeem',
      outcomeIndex: oi,
      amount: result.payout,
      shares: result.shares,
      metadata: {
        payout: result.payout,
      },
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/redeem] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'redeem_failed' });
  }
}

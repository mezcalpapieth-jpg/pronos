/**
 * GET /api/points/maker-rewards
 *
 * Portfolio-facing ledger of paid maker rewards. Rewards are written to
 * points_distributions by the limit-order payout flow, then shown here
 * with market metadata so each row can link back to the market.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { createApiTimer } from '../_lib/api-performance.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/maker-rewards');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await timer.time('schema', () => ensurePointsSchema(schemaSql));
    const rows = await timer.time('db_rewards', () => sql`
      SELECT d.id, d.amount, d.reason, d.reference_id AS market_id, d.created_at,
             m.parent_id,
             m.question AS market_question,
             m.category AS market_category,
             pm.id AS parent_market_id,
             pm.question AS parent_question,
             pm.category AS parent_category
        FROM points_distributions d
        LEFT JOIN points_markets m ON m.id = d.reference_id
        LEFT JOIN points_markets pm ON pm.id = m.parent_id
       WHERE d.username = ${session.username}
         AND d.kind = 'limit_maker_reward'
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 200
    `);

    const today = new Date().toISOString().slice(0, 10);
    const marketIds = new Set();
    let totalPaid = 0;
    let paidToday = 0;

    const rewards = rows.map((r) => {
      const amount = Number(r.amount || 0);
      const createdAt = r.created_at;
      const createdDay = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '';
      const parentMarketId = r.parent_market_id || null;
      const marketId = r.market_id || null;
      const linkMarketId = parentMarketId || marketId;
      if (linkMarketId) marketIds.add(Number(linkMarketId));
      totalPaid += amount;
      if (createdDay === today) paidToday += amount;
      return {
        id: Number(r.id),
        marketId: marketId == null ? null : Number(marketId),
        parentMarketId: parentMarketId == null ? null : Number(parentMarketId),
        question: r.parent_question || r.market_question || (marketId ? `Mercado #${marketId}` : 'Mercado'),
        category: r.parent_category || r.market_category || null,
        amount: round2(amount),
        reason: r.reason || 'Recompensa por liquidez',
        createdAt,
      };
    });

    timer.end({ rewards: rewards.length });
    return res.status(200).json({
      rewards,
      summary: {
        totalPaid: round2(totalPaid),
        paidToday: round2(paidToday),
        rewardsCount: rewards.length,
        marketsCount: marketIds.size,
      },
    });
  } catch (e) {
    timer.end({ error: 'maker_rewards_failed' });
    console.error('[points/maker-rewards] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'maker_rewards_failed' });
  }
}

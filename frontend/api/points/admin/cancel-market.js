/**
 * POST /api/points/admin/cancel-market
 * Body: { marketId, reason? }
 *
 * Anula un mercado de puntos when the real-world event did not happen.
 * Unlike resolving, there is no winning outcome: every open holder gets
 * their remaining cost basis back, positions are zeroed, and the market
 * becomes status='canceled'. For parallel markets, call this on the
 * parent and it cascades through every leg.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { cancelPointsMarket } from '../../_lib/points-cancel-market.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { marketId, reason } = req.body || {};
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }
  const reasonText = typeof reason === 'string' && reason.trim()
    ? reason.trim().slice(0, 180)
    : 'Mercado anulado: el evento no ocurrió';

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(client => cancelPointsMarket(client, mid, {
      actor: admin.username, reason: reasonText,
    }));

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/cancel-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'cancel_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}

/**
 * POST /api/points/cancel-limit-order
 * Body: { orderId }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { cancelLimitOrder } from '../_lib/points-limit-orders.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `cancel-limit-order:${clientIp(req)}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const orderId = Number.parseInt(req.body?.orderId, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'invalid_order_id' });
  }

  try {
    await ensurePointsSchema(schemaSql);
    const result = await withTransaction((client) => cancelLimitOrder(client, {
      orderId,
      username: session.username,
    }));
    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[points/cancel-limit-order] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'cancel_limit_order_failed' });
  }
}

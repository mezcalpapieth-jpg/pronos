/**
 * GET  /api/points/parlays        - list my parlay tickets
 * POST /api/points/parlays        - create a tournament parlay
 * Body: { legs: [{ marketId, outcomeIndex }], stake }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { capturePointsRiskEvent } from '../../_lib/points-risk.js';
import {
  createParlayTicket,
  listParlayTicketsForUser,
  settleOpenParlayTickets,
} from '../../_lib/points-parlays.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);

    if (req.method === 'GET') {
      const limit = Number.parseInt(req.query?.limit, 10) || 20;
      const tickets = await withTransaction(async (client) => {
        await settleOpenParlayTickets(client, {
          username: session.username,
          limit: Math.max(limit, 100),
        });
        return listParlayTicketsForUser(client, {
          username: session.username,
          limit,
        });
      });
      return res.status(200).json({ ok: true, tickets });
    }

    const limited = rateLimit(req, res, {
      key: `parlay:${clientIp(req)}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (limited) return;

    const result = await withTransaction((client) => createParlayTicket(client, {
      username: session.username,
      legs: req.body?.legs,
      stake: req.body?.stake,
      now: new Date(),
    }));

    await capturePointsRiskEvent(schemaSql, req, {
      username: session.username,
      accountId: session.sub,
      eventType: 'trade:parlay',
      amount: result.quote?.stake,
      metadata: {
        legCount: result.quote?.legs?.length || 0,
        multiplier: result.quote?.multiplier,
        potentialPayout: result.quote?.potentialPayout,
      },
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/parlays] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'parlay_failed' });
  }
}

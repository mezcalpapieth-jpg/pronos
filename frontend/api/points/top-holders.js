/**
 * GET /api/points/top-holders?marketId=X&limit=10
 *
 * Returns the biggest shareholders of a market, ordered by mark-to-market
 * value. Active markets calculate live values; resolved markets use the
 * pre-resolution snapshot when one exists. Works for both unified and
 * parallel markets:
 *
 *   Unified: aggregates rows from points_positions where market_id = X.
 *   Parallel parent: marketId refers to the parent; we expand to all its legs
 *            and aggregate per (username, leg, outcome). Each leg is a
 *            distinct "side" the user holds, labeled "<leg> — Sí/No" to
 *            match positions.js's display convention.
 *   Parallel child: marketId may also refer to one leg, which renders the
 *            regular Sí/No holder table for the resolved detail page.
 *
 * Read-only. Rate-limited to 30 req/min/IP to cap discovery-page load.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { poolQuery } from '../_lib/db-tx.js';
import {
  buildTopHoldersForMarket,
  readTopHolderSnapshot,
} from '../_lib/points-top-holders.js';

let _schemaSql = null;
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const limited = rateLimit(req, res, {
      key: `top-holders:${clientIp(req)}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) return;

    const mid = parseInt(req.query.marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    await ensurePointsSchema(getSchemaSql());
    const db = { query: (text, params = []) => poolQuery(text, params) };

    const snapshot = await readTopHolderSnapshot(db, mid, { limit });
    if (snapshot) return res.status(200).json(snapshot);

    const live = await buildTopHoldersForMarket(db, mid, { limit });
    return res.status(200).json(live);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/top-holders] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

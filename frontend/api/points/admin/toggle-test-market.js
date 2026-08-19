/**
 * POST /api/points/admin/toggle-test-market
 *   body: { marketId?, pendingId?, isTestMarket: boolean }
 *
 * Flip the "MERCADO DE PRUEBA" badge on a live market (`marketId`) or on a
 * row still in the approval queue (`pendingId`). Exactly one id must be given;
 * a pending row carries the flag into points_markets when it is approved.
 *
 * The badge is a disclosure, not curation: it marks a market whose resolution
 * method has not been proven yet, so traders can see that before committing
 * points. It does not affect pricing, listing or resolution.
 *
 * Idempotent. Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const { marketId, pendingId, isTestMarket } = req.body || {};
    if (typeof isTestMarket !== 'boolean') {
      return res.status(400).json({ error: 'isTestMarket_must_be_boolean' });
    }
    const mid = Number.parseInt(marketId, 10);
    const pid = Number.parseInt(pendingId, 10);
    const hasMarket = Number.isInteger(mid) && mid > 0;
    const hasPending = Number.isInteger(pid) && pid > 0;
    if (hasMarket === hasPending) {
      return res.status(400).json({ error: 'supply_exactly_one_of_marketId_pendingId' });
    }

    await ensurePointsSchema(sql);

    if (hasMarket) {
      const rows = await sql`
        UPDATE points_markets
        SET is_test_market = ${isTestMarket}
        WHERE id = ${mid}
        RETURNING id, is_test_market
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
      return res.status(200).json({
        ok: true,
        marketId: rows[0].id,
        isTestMarket: rows[0].is_test_market === true,
        reviewer: admin.username,
      });
    }

    const rows = await sql`
      UPDATE points_pending_markets
      SET is_test_market = ${isTestMarket}
      WHERE id = ${pid}
      RETURNING id, is_test_market
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'pending_not_found' });
    return res.status(200).json({
      ok: true,
      pendingId: rows[0].id,
      isTestMarket: rows[0].is_test_market === true,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/toggle-test-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'toggle_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

/**
 * POST /api/points/admin/resolve-market
 * Body: { marketId, winningOutcomeIndex }
 *
 * Unified: flips the market to resolved + sets the winning outcome.
 * Parallel: marketId is the parent id. We flip the parent AND cascade
 * to every leg — the winning leg resolves as YES=0 (payout for YES
 * holders), every losing leg resolves as NO=1 (payout for NO holders).
 * All in one transaction so users never see a half-resolved group.
 *
 * Either way, users with winning shares can then call /api/points/redeem
 * for their specific (market_id, outcome_index) position.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { marketId, winningOutcomeIndex } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(winningOutcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome' });

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const mr = await client.query(
        `SELECT id, status, amm_mode, parent_id FROM points_markets
         WHERE id = $1 FOR UPDATE`,
        [mid],
      );
      if (mr.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const m = mr.rows[0];
      if (m.parent_id) {
        const err = new Error('leg_not_directly_resolvable');
        err.status = 400;
        err.detail = 'Resolve the parent market instead.';
        throw err;
      }
      if (m.status !== 'active') {
        const err = new Error('market_not_active'); err.status = 400; throw err;
      }

      await client.query(
        `UPDATE points_markets
           SET status = 'resolved', outcome = $1,
               resolved_at = NOW(), resolved_by = $2
         WHERE id = $3`,
        [oi, admin.username, mid],
      );

      if (m.amm_mode === 'parallel') {
        const legs = await client.query(
          `SELECT id FROM points_markets
           WHERE parent_id = $1
           ORDER BY id ASC
           FOR UPDATE`,
          [mid],
        );
        if (oi >= legs.rows.length) {
          const err = new Error('invalid_outcome');
          err.status = 400;
          err.detail = `parent has ${legs.rows.length} legs, winning index ${oi} out of range`;
          throw err;
        }
        for (let i = 0; i < legs.rows.length; i++) {
          const legId = legs.rows[i].id;
          const legWinningOutcome = i === oi ? 0 : 1; // YES for winner, NO for losers
          await client.query(
            `UPDATE points_markets
               SET status = 'resolved', outcome = $1,
                   resolved_at = NOW(), resolved_by = $2
             WHERE id = $3 AND status = 'active'`,
            [legWinningOutcome, admin.username, legId],
          );
        }
      }
      return { ok: true, ammMode: m.amm_mode || 'unified' };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[admin/resolve-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'resolve_failed' });
  }
}

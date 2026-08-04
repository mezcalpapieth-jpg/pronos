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
import { releaseOpenLimitOrdersForMarkets } from '../../_lib/points-limit-orders.js';

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

    const result = await withTransaction(async (client) => {
      const mr = await client.query(
        `SELECT id, status, amm_mode, parent_id
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      if (mr.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const market = mr.rows[0];
      if (market.parent_id) {
        const err = new Error('cannot_cancel_leg_directly');
        err.status = 400;
        err.detail = `Market ${mid} is a leg of parent ${market.parent_id}. Cancel the parent instead.`;
        throw err;
      }
      if (market.status !== 'active') {
        const err = new Error('market_not_active');
        err.status = 400;
        err.detail = `Current status is ${market.status}.`;
        throw err;
      }

      const related = await client.query(
        `SELECT id, status
           FROM points_markets
          WHERE id = $1 OR parent_id = $1
          ORDER BY id ASC
          FOR UPDATE`,
        [mid],
      );
      const marketIds = related.rows.map(r => Number(r.id)).filter(Number.isFinite);
      await releaseOpenLimitOrdersForMarkets(client, marketIds, {
        reason: 'market_cancelled',
        status: 'cancelled',
      });

      await client.query(
        `SELECT market_id, username, outcome_index, shares, cost_basis
           FROM points_positions
          WHERE market_id = ANY($1::int[])
            AND shares > 0
          FOR UPDATE`,
        [marketIds],
      );

      await client.query(
        `WITH refunds AS (
           SELECT username, SUM(cost_basis) AS amount
             FROM points_positions
            WHERE market_id = ANY($1::int[])
              AND shares > 0
              AND cost_basis > 0
            GROUP BY username
         )
         INSERT INTO points_balances (username, balance, updated_at)
         SELECT username, amount, NOW()
           FROM refunds
         ON CONFLICT (username) DO UPDATE
           SET balance = points_balances.balance + EXCLUDED.balance,
               updated_at = NOW()`,
        [marketIds],
      );

      const distributionRows = await client.query(
        `WITH refunds AS (
           SELECT username, market_id, SUM(cost_basis) AS amount
             FROM points_positions
            WHERE market_id = ANY($1::int[])
              AND shares > 0
              AND cost_basis > 0
            GROUP BY username, market_id
         )
         INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         SELECT username, amount, 'market_cancel_refund', market_id, $2
           FROM refunds
         RETURNING username, amount, reference_id`,
        [marketIds, reasonText],
      );

      await client.query(
        `UPDATE points_positions
            SET shares = 0,
                cost_basis = 0,
                updated_at = NOW()
          WHERE market_id = ANY($1::int[])
            AND shares > 0`,
        [marketIds],
      );

      await client.query(
        `UPDATE points_markets
            SET status = 'canceled',
                outcome = NULL,
                resolved_at = NOW(),
                resolved_by = $2
          WHERE id = ANY($1::int[])
            AND status = 'active'`,
        [marketIds, admin.username],
      );

      const totalRefunded = distributionRows.rows.reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0,
      );

      return {
        ok: true,
        marketId: mid,
        canceledMarketIds: marketIds,
        refundCount: distributionRows.rows.length,
        totalRefunded,
      };
    });

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

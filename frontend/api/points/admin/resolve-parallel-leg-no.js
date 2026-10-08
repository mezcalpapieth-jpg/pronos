/**
 * POST /api/points/admin/resolve-parallel-leg-no
 * Body: { legMarketId, parentMarketId?, reason?, finalScore? }
 *
 * Resolves one active child leg of a parallel market to NO without
 * resolving the parent or touching sibling legs. This covers elimination
 * style markets where one candidate can become impossible before the
 * whole market has a final winner.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { releaseOpenLimitOrdersForMarkets, parseJsonb } from '../../_lib/points-limit-orders.js';
import { bestEffortPersistTopHolderSnapshot } from '../../_lib/points-top-holders.js';

const schemaSql = neon(process.env.DATABASE_URL);

function httpError(message, status = 400, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}

function cleanOptionalText(value, { max = 240 } = {}) {
  if (value == null) return null;
  if (typeof value !== 'string') throw httpError('invalid_text');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw httpError('text_too_long');
  return trimmed;
}

function noOutcomeIndex(outcomes) {
  const labels = parseJsonb(outcomes, ['Si', 'No']).map(label => String(label || '').trim().toLowerCase());
  const index = labels.findIndex(label => label === 'no');
  return index >= 0 ? index : 1;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const legMarketId = Number.parseInt(req.body?.legMarketId ?? req.body?.marketId, 10);
  const parentMarketId = req.body?.parentMarketId == null
    ? null
    : Number.parseInt(req.body.parentMarketId, 10);
  if (!Number.isInteger(legMarketId) || legMarketId <= 0) {
    return res.status(400).json({ error: 'invalid_leg_market_id' });
  }
  if (parentMarketId != null && (!Number.isInteger(parentMarketId) || parentMarketId <= 0)) {
    return res.status(400).json({ error: 'invalid_parent_market_id' });
  }

  let reason;
  let finalScore;
  try {
    reason = cleanOptionalText(req.body?.reason, { max: 180 })
      || 'Child leg resolved early to No';
    finalScore = cleanOptionalText(req.body?.finalScore, { max: 240 });
  } catch (e) {
    return res.status(e?.status || 400).json({ error: e?.message || 'invalid_text' });
  }

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const legResult = await client.query(
        `SELECT id, parent_id, leg_label, status, amm_mode, outcome, outcomes, final_score,
                resolver_config
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [legMarketId],
      );
      if (legResult.rows.length === 0) throw httpError('leg_market_not_found', 404);
      const leg = legResult.rows[0];
      if (!leg.parent_id) throw httpError('market_is_not_parallel_leg', 400);
      if (parentMarketId != null && Number(leg.parent_id) !== parentMarketId) {
        throw httpError('parent_market_mismatch', 400);
      }
      if (leg.status !== 'active') {
        throw httpError('leg_not_active', 400, `Current status is ${leg.status}.`);
      }
      if ((leg.amm_mode || 'parallel') !== 'parallel') {
        throw httpError('leg_not_parallel', 400, `Current AMM mode is ${leg.amm_mode || 'unified'}.`);
      }

      const parentResult = await client.query(
        `SELECT id, status, amm_mode
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [Number(leg.parent_id)],
      );
      if (parentResult.rows.length === 0) throw httpError('parent_market_not_found', 404);
      const parent = parentResult.rows[0];
      if (parent.status !== 'active') {
        throw httpError('parent_market_not_active', 400, `Current status is ${parent.status}.`);
      }
      if ((parent.amm_mode || 'unified') !== 'parallel') {
        throw httpError('parent_market_not_parallel', 400);
      }

      const outcomeIndex = noOutcomeIndex(leg.outcomes);
      await bestEffortPersistTopHolderSnapshot(
        client,
        Number(leg.id),
        'admin/resolve-parallel-leg-no',
        { resolution: { winningOutcomeIndex: outcomeIndex } },
      );
      const release = await releaseOpenLimitOrdersForMarkets(client, [Number(leg.id)], {
        reason: 'market_resolved',
      });

      const patch = {
        earlyNoResolution: {
          at: new Date().toISOString(),
          by: admin.username,
          reason,
          outcomeIndex,
        },
      };
      const score = finalScore || `${leg.leg_label || 'Opcion'} ya no puede ganar`;
      const updated = await client.query(
        `UPDATE points_markets
            SET status = 'resolved',
                outcome = $2,
                resolved_at = NOW(),
                resolved_by = $3,
                final_score = $4,
                resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $5::jsonb
          WHERE id = $1
            AND status = 'active'
          RETURNING id, parent_id, leg_label, status, outcome, final_score, resolved_at, resolved_by`,
        [
          Number(leg.id),
          outcomeIndex,
          admin.username,
          score,
          JSON.stringify(patch),
        ],
      );
      if (updated.rows.length !== 1) throw httpError('leg_update_failed', 409);

      return {
        ok: true,
        parentMarketId: Number(leg.parent_id),
        leg: updated.rows[0],
        releasedOrders: release.releasedOrders || 0,
        refundedCollateral: release.refundedCollateral || 0,
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/resolve-parallel-leg-no] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'resolve_parallel_leg_no_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}

/**
 * POST /api/points/admin/correct-resolution
 * Body: { marketId, winningOutcomeIndex, finalScore?, reason? }
 *
 * Admin-only correction for markets that were already resolved to the
 * wrong outcome. The original redeem trades stay immutable; already-claimed
 * payouts that are no longer winners are reversed through negative
 * points_distributions rows and marked in points_redemption_reversals so
 * retries cannot debit users twice.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import {
  PRONOS_TREASURY_USERNAME,
  releaseOpenLimitOrdersForMarkets,
} from '../../_lib/points-limit-orders.js';
import { bestEffortPersistTopHolderSnapshot } from '../../_lib/points-top-holders.js';

const schemaSql = neon(process.env.DATABASE_URL);
const EPSILON = 0.000001;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function optionalText(value, { max = 240, field = 'text' } = {}) {
  if (value === undefined) return { ok: true, provided: false, value: null };
  if (value === null) return { ok: true, provided: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `invalid_${field}` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false, error: `${field}_too_long` };
  return { ok: true, provided: true, value: trimmed || null };
}

function outcomeIndexOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function labelFor(outcomes, index) {
  const i = Number(index);
  if (!Number.isInteger(i)) return '—';
  return outcomes?.[i] || `Opción ${i + 1}`;
}

function reversalKey(row) {
  return `${Number(row.market_id)}:${String(row.username || '').toLowerCase()}`;
}

function buildTargetOutcomes(parent, relatedRows, winningOutcomeIndex) {
  const parentId = Number(parent.id);
  const target = new Map();
  const ammMode = parent.amm_mode || 'unified';

  if (ammMode === 'parallel') {
    const legs = relatedRows
      .filter(row => Number(row.parent_id) === parentId && row.status !== 'canceled')
      .sort((a, b) => Number(a.id) - Number(b.id));
    if (winningOutcomeIndex >= legs.length) {
      const err = new Error('invalid_outcome');
      err.status = 400;
      err.detail = `parent has ${legs.length} legs, winning index ${winningOutcomeIndex} out of range`;
      throw err;
    }
    target.set(parentId, winningOutcomeIndex);
    for (let i = 0; i < legs.length; i += 1) {
      target.set(Number(legs[i].id), i === winningOutcomeIndex ? 0 : 1);
    }
    return { target, affectedMarketIds: Array.from(target.keys()), ammMode, legs };
  }

  const outcomes = parseJsonb(parent.outcomes, ['Sí', 'No']);
  if (winningOutcomeIndex >= outcomes.length) {
    const err = new Error('invalid_outcome');
    err.status = 400;
    err.detail = `market has ${outcomes.length} outcomes, winning index ${winningOutcomeIndex} out of range`;
    throw err;
  }
  target.set(parentId, winningOutcomeIndex);
  return { target, affectedMarketIds: [parentId], ammMode, legs: [] };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const body = req.body || {};
  const mid = parseInt(body.marketId, 10);
  const oi = parseInt(body.winningOutcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome' });

  const finalScore = optionalText(body.finalScore, { field: 'final_score' });
  if (!finalScore.ok) return res.status(400).json({ error: finalScore.error });
  const reason = optionalText(body.reason, { field: 'reason' });
  if (!reason.ok) return res.status(400).json({ error: reason.error });
  const reasonText = reason.value || 'Corrección manual de resolución';

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const marketResult = await client.query(
        `SELECT id, status, amm_mode, parent_id, outcome, outcomes, final_score
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      if (marketResult.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const parent = marketResult.rows[0];
      if (parent.parent_id) {
        const err = new Error('leg_not_directly_correctable');
        err.status = 400;
        err.detail = 'Correct the parent market instead.';
        throw err;
      }
      if (parent.status !== 'resolved') {
        const err = new Error('market_not_resolved');
        err.status = 400;
        err.detail = 'Use the normal resolver for active markets.';
        throw err;
      }

      const relatedResult = await client.query(
        `SELECT id, parent_id, status, amm_mode, outcome, outcomes, leg_label
           FROM points_markets
          WHERE id = $1 OR parent_id = $1
          ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, id ASC
          FOR UPDATE`,
        [mid],
      );
      const relatedRows = relatedResult.rows || [];
      const { target, affectedMarketIds, ammMode } = buildTargetOutcomes(parent, relatedRows, oi);
      const oldOutcome = outcomeIndexOrNull(parent.outcome);
      const parentOutcomes = parseJsonb(parent.outcomes, ['Sí', 'No']);
      const oldLabel = labelFor(parentOutcomes, oldOutcome);
      const newLabel = labelFor(parentOutcomes, oi);

      const correctionResult = await client.query(
        `INSERT INTO points_resolution_corrections (
           market_id, old_outcome, new_outcome, admin_username, reason,
           final_score, affected_market_ids
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id, created_at`,
        [
          mid,
          oldOutcome,
          oi,
          admin.username || null,
          reasonText,
          finalScore.provided ? finalScore.value : (parent.final_score || null),
          JSON.stringify(affectedMarketIds),
        ],
      );
      const correction = correctionResult.rows[0];
      const correctionId = Number(correction.id);

      const redeemResult = await client.query(
        `SELECT id, market_id, username, outcome_index, shares, collateral, created_at
           FROM points_trades
          WHERE market_id = ANY($1::int[])
            AND side = 'redeem'
            AND username <> $2
          ORDER BY created_at ASC, id ASC
          FOR UPDATE`,
        [affectedMarketIds, PRONOS_TREASURY_USERNAME],
      );
      const redeemIds = redeemResult.rows.map(row => Number(row.id)).filter(Number.isInteger);

      const alreadyReversed = new Set();
      if (redeemIds.length > 0) {
        const reversedRows = await client.query(
          `SELECT redeem_trade_id
             FROM points_redemption_reversals
            WHERE redeem_trade_id = ANY($1::int[])`,
          [redeemIds],
        );
        for (const row of reversedRows.rows) {
          alreadyReversed.add(Number(row.redeem_trade_id));
        }
      }

      const legacyReversedByUserMarket = new Map();
      if (affectedMarketIds.length > 0) {
        const legacyRows = await client.query(
          `SELECT reference_id AS market_id,
                  LOWER(username) AS username_key,
                  ABS(SUM(amount)) AS amount
             FROM points_distributions
            WHERE kind = 'redemption_reversal'
              AND amount < 0
              AND reference_id = ANY($1::int[])
            GROUP BY reference_id, LOWER(username)`,
          [affectedMarketIds],
        );
        for (const row of legacyRows.rows) {
          legacyReversedByUserMarket.set(
            `${Number(row.market_id)}:${row.username_key}`,
            Number(row.amount || 0),
          );
        }
      }

      let reversedTotal = 0;
      let reversedCount = 0;

      for (const redeem of redeemResult.rows) {
        const marketId = Number(redeem.market_id);
        const targetOutcome = target.get(marketId);
        const redeemedOutcome = Number(redeem.outcome_index);
        if (!Number.isInteger(targetOutcome) || redeemedOutcome === targetOutcome) continue;
        if (alreadyReversed.has(Number(redeem.id))) continue;

        const originalAmount = Number(redeem.collateral || 0);
        if (!(originalAmount > EPSILON)) continue;

        const key = reversalKey(redeem);
        const legacyCovered = Math.min(Number(legacyReversedByUserMarket.get(key) || 0), originalAmount);
        legacyReversedByUserMarket.set(key, Math.max(0, Number(legacyReversedByUserMarket.get(key) || 0) - legacyCovered));
        const amountToReverse = originalAmount - legacyCovered;
        if (!(amountToReverse > EPSILON)) continue;

        const inserted = await client.query(
          `INSERT INTO points_redemption_reversals (
             redeem_trade_id, correction_id, market_id, username, outcome_index, amount
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (redeem_trade_id) DO NOTHING
           RETURNING redeem_trade_id`,
          [
            Number(redeem.id),
            correctionId,
            marketId,
            redeem.username,
            redeemedOutcome,
            amountToReverse,
          ],
        );
        if (inserted.rows.length === 0) continue;

        await client.query(
          `INSERT INTO points_balances (username, balance)
           VALUES ($1, $2)
           ON CONFLICT (username) DO UPDATE
              SET balance = points_balances.balance + EXCLUDED.balance,
                  updated_at = NOW()`,
          [redeem.username, -amountToReverse],
        );

        await client.query(
          `UPDATE points_positions
              SET realized_pnl = COALESCE(realized_pnl, 0) - $1,
                  updated_at = NOW()
            WHERE market_id = $2
              AND username = $3
              AND outcome_index = $4`,
          [amountToReverse, marketId, redeem.username, redeemedOutcome],
        );

        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           VALUES ($1, $2, 'redemption_reversal', $3, $4)`,
          [
            redeem.username,
            -amountToReverse,
            marketId,
            `${reasonText}: corrección #${correctionId} ${oldLabel} → ${newLabel}`.slice(0, 240),
          ],
        );

        reversedTotal += amountToReverse;
        reversedCount += 1;
      }

      for (const [marketId, targetOutcome] of target.entries()) {
        await client.query(
          `UPDATE points_markets
              SET status = 'resolved',
                  outcome = $1,
                  resolved_at = NOW(),
                  resolved_by = $2
            WHERE id = $3`,
          [targetOutcome, admin.username || null, marketId],
        );
      }
      if (finalScore.provided) {
        await client.query(
          `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
          [finalScore.value, mid],
        );
      }

      await client.query(
        `UPDATE points_resolution_corrections
            SET reversed_total = $1,
                reversed_count = $2
          WHERE id = $3`,
        [reversedTotal, reversedCount, correctionId],
      );

      await client.query(
        `DELETE FROM points_top_holder_snapshots
          WHERE market_id = ANY($1::int[])`,
        [affectedMarketIds],
      );
      await bestEffortPersistTopHolderSnapshot(
        client,
        mid,
        'admin/correct-resolution',
        { resolution: { winningOutcomeIndex: oi } },
      );
      await releaseOpenLimitOrdersForMarkets(client, affectedMarketIds, {
        reason: 'resolution_corrected',
      });

      return {
        ok: true,
        correctionId,
        marketId: mid,
        ammMode,
        affectedMarketIds,
        oldOutcome,
        newOutcome: oi,
        oldOutcomeLabel: oldLabel,
        newOutcomeLabel: newLabel,
        finalScore: finalScore.provided ? finalScore.value : (parent.final_score || null),
        reversedCount,
        reversedTotal: Math.round(reversedTotal * 1_000_000) / 1_000_000,
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[admin/correct-resolution] error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 3).join(' | '),
    });
    return res.status(500).json({
      error: 'correction_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}

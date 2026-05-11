/**
 * POST /api/points/admin/void-market
 * Body: { marketId, reason? }
 *
 * Marks a market as void (resolved without a winner) and refunds
 * every open position's cost_basis to the holder's balance. Used
 * primarily for boxing draws — the user's spec: "in case of a tie
 * we mark the market as void and send the money back".
 *
 * Side effects, all inside a single Postgres transaction:
 *   1. points_markets row: status='resolved', outcome=NULL,
 *      resolved_at=NOW(), resolved_by=<admin>,
 *      final_score=reason ?? 'Empate · Mercado anulado'
 *   2. For each row in points_positions with shares > 0 on this
 *      market: balance += cost_basis (refund), distribution row
 *      with kind='void_refund', position zeroed out.
 *   3. Parallel parents cascade to legs — each leg gets the same
 *      treatment so all child positions clear out.
 *
 * Idempotent: a second call on an already-resolved market returns
 * 400 'already_resolved' without further mutation.
 *
 * Admin-gated.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

async function voidOneMarket(client, marketId, reason, adminUsername) {
  const lookup = await client.query(
    `SELECT id, status, amm_mode, parent_id
       FROM points_markets
      WHERE id = $1
      FOR UPDATE`,
    [marketId],
  );
  if (lookup.rows.length === 0) {
    const err = new Error('market_not_found'); err.status = 404; throw err;
  }
  const m = lookup.rows[0];
  if (m.parent_id) {
    const err = new Error('leg_not_directly_voidable');
    err.status = 400;
    err.detail = 'Void the parent market — legs cascade automatically.';
    throw err;
  }
  if (m.status !== 'active') {
    const err = new Error('already_resolved'); err.status = 400; throw err;
  }

  const finalScore = reason || 'Empate · Mercado anulado';

  // Mark parent resolved with no outcome.
  await client.query(
    `UPDATE points_markets
        SET status = 'resolved',
            outcome = NULL,
            resolved_at = NOW(),
            resolved_by = $1
      WHERE id = $2`,
    [adminUsername, marketId],
  );
  // final_score column may not exist on older clones — non-fatal.
  try {
    await client.query(
      `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
      [finalScore, marketId],
    );
  } catch (e) {
    if (e?.code !== '42703') throw e;
  }

  // Collect the rows we refund: parent itself (unified) OR all legs
  // (parallel parent has no positions, the legs do).
  let refundIds = [marketId];
  if (m.amm_mode === 'parallel') {
    const legs = await client.query(
      `SELECT id FROM points_markets WHERE parent_id = $1 FOR UPDATE`,
      [marketId],
    );
    refundIds = legs.rows.map(r => r.id);
    // Mirror status on each leg so the UI shows them as resolved-no-outcome.
    for (const legId of refundIds) {
      await client.query(
        `UPDATE points_markets
            SET status = 'resolved',
                outcome = NULL,
                resolved_at = NOW(),
                resolved_by = $1
          WHERE id = $2 AND status = 'active'`,
        [adminUsername, legId],
      );
    }
  }

  // Refund every open position on those markets.
  let refundedCount = 0;
  let refundedTotal = 0;
  for (const mid of refundIds) {
    const positions = await client.query(
      `SELECT id, username, outcome_index, shares, cost_basis
         FROM points_positions
        WHERE market_id = $1 AND shares > 0
        FOR UPDATE`,
      [mid],
    );
    for (const p of positions.rows) {
      const refund = Number(p.cost_basis) || 0;
      if (refund <= 0) continue;
      // Credit balance.
      const bal = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [p.username],
      );
      const current = bal.rows.length > 0 ? Number(bal.rows[0].balance) : 0;
      if (bal.rows.length === 0) {
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
          [p.username, refund],
        );
      } else {
        await client.query(
          `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
          [current + refund, p.username],
        );
      }
      // Zero out the position.
      await client.query(
        `UPDATE points_positions
            SET shares = 0,
                cost_basis = 0,
                updated_at = NOW()
          WHERE id = $1`,
        [p.id],
      );
      // Distribution audit row for the refund.
      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'void_refund', $3, $4)`,
        [p.username, refund, mid, finalScore],
      );
      refundedCount += 1;
      refundedTotal += refund;
    }
  }

  return { refundedCount, refundedTotal };
}

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
  let scoreVal = null;
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') {
      return res.status(400).json({ error: 'invalid_reason' });
    }
    const t = reason.trim();
    if (t.length > 240) return res.status(400).json({ error: 'reason_too_long' });
    scoreVal = t.length > 0 ? t : null;
  }

  try {
    await ensurePointsSchema(schemaSql);
    const result = await withTransaction(async (client) => {
      return voidOneMarket(client, mid, scoreVal, admin.username);
    });
    return res.status(200).json({
      ok: true,
      marketId: mid,
      reason: scoreVal || 'Empate · Mercado anulado',
      refundedPositions: result.refundedCount,
      refundedTotal: result.refundedTotal,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/void-market] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'void_failed', detail: e?.message?.slice(0, 240) || null });
  }
}

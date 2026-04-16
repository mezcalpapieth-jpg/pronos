/**
 * POST /api/points/redeem
 * Body: { marketId, outcomeIndex }
 *
 * Claim winnings on a resolved market. 1 MXNP per winning share, 0 per
 * losing share. Atomic: market read + position lock + balance update +
 * trade + distribution audit all inside one Postgres transaction.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `redeem:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (![0, 1].includes(oi))                return res.status(400).json({ error: 'invalid_outcome_index' });

  const username = session.username;

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const marketResult = await client.query(
        `SELECT id, status, outcome FROM points_markets WHERE id = $1 FOR UPDATE`,
        [mid],
      );
      if (marketResult.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const m = marketResult.rows[0];
      if (m.status !== 'resolved') {
        const err = new Error('market_not_resolved'); err.status = 400; throw err;
      }
      if (Number(m.outcome) !== oi) {
        const err = new Error('losing_outcome'); err.status = 400; throw err;
      }

      const positionResult = await client.query(
        `SELECT shares, cost_basis, realized_pnl
         FROM points_positions
         WHERE market_id = $1 AND username = $2 AND outcome_index = $3
         FOR UPDATE`,
        [mid, username, oi],
      );
      if (positionResult.rows.length === 0 || Number(positionResult.rows[0].shares) <= 0) {
        const err = new Error('no_shares_to_redeem'); err.status = 400; throw err;
      }
      const p = positionResult.rows[0];
      const shares = Number(p.shares);
      const payout = shares; // 1 MXNP per winning share

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0 ? Number(balanceResult.rows[0].balance) : 0;
      const newBalance = currentBalance + payout;
      if (balanceResult.rows.length === 0) {
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
          [username, newBalance],
        );
      } else {
        await client.query(
          `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
          [newBalance, username],
        );
      }

      const addedRealized = payout - Number(p.cost_basis);
      const newRealized = Number(p.realized_pnl || 0) + addedRealized;

      await client.query(
        `UPDATE points_positions
         SET shares = 0, cost_basis = 0, realized_pnl = $1, updated_at = NOW()
         WHERE market_id = $2 AND username = $3 AND outcome_index = $4`,
        [newRealized, mid, username, oi],
      );

      await client.query(
        `INSERT INTO points_trades (
           market_id, username, side, outcome_index,
           shares, collateral, fee, price_at_trade
         ) VALUES ($1, $2, 'redeem', $3, $4, $5, 0, 1)`,
        [mid, username, oi, shares, payout],
      );

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'redemption', $3, $4)`,
        [username, payout, mid, `Cobro de ${shares.toFixed(2)} acciones ganadoras`],
      );

      return { balance: newBalance, payout, shares };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/redeem] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'redeem_failed' });
  }
}

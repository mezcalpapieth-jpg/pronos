/**
 * POST /api/points/redeem
 * Body: { marketId, outcomeIndex }
 *
 * Claim winnings after a market has resolved. Each winning share pays
 * 1 MXNP. Losing shares are worth 0. After redemption, the position
 * row's shares column is zeroed out (realized_pnl preserves the record).
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

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
  const oi = parseInt(outcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (![0, 1].includes(oi)) return res.status(400).json({ error: 'invalid_outcome_index' });

  const username = session.username;

  try {
    await ensurePointsSchema(sql);
    await sql.query('BEGIN');

    const marketRows = await sql`
      SELECT id, status, outcome
      FROM points_markets
      WHERE id = ${mid}
      FOR UPDATE
    `;
    if (marketRows.length === 0) {
      await sql.query('ROLLBACK');
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.status !== 'resolved') {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'market_not_resolved' });
    }
    const winningIndex = Number(m.outcome);
    if (winningIndex !== oi) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'losing_outcome' });
    }

    const positionRows = await sql`
      SELECT shares, cost_basis, realized_pnl
      FROM points_positions
      WHERE market_id = ${mid} AND username = ${username} AND outcome_index = ${oi}
      FOR UPDATE
    `;
    if (positionRows.length === 0 || Number(positionRows[0].shares) <= 0) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'no_shares_to_redeem' });
    }
    const p = positionRows[0];
    const shares = Number(p.shares);
    const payout = shares; // 1 MXNP per winning share

    const balanceRows = await sql`
      SELECT balance FROM points_balances WHERE username = ${username} FOR UPDATE
    `;
    const currentBalance = balanceRows.length > 0 ? Number(balanceRows[0].balance) : 0;
    const newBalance = currentBalance + payout;
    if (balanceRows.length === 0) {
      await sql`INSERT INTO points_balances (username, balance) VALUES (${username}, ${newBalance})`;
    } else {
      await sql`UPDATE points_balances SET balance = ${newBalance}, updated_at = NOW() WHERE username = ${username}`;
    }

    // Realized PnL on the redeemed portion = payout − cost basis of those shares.
    const addedRealized = payout - Number(p.cost_basis);
    const newRealized = Number(p.realized_pnl || 0) + addedRealized;

    await sql`
      UPDATE points_positions
      SET shares = 0, cost_basis = 0, realized_pnl = ${newRealized}, updated_at = NOW()
      WHERE market_id = ${mid} AND username = ${username} AND outcome_index = ${oi}
    `;

    await sql`
      INSERT INTO points_trades (
        market_id, username, side, outcome_index,
        shares, collateral, fee, price_at_trade
      ) VALUES (
        ${mid}, ${username}, 'redeem', ${oi},
        ${shares}, ${payout}, 0, 1
      )
    `;

    await sql`
      INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
      VALUES (${username}, ${payout}, 'redemption', ${mid}, 'Cobro de ' || ${String(shares.toFixed(2))} || ' acciones ganadoras')
    `;

    await sql.query('COMMIT');
    return res.status(200).json({
      ok: true,
      balance: newBalance,
      payout,
      shares,
    });
  } catch (e) {
    try { await sql.query('ROLLBACK'); } catch {}
    console.error('[points/redeem] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'redeem_failed' });
  }
}

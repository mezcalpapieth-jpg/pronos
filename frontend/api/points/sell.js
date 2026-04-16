/**
 * POST /api/points/sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Atomic early exit. The user sells `shares` of the given outcome back
 * to the pool and receives collateralOut MXNP. We update:
 *   - market reserves
 *   - user balance (credit)
 *   - points_trades (immutable log, side = 'sell')
 *   - points_positions (reduce shares; attribute sell to realized_pnl)
 *
 * Average-cost accounting: when selling N of M held shares, we keep
 * (M − N) at the original avg cost. realized_pnl += proceeds − avg_cost × N.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binarySellQuote } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `sell:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex, shares } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const n = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (![0, 1].includes(oi)) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'invalid_shares' });

  const username = session.username;

  try {
    await ensurePointsSchema(sql);
    await sql.query('BEGIN');

    const marketRows = await sql`
      SELECT id, status, reserves, end_time
      FROM points_markets
      WHERE id = ${mid}
      FOR UPDATE
    `;
    if (marketRows.length === 0) {
      await sql.query('ROLLBACK');
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.status !== 'active') {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'market_closed' });
    }
    if (m.end_time && new Date(m.end_time) <= new Date()) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'market_expired' });
    }

    const reserves = parseJsonb(m.reserves, []).map(Number);
    if (reserves.length !== 2) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'only_binary_supported' });
    }

    // Lock the position row so a racing sell can't over-withdraw.
    const positionRows = await sql`
      SELECT shares, cost_basis, realized_pnl
      FROM points_positions
      WHERE market_id = ${mid} AND username = ${username} AND outcome_index = ${oi}
      FOR UPDATE
    `;
    if (positionRows.length === 0) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'no_position' });
    }
    const p = positionRows[0];
    const held = Number(p.shares);
    const costBasis = Number(p.cost_basis);
    const realized = Number(p.realized_pnl || 0);
    if (held < n) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'insufficient_shares' });
    }

    // Execute the AMM math
    let quote;
    try {
      quote = binarySellQuote(reserves, oi, n);
    } catch (e) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }

    // Update reserves + balance
    await sql`
      UPDATE points_markets
      SET reserves = ${JSON.stringify(quote.reservesAfter)}::jsonb
      WHERE id = ${mid}
    `;

    const balanceRows = await sql`
      SELECT balance FROM points_balances WHERE username = ${username} FOR UPDATE
    `;
    const currentBalance = balanceRows.length > 0 ? Number(balanceRows[0].balance) : 0;
    const newBalance = currentBalance + quote.collateralOut;
    if (balanceRows.length === 0) {
      await sql`INSERT INTO points_balances (username, balance) VALUES (${username}, ${newBalance})`;
    } else {
      await sql`UPDATE points_balances SET balance = ${newBalance}, updated_at = NOW() WHERE username = ${username}`;
    }

    // Average-cost PnL attribution on the sold portion
    const avgCost = held > 0 ? costBasis / held : 0;
    const soldCostBasis = avgCost * n;
    const addedRealized = quote.collateralOut - soldCostBasis;
    const newShares = held - n;
    const newCostBasis = newShares > 0 ? costBasis - soldCostBasis : 0;
    const newRealized = realized + addedRealized;

    if (newShares <= 0) {
      // Fully exited the position — keep the row so realized_pnl sticks
      // around for reporting, but zero out shares + cost_basis.
      await sql`
        UPDATE points_positions
        SET shares = 0, cost_basis = 0, realized_pnl = ${newRealized}, updated_at = NOW()
        WHERE market_id = ${mid} AND username = ${username} AND outcome_index = ${oi}
      `;
    } else {
      await sql`
        UPDATE points_positions
        SET shares = ${newShares}, cost_basis = ${newCostBasis},
            realized_pnl = ${newRealized}, updated_at = NOW()
        WHERE market_id = ${mid} AND username = ${username} AND outcome_index = ${oi}
      `;
    }

    await sql`
      INSERT INTO points_trades (
        market_id, username, side, outcome_index,
        shares, collateral, fee, price_at_trade,
        reserves_before, reserves_after
      ) VALUES (
        ${mid}, ${username}, 'sell', ${oi},
        ${n}, ${quote.collateralOut}, ${quote.fee}, ${quote.priceBefore || 0},
        ${JSON.stringify(reserves)}::jsonb,
        ${JSON.stringify(quote.reservesAfter)}::jsonb
      )
    `;

    await sql`
      INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
      VALUES (${username}, ${quote.collateralOut}, 'trade_sell', ${mid}, 'Venta anticipada de ' || ${String(n.toFixed(2))} || ' acciones')
    `;

    await sql.query('COMMIT');

    return res.status(200).json({
      ok: true,
      balance: newBalance,
      collateralOut: quote.collateralOut,
      sharesSold: n,
      realizedPnl: addedRealized,
      priceBefore: quote.priceBefore,
      priceAfter: quote.priceAfter,
    });
  } catch (e) {
    try { await sql.query('ROLLBACK'); } catch {}
    console.error('[points/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}

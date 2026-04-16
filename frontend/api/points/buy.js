/**
 * POST /api/points/buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Atomic trade:
 *   1. Lock the user and the market row
 *   2. Verify balance >= collateral, market active, deadline not passed
 *   3. Quote the buy (server-side AMM math — authoritative)
 *   4. Apply reserves delta on points_markets
 *   5. Debit balance, insert trade row, upsert position (average-cost basis)
 *   6. Log distribution for audit
 *
 * All of steps 4–6 run inside a Postgres transaction so partial failure
 * never leaves half-applied state.
 *
 * Returns: { ok, balance, shares, fee, sharesOut, priceAfter }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryBuyQuote } from '../_lib/amm-math.js';
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

  // Trade endpoints: 30/min/IP is well above normal UX patterns (a user
  // clicking buy multiple times per minute is unusual) but blocks brute-force
  // AMM probing.
  const limited = rateLimit(req, res, {
    key: `buy:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) {
    return res.status(400).json({ error: 'username_required' });
  }

  const { marketId, outcomeIndex, collateral } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (![0, 1].includes(oi)) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'invalid_amount' });

  const username = session.username;

  try {
    await ensurePointsSchema(sql);
    await sql.query('BEGIN');

    // Lock the market row first, then the balance row. Consistent lock order
    // across buy/sell/redeem prevents deadlock.
    const marketRows = await sql`
      SELECT id, status, outcome, reserves, end_time
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

    const balanceRows = await sql`
      SELECT balance
      FROM points_balances
      WHERE username = ${username}
      FOR UPDATE
    `;
    const currentBalance = balanceRows.length > 0 ? Number(balanceRows[0].balance) : 0;
    if (currentBalance < amt) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'insufficient_balance' });
    }

    // Compute the authoritative trade via AMM math
    let quote;
    try {
      quote = binaryBuyQuote(reserves, oi, amt);
    } catch (e) {
      await sql.query('ROLLBACK');
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }

    // Persist: market reserves, user balance, trade row, position.
    await sql`
      UPDATE points_markets
      SET reserves = ${JSON.stringify(quote.reservesAfter)}::jsonb
      WHERE id = ${mid}
    `;

    const newBalance = currentBalance - amt;
    await sql`
      UPDATE points_balances
      SET balance = ${newBalance}, updated_at = NOW()
      WHERE username = ${username}
    `;

    await sql`
      INSERT INTO points_trades (
        market_id, username, side, outcome_index,
        shares, collateral, fee, price_at_trade,
        reserves_before, reserves_after
      ) VALUES (
        ${mid}, ${username}, 'buy', ${oi},
        ${quote.sharesOut}, ${amt}, ${quote.fee}, ${quote.avgPrice},
        ${JSON.stringify(reserves)}::jsonb,
        ${JSON.stringify(quote.reservesAfter)}::jsonb
      )
    `;

    // Position upsert — maintain running shares + cost basis.
    await sql`
      INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis)
      VALUES (${mid}, ${username}, ${oi}, ${quote.sharesOut}, ${amt})
      ON CONFLICT (market_id, username, outcome_index) DO UPDATE
      SET shares     = points_positions.shares + EXCLUDED.shares,
          cost_basis = points_positions.cost_basis + EXCLUDED.cost_basis,
          updated_at = NOW()
    `;

    await sql`
      INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
      VALUES (${username}, ${-amt}, 'trade_buy', ${mid}, 'Compra de ' || ${String(quote.sharesOut.toFixed(2))} || ' acciones')
    `;

    await sql.query('COMMIT');

    return res.status(200).json({
      ok: true,
      balance: newBalance,
      shares: quote.sharesOut,
      fee: quote.fee,
      sharesOut: quote.sharesOut,
      priceBefore: quote.priceBefore,
      priceAfter: quote.priceAfter,
    });
  } catch (e) {
    try { await sql.query('ROLLBACK'); } catch {}
    console.error('[points/buy] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'buy_failed' });
  }
}

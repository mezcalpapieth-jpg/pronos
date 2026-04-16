/**
 * POST /api/points/buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Atomic buy: read state with row locks, validate, compute AMM math,
 * write derived state — all inside a single Postgres transaction.
 * Uses the Pool-backed withTransaction helper because Neon's HTTP
 * client cannot carry session state across separate queries.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryBuyQuote } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';

// Lightweight HTTP client used only to run the idempotent schema bootstrap.
// Transactional work goes through withTransaction() which uses a WS Pool.
const schemaSql = neon(process.env.DATABASE_URL);

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
    key: `buy:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex, collateral } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (![0, 1].includes(oi))                return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ error: 'invalid_amount' });

  const username = session.username;

  try {
    // Schema bootstrapping is idempotent and safe outside the transaction —
    // it just makes sure the tables exist on first invocation.
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      // Lock the market row first, then the position row — consistent lock
      // order across buy/sell prevents deadlocks.
      const marketResult = await client.query(
        `SELECT id, status, reserves, end_time
         FROM points_markets
         WHERE id = $1
         FOR UPDATE`,
        [mid],
      );
      if (marketResult.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const m = marketResult.rows[0];
      if (m.status !== 'active') {
        const err = new Error('market_closed'); err.status = 400; throw err;
      }
      if (m.end_time && new Date(m.end_time) <= new Date()) {
        const err = new Error('market_expired'); err.status = 400; throw err;
      }
      const reserves = parseJsonb(m.reserves, []).map(Number);
      if (reserves.length !== 2) {
        const err = new Error('only_binary_supported'); err.status = 400; throw err;
      }

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0
        ? Number(balanceResult.rows[0].balance)
        : 0;
      if (currentBalance < amt) {
        const err = new Error('insufficient_balance'); err.status = 400; throw err;
      }

      let quote;
      try {
        quote = binaryBuyQuote(reserves, oi, amt);
      } catch (e) {
        const err = new Error('invalid_quote'); err.status = 400; err.detail = e.message; throw err;
      }

      // Persist reserves + balance + trade + position + audit log.
      await client.query(
        `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
        [JSON.stringify(quote.reservesAfter), mid],
      );

      const newBalance = currentBalance - amt;
      await client.query(
        `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
        [newBalance, username],
      );

      await client.query(
        `INSERT INTO points_trades (
           market_id, username, side, outcome_index,
           shares, collateral, fee, price_at_trade,
           reserves_before, reserves_after
         ) VALUES ($1, $2, 'buy', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [
          mid, username, oi,
          quote.sharesOut, amt, quote.fee, quote.avgPrice,
          JSON.stringify(reserves),
          JSON.stringify(quote.reservesAfter),
        ],
      );

      await client.query(
        `INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (market_id, username, outcome_index) DO UPDATE
         SET shares     = points_positions.shares + EXCLUDED.shares,
             cost_basis = points_positions.cost_basis + EXCLUDED.cost_basis,
             updated_at = NOW()`,
        [mid, username, oi, quote.sharesOut, amt],
      );

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'trade_buy', $3, $4)`,
        [
          username,
          -amt,
          mid,
          `Compra de ${quote.sharesOut.toFixed(2)} acciones`,
        ],
      );

      return {
        balance: newBalance,
        sharesOut: quote.sharesOut,
        fee: quote.fee,
        priceBefore: quote.priceBefore,
        priceAfter: quote.priceAfter,
      };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    // Structured errors from inside the transaction carry `.status` so we
    // echo them back with a matching HTTP code.
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/buy] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'buy_failed' });
  }
}

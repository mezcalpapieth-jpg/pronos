/**
 * POST /api/points/sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Atomic early exit. User sells `shares` of their held outcome back to
 * the pool. Runs inside a single Postgres transaction so reserve /
 * balance / position / trade / distribution all commit together.
 *
 * Average-cost accounting for realized PnL:
 *   avgCost          = costBasis / sharesHeld
 *   soldCostBasis    = avgCost × sharesSold
 *   addedRealizedPnl = proceeds − soldCostBasis
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binarySellQuote, multiSellQuote } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';

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
  const oi  = parseInt(outcomeIndex, 10);
  const n   = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  // Upper bound on oi is enforced once we read the market's reserves length.
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0)       return res.status(400).json({ error: 'invalid_shares' });

  const username = session.username;

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
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
      // AMM dispatch, same rules as buy.js: N=2 binary, N≥3 unified multi.
      if (reserves.length < 2) {
        const err = new Error('degenerate_reserves'); err.status = 400; throw err;
      }
      if (oi >= reserves.length) {
        const err = new Error('invalid_outcome_index'); err.status = 400; throw err;
      }

      const positionResult = await client.query(
        `SELECT shares, cost_basis, realized_pnl
         FROM points_positions
         WHERE market_id = $1 AND username = $2 AND outcome_index = $3
         FOR UPDATE`,
        [mid, username, oi],
      );
      if (positionResult.rows.length === 0) {
        const err = new Error('no_position'); err.status = 400; throw err;
      }
      const p = positionResult.rows[0];
      const held = Number(p.shares);
      const costBasis = Number(p.cost_basis);
      const realized = Number(p.realized_pnl || 0);
      if (held < n) {
        const err = new Error('insufficient_shares'); err.status = 400; throw err;
      }

      let quote;
      try {
        quote = reserves.length === 2
          ? binarySellQuote(reserves, oi, n)
          : multiSellQuote(reserves, oi, n);
      } catch (e) {
        const err = new Error('invalid_quote'); err.status = 400; err.detail = e.message; throw err;
      }

      // Reserves + balance
      await client.query(
        `UPDATE points_markets SET reserves = $1::jsonb WHERE id = $2`,
        [JSON.stringify(quote.reservesAfter), mid],
      );

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0 ? Number(balanceResult.rows[0].balance) : 0;
      const newBalance = currentBalance + quote.collateralOut;
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

      // Average-cost realized PnL
      const avgCost = held > 0 ? costBasis / held : 0;
      const soldCostBasis = avgCost * n;
      const addedRealized = quote.collateralOut - soldCostBasis;
      const newShares = held - n;
      const newCostBasis = newShares > 0 ? costBasis - soldCostBasis : 0;
      const newRealized = realized + addedRealized;

      await client.query(
        `UPDATE points_positions
         SET shares       = $1,
             cost_basis   = $2,
             realized_pnl = $3,
             updated_at   = NOW()
         WHERE market_id = $4 AND username = $5 AND outcome_index = $6`,
        [newShares, newCostBasis, newRealized, mid, username, oi],
      );

      await client.query(
        `INSERT INTO points_trades (
           market_id, username, side, outcome_index,
           shares, collateral, fee, price_at_trade,
           reserves_before, reserves_after
         ) VALUES ($1, $2, 'sell', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [
          mid, username, oi,
          n, quote.collateralOut, quote.fee, quote.priceBefore || 0,
          JSON.stringify(reserves),
          JSON.stringify(quote.reservesAfter),
        ],
      );

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
         VALUES ($1, $2, 'trade_sell', $3, $4)`,
        [username, quote.collateralOut, mid, `Venta anticipada de ${n.toFixed(2)} acciones`],
      );

      return {
        balance: newBalance,
        collateralOut: quote.collateralOut,
        sharesSold: n,
        realizedPnl: addedRealized,
        priceBefore: quote.priceBefore,
        priceAfter: quote.priceAfter,
      };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}

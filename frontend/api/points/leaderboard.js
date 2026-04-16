/**
 * GET /api/points/leaderboard
 *
 * Top predictors ranked by total PnL (realized + unrealized on active
 * positions). Rewards actual prediction skill rather than hoarding
 * daily-claim bonuses — matches the product decision.
 *
 * Unauthenticated caller gets the public leaderboard. Authenticated
 * caller additionally receives their own rank + PnL.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';
import { readSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await ensurePointsSchema(schemaSql);

    // For each user, compute:
    //   realized = Σ realized_pnl across positions
    //   unrealized = Σ (shares × currentPrice − cost_basis) on active markets
    //
    // Pulled in two queries so we can compute unrealized client-side
    // using binaryPrices on the reserves snapshot.
    const realizedRows = await sql`
      SELECT username, COALESCE(SUM(realized_pnl), 0) AS realized
      FROM points_positions
      GROUP BY username
    `;

    const activeRows = await sql`
      SELECT p.username, p.outcome_index, p.shares, p.cost_basis,
             m.status, m.outcome, m.reserves, m.outcomes
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      WHERE p.shares > 0
    `;

    const byUser = new Map();
    for (const r of realizedRows) {
      byUser.set(r.username, {
        username: r.username,
        realized: Number(r.realized || 0),
        unrealized: 0,
      });
    }
    for (const r of activeRows) {
      const u = byUser.get(r.username) || {
        username: r.username,
        realized: 0,
        unrealized: 0,
      };
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = reserves.length === 2
        ? binaryPrices(reserves)
        : outcomes.map((_, i) => 1 / outcomes.length);
      let currentPrice;
      if (r.status === 'resolved') {
        currentPrice = Number(r.outcome) === r.outcome_index ? 1.0 : 0.0;
      } else {
        currentPrice = prices[r.outcome_index] ?? 0.5;
      }
      const mtm = Number(r.shares) * currentPrice;
      u.unrealized += mtm - Number(r.cost_basis);
      byUser.set(r.username, u);
    }

    const ranked = Array.from(byUser.values())
      .map(u => ({
        username: u.username,
        realizedPnl: round2(u.realized),
        unrealizedPnl: round2(u.unrealized),
        pnl: round2(u.realized + u.unrealized),
      }))
      .sort((a, b) => b.pnl - a.pnl);

    const top = ranked.slice(0, 10).map((u, i) => ({ rank: i + 1, ...u }));

    // If signed in, include the caller's rank (even if outside top 10).
    let me = null;
    const session = readSession(req, res);
    if (session?.username) {
      const idx = ranked.findIndex(u => u.username === session.username);
      if (idx >= 0) {
        me = { rank: idx + 1, ...ranked[idx] };
      } else {
        me = { rank: null, username: session.username, realizedPnl: 0, unrealizedPnl: 0, pnl: 0 };
      }
    }

    return res.status(200).json({
      top,
      me,
      totalParticipants: ranked.length,
    });
  } catch (e) {
    console.error('[points/leaderboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
}

/**
 * GET /api/points/positions
 * Returns: { positions: [...], summary: {...} }
 *
 * Lists all non-zero positions for the authenticated user. For each:
 *   - Current prices from live market reserves
 *   - currentValue (marked-to-market for active markets)
 *   - unrealizedPnl, realizedPnl, combined pnl
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';
import { requireSession } from '../_lib/session.js';

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

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const username = session.username;
  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
             m.question, m.category, m.outcomes, m.reserves, m.status, m.outcome, m.end_time
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      WHERE p.username = ${username} AND p.shares > 0
      ORDER BY
        CASE m.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
        m.end_time ASC
    `;

    const positions = rows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = reserves.length === 2 ? binaryPrices(reserves) : outcomes.map((_, i) => 1 / outcomes.length);
      const shares = Number(r.shares);
      const costBasis = Number(r.cost_basis);
      const realized = Number(r.realized_pnl || 0);

      let currentPrice;
      if (r.status === 'resolved') {
        currentPrice = Number(r.outcome) === r.outcome_index ? 1.0 : 0.0;
      } else {
        currentPrice = prices[r.outcome_index] ?? 0.5;
      }
      const currentValue = shares * currentPrice;
      const unrealized = currentValue - costBasis;

      return {
        marketId: r.market_id,
        outcomeIndex: r.outcome_index,
        outcomeLabel: outcomes[r.outcome_index] || `Opción ${r.outcome_index + 1}`,
        question: r.question,
        category: r.category,
        status: r.status,
        endTime: r.end_time,
        shares,
        costBasis: round2(costBasis),
        currentPrice,
        currentValue: round2(currentValue),
        unrealizedPnl: round2(unrealized),
        realizedPnl: round2(realized),
        pnl: round2(unrealized + realized),
        canRedeem: r.status === 'resolved' && Number(r.outcome) === r.outcome_index,
      };
    });

    const active = positions.filter(p => p.status === 'active');
    const totalInvested = active.reduce((s, p) => s + p.costBasis, 0);
    const totalValue    = active.reduce((s, p) => s + p.currentValue, 0);
    const unrealized    = totalValue - totalInvested;
    const realized      = positions.reduce((s, p) => s + p.realizedPnl, 0);

    return res.status(200).json({
      positions,
      summary: {
        totalPositions: positions.length,
        activePositions: active.length,
        totalInvested: round2(totalInvested),
        currentValue: round2(totalValue),
        pnl: round2(unrealized + realized),
        unrealizedPnl: round2(unrealized),
        realizedPnl: round2(realized),
      },
    });
  } catch (e) {
    console.error('[points/positions] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'positions_failed' });
  }
}

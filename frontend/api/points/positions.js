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
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
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
    // Positions sit on leg ids for parallel markets, so we LEFT JOIN the
    // parent row to pick up the group-level question / category for
    // display. Unified markets have parent = NULL — the join yields NULL
    // and we fall back to the leg row's own fields (which are the real
    // market's fields for unified).
    const rows = await sql`
      SELECT p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
             m.question   AS m_question,
             m.category   AS m_category,
             m.outcomes   AS m_outcomes,
             m.reserves, m.status, m.outcome, m.end_time,
             m.amm_mode, m.parent_id, m.leg_label,
             pm.id        AS parent_id_val,
             pm.question  AS parent_question,
             pm.category  AS parent_category,
             pm.outcomes  AS parent_outcomes
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE p.username = ${username}
        AND p.shares > 0
        AND p.dismissed_at IS NULL
      ORDER BY
        CASE m.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
        m.end_time ASC
    `;

    const positions = rows.map(r => {
      const isParallelLeg = !!r.parent_id_val;
      const outcomes = parseJsonb(r.m_outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = reserves.length === 2
        ? binaryPrices(reserves)
        : reserves.length >= 2
          ? multiPrices(reserves)
          : outcomes.map(() => 1 / (outcomes.length || 2));
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

      // Display question + label:
      //   Unified: "Question?" / outcomeLabel
      //   Parallel leg: "Parent question?" / "<leg label> — Sí|No"
      const question = isParallelLeg ? r.parent_question : r.m_question;
      const category = isParallelLeg ? r.parent_category : r.m_category;
      const outcomeLabel = isParallelLeg
        ? `${r.leg_label || 'Opción'} — ${r.outcome_index === 0 ? 'Sí' : 'No'}`
        : (outcomes[r.outcome_index] || `Opción ${r.outcome_index + 1}`);

      return {
        marketId: r.market_id,
        parentMarketId: r.parent_id_val || null,
        outcomeIndex: r.outcome_index,
        outcomeLabel,
        question,
        category,
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

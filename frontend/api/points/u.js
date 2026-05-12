/**
 * GET /api/points/u?username=<name>
 *
 * Public read-only profile for a single user. No auth required — the
 * data here is the same thing the leaderboard already surfaces, just
 * scoped to one user with a few extra fields (active positions, the
 * markets they've traded historically, aggregate PnL).
 *
 * This is intentionally distinct from /api/points/positions and
 * /api/points/history, which require a session and only return the
 * logged-in user's own data. The public endpoint:
 *   - takes ?username= from the query string,
 *   - returns NOTHING that a logged-in user's session response
 *     wouldn't already expose to the leaderboard (no email, wallet
 *     address, balance ledger, or anything sensitive),
 *   - 404s on unknown usernames so we don't leak existence by
 *     timing differences between unknown / empty users.
 *
 * Response:
 *   {
 *     user: { username, joinedAt, totalVolume },
 *     stats: { totalPnl, marketsTraded, marketsWon, marketsOpen, winRate },
 *     active: [{ marketId, question, category, outcomeIndex, outcomeLabel,
 *                shares, costBasis, currentValue, unrealizedPnl, ... }],
 *     history: [{ marketId, question, category, outcomeStatus, netPnl,
 *                 trades: [...], resolvedAt, finalScore }]
 *   }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';

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

function labelFor(outcomes, i) {
  if (!Array.isArray(outcomes)) return '—';
  return outcomes[i] || `Opción ${i + 1}`;
}

function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  return multiPrices(reserves);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const raw = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!raw) return res.status(400).json({ error: 'username_required' });
  // Normalize the same way the username column is stored (lowercase).
  // Without this a search for "Mezcal" misses the row that's stored as
  // "mezcal", and the page shows "user not found" for a user who exists.
  const username = raw.toLowerCase().slice(0, 32);

  try {
    await ensurePointsSchema(schemaSql);

    // Confirm the user exists. We treat absence as 404 — same response
    // shape as MVP /api/user, no information leak about other rows.
    const userRow = await sql`
      SELECT username, created_at
      FROM points_users
      WHERE username = ${username}
      LIMIT 1
    `;
    if (userRow.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // ── Active positions ──────────────────────────────────────────────
    // Mirrors /api/points/positions but auth-less. Only 'points' mode
    // (off-chain) — the on-chain MVP profile is a different beast.
    const positionRows = await sql`
      SELECT p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
             m.question, m.category, m.outcomes, m.reserves, m.status,
             m.outcome AS m_outcome, m.end_time, m.resolved_at,
             m.parent_id, m.leg_label,
             pm.question AS parent_question,
             pm.category AS parent_category
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE p.username = ${username}
        AND p.shares > 0
        AND COALESCE(m.mode, 'points') = 'points'
        AND m.status = 'active'
    `;

    const active = positionRows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);
      const shares = Number(r.shares);
      const currentValue = shares * (prices[r.outcome_index] ?? 0);
      const costBasis = Number(r.cost_basis || 0);
      const unrealizedPnl = currentValue - costBasis;
      // Parallel-leg markets: surface the parent question so the row
      // reads as "¿Quién gana el grupo? — México" instead of the leg's
      // raw "Sí/No" question. leg_label is set on the points_markets
      // row when it's a leg of a parallel parent.
      const isLeg = !!r.parent_id;
      const displayQuestion = isLeg && r.parent_question
        ? `${r.parent_question}${r.leg_label ? ` — ${r.leg_label}` : ''}`
        : r.question;
      return {
        marketId: r.market_id,
        question: displayQuestion,
        category: r.parent_category || r.category,
        outcomeIndex: r.outcome_index,
        outcomeLabel: labelFor(outcomes, r.outcome_index),
        shares: round2(shares),
        costBasis: round2(costBasis),
        currentValue: round2(currentValue),
        unrealizedPnl: round2(unrealizedPnl),
        realizedPnl: round2(Number(r.realized_pnl || 0)),
        endTime: r.end_time,
      };
    });

    // ── History (settled + exited) ────────────────────────────────────
    // Per-market: roll up all of this user's trades on each market and
    // compute net PnL. Mirrors what /api/points/history does but
    // intentionally lighter — no per-trade list, just the summary
    // numbers the profile card needs.
    const tradeRows = await sql`
      SELECT t.market_id, t.side, t.outcome_index, t.shares, t.collateral,
             t.fee, t.price_at_trade, t.created_at,
             m.question, m.category, m.outcomes, m.status,
             m.outcome AS m_outcome, m.end_time, m.resolved_at, m.final_score,
             m.parent_id, m.leg_label, pm.question AS parent_question
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE t.username = ${username}
        AND COALESCE(m.mode, 'points') = 'points'
      ORDER BY t.created_at ASC
    `;

    const byMarket = new Map();
    for (const r of tradeRows) {
      const mid = r.market_id;
      if (!byMarket.has(mid)) {
        byMarket.set(mid, {
          marketId: mid,
          question: r.parent_question
            ? `${r.parent_question}${r.leg_label ? ` — ${r.leg_label}` : ''}`
            : r.question,
          category: r.category,
          status: r.status,
          marketOutcome: r.m_outcome,
          endTime: r.end_time,
          resolvedAt: r.resolved_at,
          finalScore: r.final_score,
          outcomeIndex: r.outcome_index,
          buyCollateral: 0,
          buyShares: 0,
          buyFees: 0,
          sellProceeds: 0,
          sellShares: 0,
          sellFees: 0,
        });
      }
      const slot = byMarket.get(mid);
      const collateral = Number(r.collateral || 0);
      const fee        = Number(r.fee || 0);
      const shares     = Number(r.shares || 0);
      if (r.side === 'buy') {
        slot.buyCollateral += collateral;
        slot.buyShares     += shares;
        slot.buyFees       += fee;
      } else {
        slot.sellProceeds += collateral;
        slot.sellShares   += shares;
        slot.sellFees     += fee;
      }
    }

    const history = Array.from(byMarket.values()).map(m => {
      const sharesHeld = m.buyShares - m.sellShares;
      let outcomeStatus = 'open';
      let netPnl = 0;
      if (m.status === 'resolved') {
        const won = m.marketOutcome === m.outcomeIndex;
        outcomeStatus = won ? 'won' : 'lost';
        // Won → unredeemed shares pay 1 MXNP each. Lost → 0.
        const redeemValue = won ? sharesHeld : 0;
        netPnl = (m.sellProceeds + redeemValue) - m.buyCollateral - m.buyFees - m.sellFees;
      } else if (sharesHeld <= 0.0001) {
        // Fully exited an active market.
        outcomeStatus = 'exited';
        netPnl = m.sellProceeds - m.buyCollateral - m.buyFees - m.sellFees;
      } else if (m.endTime && new Date(m.endTime).getTime() < Date.now()) {
        outcomeStatus = 'pending';
        netPnl = m.sellProceeds - m.buyCollateral - m.buyFees - m.sellFees;
      } else {
        outcomeStatus = 'open';
        netPnl = m.sellProceeds - m.buyCollateral - m.buyFees - m.sellFees;
      }
      return {
        marketId: m.marketId,
        question: m.question,
        category: m.category,
        outcomeStatus,
        netPnl: round2(netPnl),
        buyCollateral: round2(m.buyCollateral),
        sellProceeds: round2(m.sellProceeds),
        resolvedAt: m.resolvedAt,
        finalScore: m.finalScore,
      };
    });

    history.sort((a, b) => {
      // Resolved first by recency, then everything else.
      const ar = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0;
      const br = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0;
      return br - ar;
    });

    // ── Aggregate stats ───────────────────────────────────────────────
    const totalPnl = history.reduce((s, m) => s + m.netPnl, 0);
    const totalVolume = history.reduce((s, m) => s + m.buyCollateral, 0);
    const won  = history.filter(m => m.outcomeStatus === 'won').length;
    const lost = history.filter(m => m.outcomeStatus === 'lost').length;
    const open = history.filter(m => m.outcomeStatus === 'open').length;
    const settled = won + lost;
    const winRate = settled > 0 ? round2((won / settled) * 100) : null;

    return res.status(200).json({
      user: {
        username: userRow[0].username,
        joinedAt: userRow[0].created_at,
        totalVolume: round2(totalVolume),
      },
      stats: {
        totalPnl: round2(totalPnl),
        marketsTraded: history.length,
        marketsWon: won,
        marketsLost: lost,
        marketsOpen: open,
        winRate, // null when nothing has settled
      },
      active,
      history,
    });
  } catch (e) {
    console.error('[points/u] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'profile_failed' });
  }
}

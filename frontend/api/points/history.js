/**
 * GET /api/points/history
 *
 * Per-market trade history for the authenticated user. Mirrors the MVP
 * Historial tab output so the frontend HistoryTab-style UI can reuse the
 * same shape: per-market status (won / lost / pending / exited / open),
 * expandable transaction list, running PnL.
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

function labelFor(outcomes, i) {
  if (!Array.isArray(outcomes)) return '—';
  return outcomes[i] || `Opción ${i + 1}`;
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
      SELECT t.id, t.market_id, t.side, t.outcome_index, t.shares,
             t.collateral, t.fee, t.price_at_trade, t.created_at,
             m.question, m.category, m.outcomes, m.reserves,
             m.status, m.outcome, m.end_time, m.resolved_at
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      WHERE t.username = ${username}
      ORDER BY t.created_at ASC
    `;

    const markets = new Map();
    for (const r of rows) {
      const mid = r.market_id;
      if (!markets.has(mid)) {
        const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
        const reserves = parseJsonb(r.reserves, []).map(Number);
        markets.set(mid, {
          marketId: mid,
          question: r.question,
          category: r.category,
          status: r.status,
          outcome: r.outcome,
          outcomes,
          reserves,
          endTime: r.end_time,
          resolvedAt: r.resolved_at,
          transactions: [],
          totalInvested: 0,
          totalReceived: 0,
          // heldByOutcome tracks gross exposure at resolution time —
          // buys add, sells subtract, but redeem does NOT reset to 0.
          // That way "did the user hold winning shares at resolution?"
          // stays answerable after they claim. redeemedByOutcome is
          // carried separately for computing currently-held.
          heldByOutcome: new Map(),
          redeemedByOutcome: new Map(),
        });
      }
      const bucket = markets.get(mid);

      const shares = Number(r.shares);
      const collateral = Number(r.collateral);
      const oi = Number(r.outcome_index);

      if (r.side === 'buy') {
        bucket.totalInvested += collateral;
        const prev = bucket.heldByOutcome.get(oi) || 0;
        bucket.heldByOutcome.set(oi, prev + shares);
      } else if (r.side === 'sell') {
        bucket.totalReceived += collateral;
        const prev = bucket.heldByOutcome.get(oi) || 0;
        bucket.heldByOutcome.set(oi, Math.max(0, prev - shares));
      } else if (r.side === 'redeem') {
        bucket.totalReceived += collateral;
        const prev = bucket.redeemedByOutcome.get(oi) || 0;
        bucket.redeemedByOutcome.set(oi, prev + shares);
      }

      bucket.transactions.push({
        id: r.id,
        side: r.side,
        outcomeIndex: oi,
        outcomeLabel: labelFor(bucket.outcomes, oi),
        shares,
        collateral,
        fee: Number(r.fee || 0),
        priceAtTrade: Number(r.price_at_trade || 0),
        createdAt: r.created_at,
      });
    }

    const history = Array.from(markets.values()).map(m => {
      // currentHeld[oi] = heldByOutcome[oi] − redeemedByOutcome[oi]. Users
      // with no unredeemed, unsold shares have currentHeld=0 across the
      // board — they "exited".
      let stillHeld = false;
      for (const [oi, held] of m.heldByOutcome.entries()) {
        const net = held - (m.redeemedByOutcome.get(oi) || 0);
        if (net > 0.000001) { stillHeld = true; break; }
      }

      let outcomeStatus = 'open';
      if (m.status === 'resolved') {
        const winningIdx = Number(m.outcome);
        // Did they hold winning shares at resolution time? heldByOutcome
        // isn't zeroed on redeem so this captures both "already claimed"
        // and "still holding" — both are wins.
        const winningGross = m.heldByOutcome.get(winningIdx) || 0;
        let anyGross = false;
        for (const v of m.heldByOutcome.values()) {
          if (v > 0.000001) { anyGross = true; break; }
        }
        if (winningGross > 0.000001) outcomeStatus = 'won';
        else if (anyGross) outcomeStatus = 'lost';
        else outcomeStatus = 'exited';
      } else if (!stillHeld) {
        outcomeStatus = 'exited';
      } else {
        const end = m.endTime ? new Date(m.endTime).getTime() : null;
        if (end && end <= Date.now()) outcomeStatus = 'pending';
        else outcomeStatus = 'open';
      }

      const netPnl = round2(m.totalReceived - m.totalInvested);
      // Snapshot of unsold shares' mark-to-market for "open" rows
      if (outcomeStatus === 'open' || outcomeStatus === 'pending') {
        const reserves = m.reserves;
        const prices = Array.isArray(reserves) && reserves.length === 2
          ? binaryPrices(reserves)
          : m.outcomes.map((_, i) => 1 / m.outcomes.length);
        let mtm = 0;
        for (const [oi, held] of m.heldByOutcome.entries()) {
          mtm += held * (prices[oi] ?? 0);
        }
        return {
          marketId: m.marketId,
          question: m.question,
          category: m.category,
          status: m.status,
          outcomeStatus,
          totalInvested: round2(m.totalInvested),
          totalReceived: round2(m.totalReceived),
          markToMarket: round2(mtm),
          netPnl,
          transactions: m.transactions,
        };
      }
      return {
        marketId: m.marketId,
        question: m.question,
        category: m.category,
        status: m.status,
        outcomeStatus,
        totalInvested: round2(m.totalInvested),
        totalReceived: round2(m.totalReceived),
        netPnl,
        transactions: m.transactions,
      };
    });

    // Stable sort: open → pending → others newest first
    const priority = { open: 0, pending: 1, won: 2, lost: 2, exited: 2 };
    history.sort((a, b) => {
      const pa = priority[a.outcomeStatus] ?? 3;
      const pb = priority[b.outcomeStatus] ?? 3;
      if (pa !== pb) return pa - pb;
      const lastA = a.transactions[a.transactions.length - 1]?.createdAt || 0;
      const lastB = b.transactions[b.transactions.length - 1]?.createdAt || 0;
      return new Date(lastB) - new Date(lastA);
    });

    const totalPnl = history.reduce((s, m) => s + m.netPnl, 0);

    return res.status(200).json({
      history,
      summary: {
        totalPnl: round2(totalPnl),
        marketsTotal: history.length,
        marketsWon: history.filter(m => m.outcomeStatus === 'won').length,
        marketsLost: history.filter(m => m.outcomeStatus === 'lost').length,
        marketsExited: history.filter(m => m.outcomeStatus === 'exited').length,
        marketsOpen: history.filter(m => m.outcomeStatus === 'open').length,
        marketsPending: history.filter(m => m.outcomeStatus === 'pending').length,
      },
    });
  } catch (e) {
    console.error('[points/history] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'history_failed' });
  }
}

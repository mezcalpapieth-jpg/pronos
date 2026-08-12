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
import { createApiTimer } from '../_lib/api-performance.js';

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

function parseCycleScope(value) {
  const raw = String(value || 'current').toLowerCase();
  if (raw === 'previous' || raw === 'all') return raw;
  return 'current';
}

function emptyHistoryPayload(cycle = null) {
  return {
    history: [],
    summary: {
      totalPnl: 0,
      marketsTotal: 0,
      marketsWon: 0,
      marketsLost: 0,
      marketsCanceled: 0,
      marketsExited: 0,
      marketsOpen: 0,
      marketsPending: 0,
      marketsCycleClosed: 0,
    },
    cycle,
  };
}

async function resolveCycleWindow(scope) {
  if (scope === 'all') {
    return { scope: 'all', fromIso: null, toIso: null, empty: false };
  }

  if (scope === 'previous') {
    const rows = await sql`
      SELECT id, label, started_at, ends_at, closed_at
      FROM points_cycles
      WHERE status = 'closed'
      ORDER BY closed_at DESC NULLS LAST, ends_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { scope, empty: true };
    return {
      scope,
      id: row.id,
      label: row.label || null,
      fromIso: row.started_at,
      toIso: row.closed_at || row.ends_at,
      empty: false,
    };
  }

  const rows = await sql`
    SELECT id, label, started_at, ends_at, closed_at
    FROM points_cycles
    WHERE status = 'active'
    ORDER BY ends_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { scope: 'current', empty: true };
  return {
    scope: 'current',
    id: row.id,
    label: row.label || null,
    fromIso: row.started_at,
    toIso: null,
    empty: false,
  };
}

function pickedOutcomeSummary(transactions = []) {
  const picked = new Map();
  for (const tx of transactions) {
    if (tx?.side !== 'buy') continue;
    const label = String(tx.outcomeLabel || '').trim();
    if (!label || label === '—') continue;
    const key = Number.isInteger(Number(tx.outcomeIndex))
      ? String(tx.outcomeIndex)
      : label.toLowerCase();
    const current = picked.get(key) || { label, collateral: 0, shares: 0 };
    current.collateral += Number(tx.collateral || 0);
    current.shares += Number(tx.shares || 0);
    picked.set(key, current);
  }

  const labels = Array.from(picked.values())
    .sort((a, b) => (b.collateral - a.collateral) || (b.shares - a.shares))
    .map(item => item.label);

  return {
    pickedOutcomeLabels: labels,
    pickedOutcomeLabel: labels.join(', '),
  };
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/history');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });
  const username = session.username;
  // Mode filter — same split as /api/points/positions. Default 'points'
  // so the Points app only sees off-chain trades; MVP passes 'onchain'.
  const modeParam = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : '';
  const modeFilter = modeParam === 'onchain' ? 'onchain'
                    : modeParam === 'all'    ? null
                    : 'points';
  const cycleScope = parseCycleScope(req.query.cycle);

  try {
    await timer.time('schema', () => ensurePointsSchema(schemaSql));
    const cycleWindow = await timer.time('db_cycle', () => resolveCycleWindow(cycleScope));
    if (cycleWindow.empty) {
      timer.end({ history: 0, trades: 0, refunds: 0, cycle: cycleWindow.scope });
      return res.status(200).json(emptyHistoryPayload(cycleWindow));
    }

    const rows = await timer.time('db_trades', () => sql`
      SELECT t.id, t.market_id, t.side, t.outcome_index, t.shares,
             t.collateral, t.fee, t.price_at_trade, t.tx_hash, t.created_at,
             m.parent_id, m.question, m.category, m.outcomes, m.reserves,
             pm.id AS parent_market_id,
             pm.question AS parent_question,
             pm.category AS parent_category,
             m.status, m.outcome, m.end_time, m.resolved_at
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE t.username = ${username}
        AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
        AND (${cycleWindow.fromIso}::timestamptz IS NULL OR t.created_at >= ${cycleWindow.fromIso}::timestamptz)
        AND (${cycleWindow.toIso}::timestamptz IS NULL OR t.created_at < ${cycleWindow.toIso}::timestamptz)
      ORDER BY t.created_at ASC
    `);
    const refundRows = await timer.time('db_refunds', () => sql`
      SELECT d.id, d.kind, d.reference_id AS market_id, d.amount, d.created_at,
             m.parent_id, m.question, m.category, m.outcomes, m.reserves,
             pm.id AS parent_market_id,
             pm.question AS parent_question,
             pm.category AS parent_category,
             m.status, m.outcome, m.end_time, m.resolved_at
      FROM points_distributions d
      JOIN points_markets m ON m.id = d.reference_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE d.username = ${username}
        AND d.kind IN ('market_cancel_refund', 'void_refund', 'invalid_field_refund')
        AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
        AND (${cycleWindow.fromIso}::timestamptz IS NULL OR d.created_at >= ${cycleWindow.fromIso}::timestamptz)
        AND (${cycleWindow.toIso}::timestamptz IS NULL OR d.created_at < ${cycleWindow.toIso}::timestamptz)
      ORDER BY d.created_at ASC
    `);

    const markets = new Map();
    function ensureMarketBucket(r) {
      const mid = r.market_id;
      if (!markets.has(mid)) {
        const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
        const reserves = parseJsonb(r.reserves, []).map(Number);
        markets.set(mid, {
          marketId: mid,
          parentMarketId: r.parent_market_id || null,
          question: r.parent_question || r.question,
          category: r.parent_category || r.category,
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
      return markets.get(mid);
    }

    for (const r of rows) {
      const bucket = ensureMarketBucket(r);

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

    for (const r of refundRows) {
      const bucket = ensureMarketBucket(r);
      const collateral = Number(r.amount || 0);
      bucket.totalReceived += collateral;
      bucket.transactions.push({
        id: `refund-${r.id}`,
        side: 'refund',
        outcomeIndex: null,
        outcomeLabel: r.kind === 'invalid_field_refund' ? 'Reembolso por participante fuera del campo' : 'Reembolso',
        shares: 0,
        collateral,
        fee: 0,
        priceAtTrade: 0,
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
      if (m.status === 'canceled' || (m.status === 'resolved' && (m.outcome === null || m.outcome === undefined))) {
        outcomeStatus = 'canceled';
      } else if (m.status === 'resolved') {
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
      if (cycleWindow.scope === 'previous' && (outcomeStatus === 'open' || outcomeStatus === 'pending')) {
        outcomeStatus = 'cycle_closed';
      }

      let claimablePayout = 0;
      if (outcomeStatus === 'won') {
        const winningIdx = Number(m.outcome);
        const winningGross = m.heldByOutcome.get(winningIdx) || 0;
        const redeemedWinning = m.redeemedByOutcome.get(winningIdx) || 0;
        claimablePayout = Math.max(0, winningGross - redeemedWinning);
      }
      const effectiveReceived = m.totalReceived + claimablePayout;
      const netPnl = round2(effectiveReceived - m.totalInvested);
      const pickedOutcome = pickedOutcomeSummary(m.transactions);
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
          parentMarketId: m.parentMarketId,
          question: m.question,
          category: m.category,
          status: m.status,
          outcomeStatus,
          totalInvested: round2(m.totalInvested),
          totalReceived: round2(effectiveReceived),
          realizedReceived: round2(m.totalReceived),
          claimablePayout: round2(claimablePayout),
          markToMarket: round2(mtm),
          netPnl,
          ...pickedOutcome,
          transactions: m.transactions,
        };
      }
      return {
        marketId: m.marketId,
        parentMarketId: m.parentMarketId,
        question: m.question,
        category: m.category,
        status: m.status,
        outcomeStatus,
        totalInvested: round2(m.totalInvested),
        totalReceived: round2(effectiveReceived),
        realizedReceived: round2(m.totalReceived),
        claimablePayout: round2(claimablePayout),
        netPnl,
        ...pickedOutcome,
        transactions: m.transactions,
      };
    });

    // Stable sort: open → pending → others newest first
    const priority = { open: 0, pending: 1, won: 2, lost: 2, canceled: 2, exited: 2 };
    history.sort((a, b) => {
      const pa = priority[a.outcomeStatus] ?? 3;
      const pb = priority[b.outcomeStatus] ?? 3;
      if (pa !== pb) return pa - pb;
      const lastA = a.transactions[a.transactions.length - 1]?.createdAt || 0;
      const lastB = b.transactions[b.transactions.length - 1]?.createdAt || 0;
      return new Date(lastB) - new Date(lastA);
    });

    const totalPnl = history.reduce((s, m) => s + m.netPnl, 0);

    timer.end({ history: history.length, trades: rows.length, refunds: refundRows.length });
    return res.status(200).json({
      history,
      summary: {
        totalPnl: round2(totalPnl),
        marketsTotal: history.length,
        marketsWon: history.filter(m => m.outcomeStatus === 'won').length,
        marketsLost: history.filter(m => m.outcomeStatus === 'lost').length,
        marketsCanceled: history.filter(m => m.outcomeStatus === 'canceled').length,
        marketsExited: history.filter(m => m.outcomeStatus === 'exited').length,
        marketsOpen: history.filter(m => m.outcomeStatus === 'open').length,
        marketsPending: history.filter(m => m.outcomeStatus === 'pending').length,
        marketsCycleClosed: history.filter(m => m.outcomeStatus === 'cycle_closed').length,
      },
      cycle: cycleWindow,
    });
  } catch (e) {
    timer.end({ error: 'history_failed' });
    console.error('[points/history] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'history_failed' });
  }
}

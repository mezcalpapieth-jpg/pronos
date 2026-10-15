/**
 * GET /api/points/admin/strategies
 *
 * Admin-only audit surface for tournament strategy mechanics:
 *   - combinada tickets + legs
 *   - long-hold / conviction multiplier leaderboard
 *   - stock participation, holdings and activity
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { buildTournamentLeaderboardRows } from '../../_lib/points-tournament-leaderboard.js';
import { configuredCycleWindowFromRow } from '../../_lib/points-tournament-config.js';
import { serializeParlayAudit, summarizeParlayAudit } from '../../_lib/points-parlay-audit.js';
import { readStockStrategyAudit } from '../../_lib/points-strategy-stocks.js';

const schemaSql = neon(process.env.DATABASE_URL);

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(numeric(value) * 100) / 100;
}

function readPositiveInt(value, fallback, max = 200) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function readCycles(client) {
  const { rows } = await client.query(
    `(
       SELECT id, label, started_at, ends_at, status, closed_at
       FROM points_cycles
       WHERE status = 'active'
       ORDER BY ends_at DESC
       LIMIT 1
     )
     UNION ALL
     (
       SELECT id, label, started_at, ends_at, status, closed_at
       FROM points_cycles
       WHERE status = 'closed'
       ORDER BY closed_at DESC NULLS LAST, ends_at DESC
       LIMIT 10
     )`,
  );
  return rows;
}

async function readSelectedCycle(client, requestedCycleId) {
  if (requestedCycleId) {
    const { rows } = await client.query(
      `SELECT id, label, started_at, ends_at, status, closed_at
       FROM points_cycles
       WHERE id = $1
       LIMIT 1`,
      [requestedCycleId],
    );
    return rows[0] || null;
  }
  const { rows } = await client.query(
    `SELECT id, label, started_at, ends_at, status, closed_at
     FROM points_cycles
     WHERE status = 'active'
     ORDER BY ends_at DESC
     LIMIT 1`,
  );
  return rows[0] || null;
}

export async function readParlayTickets(client, { cycleId, limit, summaryOnly = false }) {
  // Totals cover the whole cycle; only the detail query carries question snapshots.
  const detailFields = summaryOnly ? '' : `
                  'id', l.id,
                  'marketId', l.market_id,
                  'price', l.price_snapshot,
                  'question', COALESCE(l.question_snapshot, m.question),
                  'outcomeLabel', l.outcome_label_snapshot,
                  'marketEndTime', COALESCE(l.market_end_time, m.end_time),
                  'storedStatus', l.status,
                  'resolvedOutcome', l.resolved_outcome,
                  'resolvedOutcomeLabel', m.outcomes ->> (l.resolved_outcome::int),`;
  const { rows } = await client.query(
    `SELECT t.id, t.username, t.cycle_id, t.stake, t.multiplier,
            t.potential_payout, t.payout, t.status, t.submitted_at,
            t.settled_at, t.reason,
            ledger.entry_count, ledger.entry_amount, ledger.payment_count, ledger.paid_amount,
            ledger.wrong_user_count, ledger.wrong_payment_kind_count,
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  ${detailFields}
                  'outcomeIndex', l.outcome_index,
                  'marketStatus', m.status,
                  'marketOutcome', m.outcome
                )
                ORDER BY l.id ASC
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS legs
     FROM points_parlay_tickets t
     LEFT JOIN points_parlay_legs l ON l.ticket_id = t.id
     LEFT JOIN points_markets m ON m.id = l.market_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE d.kind='parlay_entry') AS entry_count,
         COALESCE(SUM(d.amount) FILTER (WHERE d.kind='parlay_entry'),0) AS entry_amount,
         COUNT(*) FILTER (WHERE d.kind IN ('parlay_payout','parlay_refund')) AS payment_count,
         COALESCE(SUM(d.amount) FILTER (WHERE d.kind IN ('parlay_payout','parlay_refund')),0) AS paid_amount,
         COUNT(*) FILTER (WHERE d.username<>t.username) AS wrong_user_count,
         COUNT(*) FILTER (WHERE (d.kind='parlay_payout' AND t.status<>'won')
           OR (d.kind='parlay_refund' AND t.status<>'void')) AS wrong_payment_kind_count
       FROM points_distributions d WHERE d.reference_id=t.id
         AND d.kind IN ('parlay_entry','parlay_payout','parlay_refund')
     ) ledger ON TRUE
     WHERE ($1::int IS NULL OR t.cycle_id = $1)
     GROUP BY t.id, ledger.entry_count, ledger.entry_amount, ledger.payment_count, ledger.paid_amount,
       ledger.wrong_user_count, ledger.wrong_payment_kind_count
     ORDER BY t.submitted_at DESC
     ${summaryOnly ? '' : 'LIMIT $2'}`,
    summaryOnly ? [cycleId || null] : [cycleId || null, limit],
  );
  return rows.map(serializeParlayAudit);
}

async function readSnapshotLongHoldRows(client, { cycleId, limit }) {
  const { rows } = await client.query(
    `SELECT username, final_pnl, hold_bonus, conviction_bonus_gross,
            conviction_bonus_cap_applied, conviction_eligible_profit,
            conviction_markets, conviction_lots
     FROM points_cycle_snapshots
     WHERE cycle_id = $1
       AND COALESCE(hold_bonus, 0) <> 0
     ORDER BY hold_bonus DESC, final_pnl DESC
     LIMIT $2`,
    [cycleId, limit],
  );
  return rows.map(row => ({
    username: row.username,
    score: round2(row.final_pnl),
    holdBonus: round2(row.hold_bonus),
    convictionBonusGross: round2(row.conviction_bonus_gross ?? row.hold_bonus),
    convictionBonusCapApplied: round2(row.conviction_bonus_cap_applied),
    convictionEligibleProfit: round2(row.conviction_eligible_profit),
    convictionMarkets: Number(row.conviction_markets || 0),
    convictionLots: Number(row.conviction_lots || 0),
    breakdown: [],
  }));
}

async function readLiveLongHoldRows(client, { cycle, limit }) {
  const window = configuredCycleWindowFromRow(cycle);
  const rows = await buildTournamentLeaderboardRows(client, {
    limit: 1000,
    now: new Date(),
    window,
    includeConvictionBreakdown: true,
  });
  const selected = rows
    .filter(row => numeric(row.holdBonus) !== 0 || numeric(row.convictionBonusGross) !== 0)
    .sort((a, b) => numeric(b.holdBonus) - numeric(a.holdBonus) || numeric(b.score) - numeric(a.score))
    .slice(0, limit);

  const marketIds = [...new Set(selected.flatMap(row => (
    Array.isArray(row.convictionBreakdown)
      ? row.convictionBreakdown.map(item => Number(item.marketId)).filter(Number.isInteger)
      : []
  )))];
  const marketMap = new Map();
  if (marketIds.length > 0) {
    const marketRows = await client.query(
      `SELECT id, question, status, outcome
       FROM points_markets
       WHERE id = ANY($1::int[])`,
      [marketIds],
    );
    for (const market of marketRows.rows) marketMap.set(Number(market.id), market);
  }

  return selected.map(row => ({
    username: row.username,
    rank: row.rank,
    score: round2(row.score),
    marketPnl: round2(row.marketPnl),
    holdBonus: round2(row.holdBonus),
    convictionBonusGross: round2(row.convictionBonusGross),
    convictionBonusCapApplied: round2(row.convictionBonusCapApplied),
    convictionEligibleProfit: round2(row.convictionEligibleProfit),
    convictionMarkets: Number(row.convictionMarkets || 0),
    convictionLots: Number(row.convictionLots || 0),
    breakdown: (row.convictionBreakdown || []).map(item => {
      const market = marketMap.get(Number(item.marketId));
      return {
        ...item,
        question: market?.question || null,
        marketStatus: market?.status || null,
        marketOutcome: market?.outcome == null ? null : Number(market.outcome),
      };
    }),
  }));
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(schemaSql);
    const requestedCycleId = readPositiveInt(req.query?.cycleId, null, Number.MAX_SAFE_INTEGER);
    const ticketLimit = readPositiveInt(req.query?.ticketLimit, 80, 200);
    const longHoldLimit = readPositiveInt(req.query?.longHoldLimit, 40, 100);
    const stockLimit = readPositiveInt(req.query?.stockLimit, 40, 100);

    const payload = await withTransaction(async (client) => {
      const cycles = await readCycles(client);
      const cycle = await readSelectedCycle(client, requestedCycleId);
      if (!cycle) {
        return {
          ok: true,
          cycle: null,
          cycles: [],
          parlay: { summary: summarizeParlayAudit([]), tickets: [] },
          longHold: { source: 'none', rows: [] },
          stocks: { available: false, summary: {}, users: [], assets: [], recentTrades: [] },
        };
      }

      const window = configuredCycleWindowFromRow(cycle);
      const tickets = await readParlayTickets(client, { cycleId: cycle.id, limit: ticketLimit });
      const allTickets = await readParlayTickets(client, { cycleId: cycle.id, summaryOnly: true });
      const stocks = await readStockStrategyAudit(client, { cycleId: cycle.id,
        startsAt: window.startsAt, endsAt: window.rankingCutoffAt, limit: stockLimit });
      const snapshotCountResult = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM points_cycle_snapshots
         WHERE cycle_id = $1`,
        [cycle.id],
      );
      const snapshotCount = Number(snapshotCountResult.rows[0]?.count || 0);
      const useSnapshot = String(cycle.status) === 'closed' && snapshotCount > 0;
      const longHoldRows = useSnapshot
        ? await readSnapshotLongHoldRows(client, { cycleId: cycle.id, limit: longHoldLimit })
        : await readLiveLongHoldRows(client, { cycle, limit: longHoldLimit });

      return {
        ok: true,
        cycle: {
          id: Number(cycle.id),
          label: window?.label || cycle.label,
          status: cycle.status,
          startedAt: cycle.started_at,
          endsAt: window?.endsAt || cycle.ends_at,
          closedAt: cycle.closed_at,
          snapshotCount,
        },
        cycles: cycles.map(row => {
          const rowWindow = configuredCycleWindowFromRow(row);
          return {
            id: Number(row.id),
            label: rowWindow?.label || row.label,
            status: row.status,
            startedAt: row.started_at,
            endsAt: rowWindow?.endsAt || row.ends_at,
            closedAt: row.closed_at,
          };
        }),
        parlay: {
          summary: summarizeParlayAudit(allTickets),
          tickets,
        },
        longHold: {
          source: useSnapshot ? 'cycle_snapshot' : 'live_leaderboard',
          rows: longHoldRows,
        },
        stocks,
      };
    });

    return res.status(200).json(payload);
  } catch (e) {
    console.error('[points/admin/strategies] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'strategies_failed' });
  }
}

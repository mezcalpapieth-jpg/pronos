/**
 * GET /api/points/top-holders?marketId=X&limit=10
 *
 * Returns the biggest shareholders of a market, ordered by current
 * mark-to-market value (shares × current price). Works for both unified
 * and parallel markets:
 *
 *   Unified: aggregates rows from points_positions where market_id = X.
 *   Parallel: marketId refers to the parent; we expand to all its legs
 *            and aggregate per (username, leg, outcome). Each leg is a
 *            distinct "side" the user holds, labeled "<leg> — Sí/No" to
 *            match positions.js's display convention.
 *
 * Read-only. Rate-limited to 30 req/min/IP to cap discovery-page load.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function parseJsonb(v, fb) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

function pricesForReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length === 0) return [];
  if (reserves.length === 2) return binaryPrices(reserves);
  return multiPrices(reserves);
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const limited = rateLimit(req, res, {
      key: `top-holders:${clientIp(req)}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) return;

    const mid = parseInt(req.query.marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const sql = getSql();
    await ensurePointsSchema(getSchemaSql());

    const marketRows = await sql`
      SELECT id, outcomes, reserves, amm_mode, status, outcome
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.parent_id) {
      // Legs aren't addressable directly — same contract as /api/points/market.
      return res.status(400).json({ error: 'leg_not_addressable', detail: 'use parent id' });
    }

    const parentOutcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
    const ammMode = m.amm_mode || 'unified';
    const isResolved = m.status === 'resolved';
    const winningIdx = isResolved ? Number(m.outcome) : null;

    if (ammMode === 'parallel') {
      // Aggregate per-leg positions. Each leg has its own reserves & winning
      // outcome (0 for the winning leg, 1 for losers after cascade resolve).
      const legs = await sql`
        SELECT l.id, l.reserves, l.status, l.outcome, l.leg_label
        FROM points_markets l
        WHERE l.parent_id = ${mid}
        ORDER BY l.id ASC
      `;
      if (legs.length === 0) {
        return res.status(200).json({ ammMode: 'parallel', outcomes: parentOutcomes, holders: [] });
      }

      const legIds = legs.map(l => Number(l.id));
      const positions = await sql`
        SELECT p.username, p.market_id, p.outcome_index, p.shares, p.cost_basis
        FROM points_positions p
        WHERE p.market_id = ANY(${legIds}) AND p.shares > 0
      `;

      const priced = positions.map(p => {
        const leg = legs.find(l => Number(l.id) === Number(p.market_id));
        const legReserves = parseJsonb(leg?.reserves, []).map(Number);
        const legPrices = pricesForReserves(legReserves);
        const oi = Number(p.outcome_index);
        let currentPrice;
        if (leg?.status === 'resolved') {
          currentPrice = Number(leg.outcome) === oi ? 1 : 0;
        } else {
          currentPrice = legPrices[oi] ?? 0.5;
        }
        const shares = Number(p.shares);
        return {
          username: p.username,
          legLabel: leg?.leg_label || '—',
          side: oi === 0 ? 'Sí' : 'No',
          shares,
          costBasis: Number(p.cost_basis || 0),
          value: shares * currentPrice,
        };
      });

      priced.sort((a, b) => b.value - a.value);
      return res.status(200).json({
        ammMode: 'parallel',
        outcomes: parentOutcomes,
        holders: priced.slice(0, limit).map(h => ({
          username: h.username,
          outcomeLabel: `${h.legLabel} — ${h.side}`,
          shares: Math.round(h.shares * 100) / 100,
          costBasis: Math.round(h.costBasis * 100) / 100,
          value: Math.round(h.value * 100) / 100,
        })),
      });
    }

    // Unified path.
    const reserves = parseJsonb(m.reserves, []).map(Number);
    const prices = pricesForReserves(reserves);

    const positions = await sql`
      SELECT username, outcome_index, shares, cost_basis
      FROM points_positions
      WHERE market_id = ${mid} AND shares > 0
    `;

    const priced = positions.map(p => {
      const oi = Number(p.outcome_index);
      let currentPrice;
      if (isResolved) currentPrice = oi === winningIdx ? 1 : 0;
      else currentPrice = prices[oi] ?? 1 / (parentOutcomes.length || 2);
      const shares = Number(p.shares);
      return {
        username: p.username,
        outcomeIndex: oi,
        outcomeLabel: parentOutcomes[oi] || `Opción ${oi + 1}`,
        shares,
        costBasis: Number(p.cost_basis || 0),
        value: shares * currentPrice,
      };
    });

    priced.sort((a, b) => b.value - a.value);
    return res.status(200).json({
      ammMode: 'unified',
      outcomes: parentOutcomes,
      holders: priced.slice(0, limit).map(h => ({
        username: h.username,
        outcomeIndex: h.outcomeIndex,
        outcomeLabel: h.outcomeLabel,
        shares: Math.round(h.shares * 100) / 100,
        costBasis: Math.round(h.costBasis * 100) / 100,
        value: Math.round(h.value * 100) / 100,
      })),
    });
  } catch (e) {
    console.error('[points/top-holders] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

/**
 * GET /api/points/price-history?ids=1,2,3&days=30&limit=200
 * GET /api/points/price-history?ids=1,2,3&hours=4&limit=200
 *
 * Returns sampled price snapshots for one or more markets over the
 * last `days` days (default 30, max 60). Used by the home grid and market
 * detail page to render sparkline charts without replaying every trade.
 *
 * NB: path is flat (not nested under `markets/`) because Vercel's
 * filesystem routing treats `markets/` as a directory and shadows the
 * sibling `markets.js` list endpoint when both exist at the same depth.
 *
 * Response shape — one entry per requested market id:
 *   {
 *     history: {
 *       "<marketId>": [
 *         { t: <unix seconds>, p: <probability 0-100 for outcome 0> }
 *       ],
 *       ...
 *     }
 *   }
 *
 * Only outcome 0 is returned — the sparkline on cards only shows the
 * "Sí/YES" curve. Multi-outcome markets can fetch additional indexes via
 * ?outcome=<n> (future work).
 *
 * No auth required — this is a public read.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { PRONOS_TREASURY_USERNAME } from '../_lib/points-limit-orders.js';
import {
  displayTradePointsFromRows,
  mergeDisplayPricePoints,
  priceHistoryExecutionBucket,
} from '../_lib/points-price-history-display.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = idsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, 200); // bound response size

    if (ids.length === 0) {
      return res.status(400).json({ error: 'invalid_ids' });
    }

    // Clamp windows so a caller can't force a huge result set. `hours`
    // lets the detail page show short ranges such as 4H without pretending
    // a fractional day exists.
    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isInteger(daysRaw) ? Math.max(1, Math.min(60, daysRaw)) : 30;
    const hoursRaw = parseInt(req.query.hours, 10);
    const windowHours = Number.isInteger(hoursRaw)
      ? Math.max(1, Math.min(60 * 24, hoursRaw))
      : days * 24;

    // Outcome index (default 0 = Sí/YES). The sparkline only shows one
    // curve per card, so we only return one outcome to keep payload small.
    const outcomeRaw = parseInt(req.query.outcome, 10);
    const outcomeIdx = Number.isInteger(outcomeRaw) && outcomeRaw >= 0 ? outcomeRaw : 0;

    // Keep chart payloads bounded even after buy/sell starts inserting
    // immediate snapshots. Sampling happens per market and preserves the
    // first/latest points through the bucket math below.
    const limitRaw = parseInt(req.query.limit, 10);
    const maxPoints = Number.isInteger(limitRaw)
      ? Math.max(20, Math.min(500, limitRaw))
      : 200;

    await ensurePointsSchema(schemaSql);

    // One SQL round-trip for every market, filtered by the cutoff. The
    // index (market_id, snapshotted_at DESC) makes this a fast range scan;
    // the window/bucket pass downsamples each market independently.
    const rows = await sql`
      WITH ranked AS (
        SELECT
          id,
          market_id,
          prices,
          snapshotted_at,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY snapshotted_at ASC) AS rn,
          COUNT(*) OVER (PARTITION BY market_id) AS total
        FROM points_price_snapshots
        WHERE market_id = ANY(${ids}::int[])
          AND snapshotted_at >= NOW() - (${windowHours} || ' hours')::interval
      ),
      sampled AS (
        SELECT
          market_id,
          prices,
          snapshotted_at,
          rn,
          total,
          CASE
            WHEN total <= ${maxPoints} THEN rn
            WHEN rn = 1 THEN 0
            WHEN rn = total THEN ${maxPoints} - 1
            ELSE FLOOR(((rn - 1)::numeric * (${maxPoints} - 1)) / GREATEST((total - 1)::numeric, 1))
          END AS bucket
        FROM ranked
      )
      SELECT DISTINCT ON (market_id, bucket)
        id, market_id, prices, snapshotted_at
      FROM sampled
      ORDER BY
        market_id ASC,
        bucket ASC,
        CASE WHEN rn = 1 OR rn = total THEN 0 ELSE 1 END ASC,
        snapshotted_at ASC
    `;

    // Polymarket-style carry-forward: the price at the window's start is
    // the last one BEFORE it, not the first one inside it. Without this
    // boundary point a line whose first in-window point lands at noon
    // starts mid-chart instead of at the left edge. Checked against BOTH
    // price sources below (AMM snapshots and order-book fills), since a
    // market's recent history can live entirely in either one. Clamped to
    // the window start so chart axes never stretch past the range.
    const boundarySnapshotRows = await sql`
      SELECT DISTINCT ON (market_id)
        market_id, prices, snapshotted_at
      FROM points_price_snapshots
      WHERE market_id = ANY(${ids}::int[])
        AND snapshotted_at < NOW() - (${windowHours} || ' hours')::interval
      ORDER BY market_id ASC, snapshotted_at DESC
    `;
    const boundaryTradeRows = outcomeIdx <= 1 ? await sql`
      SELECT DISTINCT ON (t.market_id)
        t.market_id, t.outcome_index, t.price_at_trade, t.created_at
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      WHERE t.market_id = ANY(${ids}::int[])
        AND t.username <> ${PRONOS_TREASURY_USERNAME}
        AND t.price_at_trade IS NOT NULL
        AND t.outcome_index IN (0, 1)
        AND t.reserves_before IS NOT NULL
        AND t.reserves_after IS NOT NULL
        AND t.reserves_before = t.reserves_after
        AND jsonb_typeof(m.outcomes) = 'array'
        AND jsonb_array_length(m.outcomes) = 2
        AND t.created_at < NOW() - (${windowHours} || ' hours')::interval
      ORDER BY t.market_id ASC, t.created_at DESC, t.id DESC
    ` : [];

    // Public charts should move like the movement tape: one visible
    // execution burst should leave one final display price. Raw reserve
    // snapshots can include internal AMM steps from a mixed book/AMM fill,
    // and rendering those alongside book fills makes a single 50c -> 54c buy
    // look like a spike to ~60c and then a reversal. Fetch recent binary
    // trade rows, collapse them by the same short execution bucket, and
    // replace nearby snapshots with that public terminal price.
    const tradeRowCap = Math.min(Math.max(maxPoints * 12, 240), 2400);
    const displayTradeRows = outcomeIdx <= 1 ? await sql`
      WITH ranked_trades AS (
        SELECT
          t.id,
          t.market_id,
          t.username,
          t.side,
          t.outcome_index,
          t.price_at_trade,
          t.reserves_before,
          t.reserves_after,
          t.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY t.market_id
            ORDER BY t.created_at DESC, t.id DESC
          ) AS rn
        FROM points_trades t
        JOIN points_markets m ON m.id = t.market_id
        WHERE t.market_id = ANY(${ids}::int[])
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.side IN ('buy', 'sell')
          AND t.price_at_trade IS NOT NULL
          AND t.outcome_index IN (0, 1)
          AND t.reserves_before IS NOT NULL
          AND t.reserves_after IS NOT NULL
          AND jsonb_typeof(m.outcomes) = 'array'
          AND jsonb_array_length(m.outcomes) = 2
          AND t.created_at >= NOW() - (${windowHours} || ' hours')::interval
      )
      SELECT
        id,
        market_id,
        username,
        side,
        outcome_index,
        price_at_trade,
        reserves_before,
        reserves_after,
        created_at
      FROM ranked_trades
      WHERE rn <= ${tradeRowCap}
      ORDER BY market_id ASC, created_at ASC, id ASC
    ` : [];
    const displayTradePoints = displayTradePointsFromRows(displayTradeRows, outcomeIdx);
    const tradePointsByMarket = new Map();
    for (const pt of displayTradePoints) {
      const key = Number(pt.market_id);
      if (!tradePointsByMarket.has(key)) tradePointsByMarket.set(key, []);
      tradePointsByMarket.get(key).push(pt);
    }

    // Group by market_id and project only the requested outcome.
    const windowStartSec = Date.now() / 1000 - windowHours * 3600;
    const history = {};
    for (const id of ids) history[id] = [];
    // Per market, carry forward whichever pre-window price is most recent.
    const boundary = new Map();
    for (const r of boundarySnapshotRows) {
      const prices = parseJsonb(r.prices, []);
      const price = Number(prices[outcomeIdx]);
      if (!Number.isFinite(price)) continue;
      boundary.set(r.market_id, { at: new Date(r.snapshotted_at).getTime(), p: price });
    }
    for (const r of boundaryTradeRows) {
      const tradePrice = Number(r.price_at_trade);
      if (!Number.isFinite(tradePrice) || tradePrice <= 0 || tradePrice >= 1) continue;
      const projected = Number(r.outcome_index) === outcomeIdx ? tradePrice : 1 - tradePrice;
      const at = new Date(r.created_at).getTime();
      const prev = boundary.get(r.market_id);
      if (!prev || at > prev.at) boundary.set(r.market_id, { at, p: projected });
    }
    for (const [marketId, b] of boundary) {
      history[marketId].push({
        t: windowStartSec,
        p: Math.round(b.p * 10000) / 100,
        // Sorts ahead of any in-window point sharing the same timestamp.
        _id: -1,
      });
    }
    for (const r of rows) {
      const prices = parseJsonb(r.prices, []);
      const price = Number(prices[outcomeIdx]);
      if (!Number.isFinite(price)) continue;
      history[r.market_id].push({
        t: new Date(r.snapshotted_at).getTime() / 1000,
        // Snapshots store probability 0-1; the Sparkline component expects
        // 0-100 to match MVP CLOB series.
        p: Math.round(price * 10000) / 100,
        _id: Number(r.id) || 0,
        _source: 'snapshot',
        _bucket: priceHistoryExecutionBucket(r.snapshotted_at),
      });
    }
    for (const id of ids) {
      history[id] = mergeDisplayPricePoints(history[id], tradePointsByMarket.get(id) || [])
        .filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p))
        .sort((a, b) => a.t - b.t || a._id - b._id)
        .map(({ t, p }) => ({ t, p }));
    }

    return res.status(200).json({ history });
  } catch (e) {
    console.error('[points/markets/price-history] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

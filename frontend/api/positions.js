import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { ensureProtocolSchema } from './_lib/protocol-schema.js';

/**
 * /api/positions?address=0x... — User positions on own protocol.
 *
 * We aggregate from deduped trades instead of the materialized positions
 * tables, because overlapping historical indexer runs can otherwise drift
 * the cached share counts.
 */

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const addr = address.toLowerCase();

  try {
    await ensureProtocolSchema(schemaSql);

    const [v1Rows, v2Rows] = await Promise.all([
      sql`
        WITH aggregates AS (
          SELECT
            t.market_id,
            COALESCE(SUM(
              CASE
                WHEN COALESCE(t.outcome_index, CASE WHEN t.is_yes THEN 0 ELSE 1 END) = 0
                  THEN CASE WHEN t.side = 'buy' THEN t.shares_amt ELSE -t.shares_amt END
                ELSE 0
              END
            ), 0) AS yes_shares,
            COALESCE(SUM(
              CASE
                WHEN COALESCE(t.outcome_index, CASE WHEN t.is_yes THEN 0 ELSE 1 END) = 1
                  THEN CASE WHEN t.side = 'buy' THEN t.shares_amt ELSE -t.shares_amt END
                ELSE 0
              END
            ), 0) AS no_shares,
            COALESCE(SUM(
              CASE
                WHEN t.side = 'buy' THEN t.collateral_amt
                ELSE -t.collateral_amt
              END
            ), 0) AS total_cost,
            MAX(t.created_at) AS updated_at
          FROM trades t
          JOIN protocol_markets m ON m.id = t.market_id
          WHERE t.trader = ${addr}
            AND COALESCE(m.protocol_version, 'v1') = 'v1'
          GROUP BY t.market_id
        )
        SELECT
          a.yes_shares,
          a.no_shares,
          a.total_cost,
          a.updated_at,
          m.id AS market_id,
          m.question,
          m.category,
          m.chain_id,
          m.market_id AS protocol_market_id,
          m.protocol_version,
          m.status,
          m.outcome,
          m.end_time,
          m.pool_address,
          (
            SELECT yes_price
            FROM price_snapshots ps
            WHERE ps.market_id = m.id
            ORDER BY ps.snapshot_at DESC
            LIMIT 1
          ) AS current_price
        FROM aggregates a
        JOIN protocol_markets m ON m.id = a.market_id
        ORDER BY
          CASE m.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          a.updated_at DESC
      `,
      sql`
        WITH aggregates AS (
          SELECT
            t.market_id,
            t.outcome_index,
            COALESCE(SUM(
              CASE
                WHEN t.side = 'buy' THEN t.shares_amt
                ELSE -t.shares_amt
              END
            ), 0) AS shares,
            COALESCE(SUM(
              CASE
                WHEN t.side = 'buy' THEN t.collateral_amt
                ELSE -t.collateral_amt
              END
            ), 0) AS total_cost,
            MAX(t.created_at) AS updated_at
          FROM trades t
          JOIN protocol_markets m ON m.id = t.market_id
          WHERE t.trader = ${addr}
            AND COALESCE(m.protocol_version, 'v1') = 'v2'
            AND t.outcome_index IS NOT NULL
          GROUP BY t.market_id, t.outcome_index
        )
        SELECT
          a.outcome_index,
          a.shares,
          a.total_cost,
          a.updated_at,
          m.id AS market_id,
          m.question,
          m.category,
          m.chain_id,
          m.market_id AS protocol_market_id,
          m.protocol_version,
          m.status,
          m.outcome,
          m.end_time,
          m.pool_address,
          m.outcomes,
          (
            SELECT prices
            FROM price_snapshots ps
            WHERE ps.market_id = m.id
            ORDER BY ps.snapshot_at DESC
            LIMIT 1
          ) AS current_prices
        FROM aggregates a
        JOIN protocol_markets m ON m.id = a.market_id
        ORDER BY
          CASE m.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          a.updated_at DESC
      `,
    ]);

    const v1Positions = v1Rows.map((r) => {
      const yesShares = clampToZero(r.yes_shares);
      const noShares = clampToZero(r.no_shares);
      const totalCost = clampToZero(r.total_cost);

      let currentPrice;
      if (r.status === 'resolved' && Number(r.outcome) === 1) {
        currentPrice = 1.0;
      } else if (r.status === 'resolved' && Number(r.outcome) === 2) {
        currentPrice = 0.0;
      } else {
        currentPrice = parseNumber(r.current_price, 0.5);
      }

      const currentValue = yesShares * currentPrice + noShares * (1 - currentPrice);
      const pnl = currentValue - totalCost;

      return {
        marketId: r.market_id,
        protocolMarketId: r.protocol_market_id,
        question: r.question,
        category: r.category,
        chainId: r.chain_id,
        status: r.status,
        outcome: r.outcome,
        endTime: r.end_time,
        poolAddress: r.pool_address,
        yesShares,
        noShares,
        totalCost,
        currentPrice,
        currentValue: roundMoney(currentValue),
        pnl: roundMoney(pnl),
        redeemed: false,
        payout: 0,
        updatedAt: r.updated_at,
      };
    }).filter((position) => position.yesShares > 0 || position.noShares > 0);

    const v2Positions = v2Rows.map((r) => {
      const shares = clampToZero(r.shares);
      const totalCost = clampToZero(r.total_cost);
      const outcomeIndex = Number(r.outcome_index);
      const labels = parseJson(r.outcomes, []);
      const prices = parseJson(r.current_prices, []);

      let currentPrice;
      if (r.status === 'resolved') {
        currentPrice = Number(r.outcome) === outcomeIndex ? 1.0 : 0.0;
      } else {
        currentPrice = parseNumber(prices[outcomeIndex], labels.length ? 1 / labels.length : 0);
      }

      const currentValue = shares * currentPrice;
      const pnl = currentValue - totalCost;

      return {
        marketId: r.market_id,
        protocolMarketId: r.protocol_market_id,
        protocolVersion: 'v2',
        question: r.question,
        category: r.category,
        chainId: r.chain_id,
        status: r.status,
        outcome: r.outcome,
        outcomeIndex,
        outcomeLabel: labels[outcomeIndex] || `Opcion ${outcomeIndex + 1}`,
        endTime: r.end_time,
        poolAddress: r.pool_address,
        shares,
        totalCost,
        currentPrice,
        currentValue: roundMoney(currentValue),
        pnl: roundMoney(pnl),
        redeemed: false,
        payout: 0,
        updatedAt: r.updated_at,
      };
    }).filter((position) => position.shares > 0);

    const positions = [...v1Positions, ...v2Positions];
    const active = positions.filter((position) => position.status === 'active');
    const totalInvested = active.reduce((sum, position) => sum + position.totalCost, 0);
    const totalValue = active.reduce((sum, position) => sum + position.currentValue, 0);
    const totalPnl = totalValue - totalInvested;

    return res.status(200).json({
      address: addr,
      positions,
      summary: {
        totalPositions: positions.length,
        activePositions: active.length,
        totalInvested: roundMoney(totalInvested),
        currentValue: roundMoney(totalValue),
        pnl: roundMoney(totalPnl),
      },
    });
  } catch (e) {
    console.error('Positions API error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToZero(value) {
  return Math.max(0, parseNumber(value, 0));
}

function roundMoney(value) {
  return Math.round(parseNumber(value, 0) * 100) / 100;
}

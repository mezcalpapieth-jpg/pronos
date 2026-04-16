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

    // Cost basis uses average-cost accounting:
    //   avg_cost = total_buy_cost / total_buy_shares
    //   cost_basis_remaining = avg_cost * (buy_shares - sell_shares)
    //   realized_pnl = sell_proceeds - avg_cost * sell_shares
    // The previous formula (Σbuys - Σsells) went negative after a profitable
    // sell, inflating displayed PnL. Now `totalCost` = cost basis of currently
    // held shares only; `realizedPnl` captures the locked-in gain/loss from
    // sells so the combined figure still matches cumulative profit.
    const [v1Rows, v2Rows] = await Promise.all([
      sql`
        WITH by_outcome AS (
          SELECT
            t.market_id,
            COALESCE(t.outcome_index, CASE WHEN t.is_yes THEN 0 ELSE 1 END) AS outcome_index,
            SUM(CASE WHEN t.side = 'buy'  THEN t.shares_amt     ELSE 0 END) AS buy_shares,
            SUM(CASE WHEN t.side = 'buy'  THEN t.collateral_amt ELSE 0 END) AS buy_cost,
            SUM(CASE WHEN t.side = 'sell' THEN t.shares_amt     ELSE 0 END) AS sell_shares,
            SUM(CASE WHEN t.side = 'sell' THEN t.collateral_amt ELSE 0 END) AS sell_proceeds,
            MAX(t.created_at) AS updated_at
          FROM trades t
          JOIN protocol_markets m ON m.id = t.market_id
          WHERE t.trader = ${addr}
            AND COALESCE(m.protocol_version, 'v1') = 'v1'
          GROUP BY t.market_id, outcome_index
        ),
        per_outcome AS (
          SELECT
            market_id,
            outcome_index,
            GREATEST(buy_shares - sell_shares, 0) AS shares_held,
            CASE
              WHEN buy_shares > 0
                THEN buy_cost * GREATEST(buy_shares - sell_shares, 0) / buy_shares
              ELSE 0
            END AS cost_basis_remaining,
            CASE
              WHEN buy_shares > 0
                THEN sell_proceeds - buy_cost * sell_shares / buy_shares
              ELSE 0
            END AS realized_pnl,
            updated_at
          FROM by_outcome
        ),
        aggregates AS (
          SELECT
            market_id,
            COALESCE(SUM(CASE WHEN outcome_index = 0 THEN shares_held ELSE 0 END), 0) AS yes_shares,
            COALESCE(SUM(CASE WHEN outcome_index = 1 THEN shares_held ELSE 0 END), 0) AS no_shares,
            COALESCE(SUM(cost_basis_remaining), 0) AS total_cost,
            COALESCE(SUM(realized_pnl), 0) AS realized_pnl,
            MAX(updated_at) AS updated_at
          FROM per_outcome
          GROUP BY market_id
        )
        SELECT
          a.yes_shares,
          a.no_shares,
          a.total_cost,
          a.realized_pnl,
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
        WITH by_outcome AS (
          SELECT
            t.market_id,
            t.outcome_index,
            SUM(CASE WHEN t.side = 'buy'  THEN t.shares_amt     ELSE 0 END) AS buy_shares,
            SUM(CASE WHEN t.side = 'buy'  THEN t.collateral_amt ELSE 0 END) AS buy_cost,
            SUM(CASE WHEN t.side = 'sell' THEN t.shares_amt     ELSE 0 END) AS sell_shares,
            SUM(CASE WHEN t.side = 'sell' THEN t.collateral_amt ELSE 0 END) AS sell_proceeds,
            MAX(t.created_at) AS updated_at
          FROM trades t
          JOIN protocol_markets m ON m.id = t.market_id
          WHERE t.trader = ${addr}
            AND COALESCE(m.protocol_version, 'v1') = 'v2'
            AND t.outcome_index IS NOT NULL
          GROUP BY t.market_id, t.outcome_index
        ),
        aggregates AS (
          SELECT
            market_id,
            outcome_index,
            GREATEST(buy_shares - sell_shares, 0) AS shares,
            CASE
              WHEN buy_shares > 0
                THEN buy_cost * GREATEST(buy_shares - sell_shares, 0) / buy_shares
              ELSE 0
            END AS total_cost,
            CASE
              WHEN buy_shares > 0
                THEN sell_proceeds - buy_cost * sell_shares / buy_shares
              ELSE 0
            END AS realized_pnl,
            updated_at
          FROM by_outcome
        )
        SELECT
          a.outcome_index,
          a.shares,
          a.total_cost,
          a.realized_pnl,
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
      const totalCost = clampToZero(r.total_cost); // cost basis of remaining shares only
      const realizedPnl = parseNumber(r.realized_pnl, 0);

      let currentPrice;
      if (r.status === 'resolved' && Number(r.outcome) === 1) {
        currentPrice = 1.0;
      } else if (r.status === 'resolved' && Number(r.outcome) === 2) {
        currentPrice = 0.0;
      } else {
        currentPrice = parseNumber(r.current_price, 0.5);
      }

      const currentValue = yesShares * currentPrice + noShares * (1 - currentPrice);
      const unrealizedPnl = currentValue - totalCost;
      const pnl = unrealizedPnl + realizedPnl;

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
        unrealizedPnl: roundMoney(unrealizedPnl),
        realizedPnl: roundMoney(realizedPnl),
        redeemed: false,
        payout: 0,
        updatedAt: r.updated_at,
      };
    }).filter((position) => position.yesShares > 0 || position.noShares > 0);

    const v2Positions = v2Rows.map((r) => {
      const shares = clampToZero(r.shares);
      const totalCost = clampToZero(r.total_cost); // cost basis of remaining shares
      const realizedPnl = parseNumber(r.realized_pnl, 0);
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
      const unrealizedPnl = currentValue - totalCost;
      const pnl = unrealizedPnl + realizedPnl;

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
        unrealizedPnl: roundMoney(unrealizedPnl),
        realizedPnl: roundMoney(realizedPnl),
        redeemed: false,
        payout: 0,
        updatedAt: r.updated_at,
      };
    }).filter((position) => position.shares > 0);

    const positions = [...v1Positions, ...v2Positions];
    const active = positions.filter((position) => position.status === 'active');
    // totalCost now = cost basis of currently held shares (not buys−sells).
    // Total PnL must add realizedPnl to capture gains/losses already locked
    // in by prior sells — otherwise the summary only shows unrealized PnL.
    const totalInvested  = active.reduce((sum, p) => sum + p.totalCost, 0);
    const totalValue     = active.reduce((sum, p) => sum + p.currentValue, 0);
    const totalUnrealized = totalValue - totalInvested;
    const totalRealized  = positions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
    const totalPnl       = totalUnrealized + totalRealized;

    return res.status(200).json({
      address: addr,
      positions,
      summary: {
        totalPositions: positions.length,
        activePositions: active.length,
        totalInvested: roundMoney(totalInvested),
        currentValue: roundMoney(totalValue),
        pnl: roundMoney(totalPnl),
        unrealizedPnl: roundMoney(totalUnrealized),
        realizedPnl: roundMoney(totalRealized),
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

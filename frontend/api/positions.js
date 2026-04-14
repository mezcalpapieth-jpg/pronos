import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';

/**
 * /api/positions?address=0x... — User positions on own protocol.
 *
 * Returns all positions for a wallet address, with market info joined.
 */

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  // Normalize to lowercase
  const addr = address.toLowerCase();

  try {
    const rows = await sql`
      SELECT
        p.yes_shares,
        p.no_shares,
        p.total_cost,
        p.redeemed,
        p.payout,
        p.updated_at,
        m.id as market_id,
        m.question,
        m.category,
        m.chain_id,
        m.market_id as protocol_market_id,
        m.protocol_version,
        m.status,
        m.outcome,
        m.end_time,
        m.pool_address,
        (SELECT yes_price FROM price_snapshots ps
         WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
        ) as current_price
      FROM positions p
      JOIN protocol_markets m ON m.id = p.market_id
      WHERE p.user_address = ${addr}
      ORDER BY
        CASE m.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
        p.updated_at DESC
    `;

    let v2Rows = [];
    try {
      v2Rows = await sql`
        SELECT
          op.outcome_index,
          op.shares,
          op.total_cost,
          op.redeemed,
          op.payout,
          op.updated_at,
          m.id as market_id,
          m.question,
          m.category,
          m.chain_id,
          m.market_id as protocol_market_id,
          m.protocol_version,
          m.status,
          m.outcome,
          m.end_time,
          m.pool_address,
          m.outcomes,
          (SELECT prices FROM price_snapshots ps
           WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as current_prices
        FROM outcome_positions op
        JOIN protocol_markets m ON m.id = op.market_id
        WHERE op.user_address = ${addr}
        ORDER BY
          CASE m.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          op.updated_at DESC
      `;
    } catch (e) {
      if (!String(e.message || '').includes('outcome_positions')) throw e;
    }

    const v1Positions = rows.map(r => {
      const yesShares = parseFloat(r.yes_shares);
      const noShares = parseFloat(r.no_shares);
      const totalCost = parseFloat(r.total_cost);

      // For resolved markets, use outcome to determine value
      // outcome: 1 = YES won, 2 = NO won
      let currentPrice;
      if (r.status === 'resolved' && r.outcome === 1) {
        currentPrice = 1.0; // YES won
      } else if (r.status === 'resolved' && r.outcome === 2) {
        currentPrice = 0.0; // NO won
      } else {
        currentPrice = parseFloat(r.current_price || 0.5);
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
        currentValue: Math.round(currentValue * 100) / 100,
        pnl: Math.round(pnl * 100) / 100,
        redeemed: r.redeemed,
        payout: parseFloat(r.payout),
        updatedAt: r.updated_at,
      };
    });

    const v2Positions = v2Rows.map(r => {
      const shares = parseFloat(r.shares);
      const totalCost = parseFloat(r.total_cost);
      const outcomeIndex = Number(r.outcome_index);
      const labels = parseJson(r.outcomes, []);
      const prices = parseJson(r.current_prices, []);
      let currentPrice;
      if (r.status === 'resolved') {
        currentPrice = Number(r.outcome) === outcomeIndex ? 1.0 : 0.0;
      } else {
        currentPrice = Number(prices[outcomeIndex] ?? (labels.length ? 1 / labels.length : 0));
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
        outcomeLabel: labels[outcomeIndex] || `Opción ${outcomeIndex + 1}`,
        endTime: r.end_time,
        poolAddress: r.pool_address,
        shares,
        totalCost,
        currentPrice,
        currentValue: Math.round(currentValue * 100) / 100,
        pnl: Math.round(pnl * 100) / 100,
        redeemed: r.redeemed,
        payout: parseFloat(r.payout),
        updatedAt: r.updated_at,
      };
    });

    const positions = [...v1Positions, ...v2Positions];

    // Summary stats
    const active = positions.filter(p => p.status === 'active');
    const totalInvested = active.reduce((s, p) => s + p.totalCost, 0);
    const totalValue = active.reduce((s, p) => s + p.currentValue, 0);
    const totalPnl = totalValue - totalInvested;

    return res.status(200).json({
      address: addr,
      positions,
      summary: {
        totalPositions: positions.length,
        activePositions: active.length,
        totalInvested: Math.round(totalInvested * 100) / 100,
        currentValue: Math.round(totalValue * 100) / 100,
        pnl: Math.round(totalPnl * 100) / 100,
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
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

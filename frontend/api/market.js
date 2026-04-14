import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';

/**
 * /api/market?id=<market_id> — Market detail + price history + recent trades.
 *
 * Returns the market info, latest 50 price snapshots for charting,
 * and the 20 most recent trades.
 */

const sql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, DELETE, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const marketId = parseInt(id);
  if (isNaN(marketId)) return res.status(400).json({ error: 'Invalid id' });

  if (req.method === 'DELETE') {
    const privyId = req.query.privyId || req.body?.privyId;
    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;

    try {
      const rows = await sql`
        UPDATE protocol_markets
        SET status = 'removed'
        WHERE id = ${marketId}
        RETURNING id
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Market not found' });
      }
      return res.status(200).json({ ok: true, id: rows[0].id });
    } catch (e) {
      console.error('Market remove API error:', e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  try {
    // Fetch market
    const marketRows = await sql`
      SELECT * FROM protocol_markets WHERE id = ${marketId} AND status <> 'removed'
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const market = marketRows[0];

    // Fetch price history (last 50 snapshots)
    const priceHistory = await sql`
      SELECT yes_price, no_price, volume_24h, liquidity, snapshot_at
      FROM price_snapshots
      WHERE market_id = ${marketId}
      ORDER BY snapshot_at DESC
      LIMIT 50
    `;

    // Fetch recent trades (last 20)
    const recentTrades = await sql`
      SELECT trader, side, is_yes, collateral_amt, shares_amt, fee_amt,
             price_at_trade, tx_hash, block_number, created_at
      FROM trades
      WHERE market_id = ${marketId}
      ORDER BY block_number DESC, log_index DESC
      LIMIT 20
    `;

    // Compute volume from trades
    const totalVolume = await sql`
      SELECT COALESCE(SUM(collateral_amt), 0) as total
      FROM trades WHERE market_id = ${marketId}
    `;

    const latestPrice = priceHistory[0] || { yes_price: 0.5, no_price: 0.5 };
    const yesPct = Math.round(latestPrice.yes_price * 100);
    const tradeVolume = Number(totalVolume[0].total || 0);
    const seedLiquidity = Number(market.seed_liquidity || 0) || Number(latestPrice.liquidity || 0) / 2;
    const displayVolume = tradeVolume > 0 ? tradeVolume : seedLiquidity;

    return res.status(200).json({
      market: {
        id: market.id,
        source: 'protocol',
        chainId: market.chain_id,
        marketId: market.market_id,
        factoryAddress: market.factory_address,
        poolAddress: market.pool_address,
        question: market.question,
        category: market.category,
        endTime: market.end_time,
        resolutionSource: market.resolution_src,
        status: market.status,
        outcome: market.outcome,
        seedLiquidity: market.seed_liquidity,
        createdAt: market.created_at,
        resolvedAt: market.resolved_at,
        options: [
          { label: 'Sí', pct: yesPct },
          { label: 'No', pct: 100 - yesPct },
        ],
        totalVolume: displayVolume,
        tradeVolume,
        liquidity: latestPrice.liquidity || '0',
      },
      priceHistory: priceHistory.reverse().map(p => ({
        yes: parseFloat(p.yes_price),
        no: parseFloat(p.no_price),
        volume: parseFloat(p.volume_24h),
        liquidity: parseFloat(p.liquidity),
        time: p.snapshot_at,
      })),
      recentTrades: recentTrades.map(t => ({
        trader: t.trader,
        side: t.side,
        isYes: t.is_yes,
        amount: parseFloat(t.collateral_amt),
        shares: parseFloat(t.shares_amt),
        fee: parseFloat(t.fee_amt),
        price: parseFloat(t.price_at_trade),
        txHash: t.tx_hash,
        block: t.block_number,
        time: t.created_at,
      })),
    });
  } catch (e) {
    console.error('Market detail API error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

import { neon } from '@neondatabase/serverless';

/**
 * /api/market?id=<market_id> — Market detail + price history + recent trades.
 *
 * Returns the market info, latest 50 price snapshots for charting,
 * and the 20 most recent trades.
 */

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const marketId = parseInt(id);
  if (isNaN(marketId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    // Fetch market
    const marketRows = await sql`
      SELECT * FROM protocol_markets WHERE id = ${marketId}
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
        totalVolume: totalVolume[0].total,
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

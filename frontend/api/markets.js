import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';

/**
 * /api/markets — List all markets (own protocol).
 *
 * GET /api/markets                  → all active markets
 * GET /api/markets?status=resolved  → resolved markets
 * GET /api/markets?category=deporte → filter by category
 * GET /api/markets?limit=20&offset=0
 */

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      status = 'active',
      category,
      limit = '50',
      offset = '0',
    } = req.query;

    const lim = Math.min(parseInt(limit) || 50, 100);
    const off = parseInt(offset) || 0;

    let rows;

    if (category) {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume
        FROM protocol_markets m
        WHERE m.status = ${status} AND m.category = ${category}
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    } else {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume
        FROM protocol_markets m
        WHERE m.status = ${status}
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    }

    // Get total count
    const countResult = category
      ? await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE status = ${status} AND category = ${category}`
      : await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE status = ${status}`;

    return res.status(200).json({
      markets: rows.map(formatMarket),
      total: parseInt(countResult[0].total),
      limit: lim,
      offset: off,
    });
  } catch (e) {
    console.error('Markets API error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

function formatMarket(row) {
  const price = row.latest_price || {};
  const yesPct = price.yes_price ? Math.round(price.yes_price * 100) : 50;
  const totalVolume = Number(row.total_volume || price.volume_24h || 0);
  const seedLiquidity = Number(row.seed_liquidity || 0) || Number(price.liquidity || 0) / 2;
  const displayVolume = totalVolume > 0 ? totalVolume : seedLiquidity;
  return {
    id: row.id,
    source: 'protocol',
    chainId: row.chain_id,
    marketId: row.market_id,
    factoryAddress: row.factory_address,
    poolAddress: row.pool_address,
    question: row.question,
    category: row.category,
    endTime: row.end_time,
    resolutionSource: row.resolution_src,
    status: row.status,
    outcome: row.outcome,
    seedLiquidity: row.seed_liquidity,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    options: [
      { label: 'Sí', pct: yesPct },
      { label: 'No', pct: 100 - yesPct },
    ],
    volume: displayVolume,
    totalVolume,
    liquidity: price.liquidity || '0',
  };
}

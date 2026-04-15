import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { ensureProtocolSchema } from './_lib/protocol-schema.js';

/**
 * /api/markets — List all markets (own protocol).
 *
 * GET /api/markets                  → all active markets
 * GET /api/markets?status=all       → all non-removed markets (admin)
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
    await ensureProtocolSchema(sql);

    const {
      status = 'active',
      category,
      limit = '50',
      offset = '0',
    } = req.query;

    const lim = Math.min(parseInt(limit) || 50, 100);
    const off = parseInt(offset) || 0;
    const statusFilter = String(status || 'active');
    const includeAllStatuses = statusFilter === 'all' || statusFilter === 'admin';

    let rows;

    if (category && includeAllStatuses) {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'prices', prices, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume,
          (SELECT COALESCE(
            COALESCE(m.seed_liquidity, 0) + SUM(
              CASE
                WHEN t.side = 'buy' THEN COALESCE(t.collateral_amt, 0) - COALESCE(t.fee_amt, 0)
                ELSE -(COALESCE(t.collateral_amt, 0) + COALESCE(t.fee_amt, 0))
              END
            ),
            COALESCE(m.seed_liquidity, 0)
          ) FROM trades t WHERE t.market_id = m.id) as current_liquidity
        FROM protocol_markets m
        WHERE COALESCE(m.status, 'active') <> 'removed' AND m.category = ${category}
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    } else if (category) {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'prices', prices, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume,
          (SELECT COALESCE(
            COALESCE(m.seed_liquidity, 0) + SUM(
              CASE
                WHEN t.side = 'buy' THEN COALESCE(t.collateral_amt, 0) - COALESCE(t.fee_amt, 0)
                ELSE -(COALESCE(t.collateral_amt, 0) + COALESCE(t.fee_amt, 0))
              END
            ),
            COALESCE(m.seed_liquidity, 0)
          ) FROM trades t WHERE t.market_id = m.id) as current_liquidity
        FROM protocol_markets m
        WHERE m.status = ${statusFilter} AND m.category = ${category}
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    } else if (includeAllStatuses) {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'prices', prices, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume,
          (SELECT COALESCE(
            COALESCE(m.seed_liquidity, 0) + SUM(
              CASE
                WHEN t.side = 'buy' THEN COALESCE(t.collateral_amt, 0) - COALESCE(t.fee_amt, 0)
                ELSE -(COALESCE(t.collateral_amt, 0) + COALESCE(t.fee_amt, 0))
              END
            ),
            COALESCE(m.seed_liquidity, 0)
          ) FROM trades t WHERE t.market_id = m.id) as current_liquidity
        FROM protocol_markets m
        WHERE COALESCE(m.status, 'active') <> 'removed'
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    } else {
      rows = await sql`
        SELECT m.*,
          (SELECT json_build_object('yes_price', yes_price, 'no_price', no_price, 'prices', prices, 'volume_24h', volume_24h, 'liquidity', liquidity)
           FROM price_snapshots ps WHERE ps.market_id = m.id ORDER BY ps.snapshot_at DESC LIMIT 1
          ) as latest_price,
          (SELECT COALESCE(SUM(collateral_amt), 0) FROM trades t WHERE t.market_id = m.id) as total_volume,
          (SELECT COALESCE(
            COALESCE(m.seed_liquidity, 0) + SUM(
              CASE
                WHEN t.side = 'buy' THEN COALESCE(t.collateral_amt, 0) - COALESCE(t.fee_amt, 0)
                ELSE -(COALESCE(t.collateral_amt, 0) + COALESCE(t.fee_amt, 0))
              END
            ),
            COALESCE(m.seed_liquidity, 0)
          ) FROM trades t WHERE t.market_id = m.id) as current_liquidity
        FROM protocol_markets m
        WHERE m.status = ${statusFilter}
        ORDER BY m.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;
    }

    // Get total count
    let countResult;
    if (category && includeAllStatuses) {
      countResult = await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE COALESCE(status, 'active') <> 'removed' AND category = ${category}`;
    } else if (category) {
      countResult = await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE status = ${statusFilter} AND category = ${category}`;
    } else if (includeAllStatuses) {
      countResult = await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE COALESCE(status, 'active') <> 'removed'`;
    } else {
      countResult = await sql`SELECT COUNT(*) as total FROM protocol_markets WHERE status = ${statusFilter}`;
    }

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
  const options = buildOptions(row, price);
  const tradeVolume = Math.max(0, Number(row.total_volume || price.volume_24h || 0));
  const liquidity = Math.max(0, Number(row.current_liquidity ?? row.seed_liquidity ?? price.liquidity ?? 0));
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
    protocolVersion: row.protocol_version || 'v1',
    outcomeCount: row.outcome_count || options.length,
    seedLiquidity: row.seed_liquidity,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    options,
    volume: liquidity,
    totalVolume: tradeVolume,
    tradeVolume,
    liquidity,
  };
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function buildOptions(row, price) {
  const outcomes = parseJson(row.outcomes, null);
  const labels = Array.isArray(outcomes) && outcomes.length > 0
    ? outcomes
    : ['Sí', 'No'];
  const prices = parseJson(price.prices, null);
  if (Array.isArray(prices) && prices.length >= labels.length) {
    return labels.map((label, i) => ({ label, pct: Math.round(Number(prices[i] || 0) * 100) }));
  }
  const yesPct = price.yes_price ? Math.round(Number(price.yes_price) * 100) : Math.round(100 / labels.length);
  if (labels.length === 2) {
    return [
      { label: labels[0], pct: yesPct },
      { label: labels[1], pct: Math.max(0, 100 - yesPct) },
    ];
  }
  return labels.map(label => ({ label, pct: Math.round(100 / labels.length) }));
}

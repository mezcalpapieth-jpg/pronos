import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';
import { ensureProtocolSchema } from './_lib/protocol-schema.js';

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
    await ensureProtocolSchema(sql);

    // Fetch market
    const marketRows = await sql`
      SELECT * FROM protocol_markets WHERE id = ${marketId} AND COALESCE(status, 'active') <> 'removed'
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const market = marketRows[0];

    // Fetch price history (last 50 snapshots)
    const priceHistory = await sql`
      SELECT yes_price, no_price, prices, volume_24h, liquidity, snapshot_at
      FROM price_snapshots
      WHERE market_id = ${marketId}
      ORDER BY snapshot_at DESC
      LIMIT 50
    `;

    // Fetch recent trades (last 20)
    const recentTrades = await sql`
      SELECT trader, side, is_yes, outcome_index, collateral_amt, shares_amt, fee_amt,
             price_at_trade, tx_hash, block_number, created_at
      FROM trades
      WHERE market_id = ${marketId}
      ORDER BY block_number DESC, log_index DESC
      LIMIT 20
    `;

    // Compute current liquidity from the actual collateral path and keep
    // cumulative traded volume as a separate metric.
    const totals = await sql`
      SELECT
        COALESCE(SUM(collateral_amt), 0) as total_volume,
        COALESCE(
          ${Number(market.seed_liquidity || 0)} + SUM(
            CASE
              WHEN side = 'buy' THEN COALESCE(collateral_amt, 0) - COALESCE(fee_amt, 0)
              ELSE -(COALESCE(collateral_amt, 0) + COALESCE(fee_amt, 0))
            END
          ),
          ${Number(market.seed_liquidity || 0)}
        ) as current_liquidity
      FROM trades WHERE market_id = ${marketId}
    `;

    const latestPrice = priceHistory[0] || { yes_price: 0.5, no_price: 0.5 };
    const options = buildOptions(market, latestPrice);
    const tradeVolume = Math.max(0, Number(totals[0]?.total_volume || 0));
    const liquidity = Math.max(0, Number(totals[0]?.current_liquidity ?? market.seed_liquidity ?? latestPrice.liquidity ?? 0));

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
        protocolVersion: market.protocol_version || 'v1',
        outcomeCount: market.outcome_count || options.length,
        seedLiquidity: market.seed_liquidity,
        createdAt: market.created_at,
        resolvedAt: market.resolved_at,
        options,
        totalVolume: tradeVolume,
        tradeVolume,
        liquidity,
      },
      priceHistory: priceHistory.reverse().map(p => ({
        yes: parseFloat(p.yes_price),
        no: parseFloat(p.no_price),
        prices: parseJson(p.prices, null),
        volume: parseFloat(p.volume_24h),
        liquidity: parseFloat(p.liquidity),
        time: p.snapshot_at,
      })),
      recentTrades: recentTrades.map(t => ({
        trader: t.trader,
        side: t.side,
        isYes: t.is_yes,
        outcomeIndex: t.outcome_index,
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

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function buildOptions(market, price) {
  const outcomes = parseJson(market.outcomes, null);
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

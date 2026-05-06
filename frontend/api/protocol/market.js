/**
 * GET /api/protocol/market?id=<id>
 *
 * Single-market detail for the MVP MarketDetail page. Same shape as
 * one entry in /api/protocol/markets — keeps the page's render code
 * path-agnostic between list and detail.
 *
 * Includes a small recent-trades + recent-redemptions tail so the
 * detail page can render activity without a second round-trip.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const TRADES_TAIL = 30;
const REDEMPTIONS_TAIL = 20;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const id = Number.parseInt(req.query.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  try {
    const rows = await sql`
      SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
             m.question, m.category, m.outcomes, m.outcome_count,
             m.protocol_version, m.end_time, m.status, m.outcome,
             m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at,
             m.resolution_src,
             s.yes_price AS s_yes, s.no_price AS s_no, s.prices AS s_prices,
             s.liquidity AS s_liquidity, s.volume_24h AS s_volume,
             s.snapshot_at AS s_snapshot
        FROM protocol_markets m
        LEFT JOIN LATERAL (
          SELECT yes_price, no_price, prices, liquidity, volume_24h, snapshot_at
            FROM price_snapshots
           WHERE market_id = m.id
           ORDER BY snapshot_at DESC
           LIMIT 1
        ) s ON TRUE
       WHERE m.id = ${id}
       LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const r = rows[0];
    const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
    const prices = parseJsonb(r.s_prices, null)
      || (r.s_yes != null ? [Number(r.s_yes), Number(r.s_no)] : null);

    const trades = await sql`
      SELECT side, is_yes, outcome_index, collateral_amt, shares_amt,
             fee_amt, price_at_trade, trader, tx_hash, block_number, created_at
        FROM trades
       WHERE market_id = ${id}
       ORDER BY block_number DESC, log_index DESC
       LIMIT ${TRADES_TAIL}
    `;
    const redemptions = await sql`
      SELECT user_address, outcome_index, shares, payout, tx_hash, block_number, created_at
        FROM redemptions
       WHERE market_id = ${id}
       ORDER BY block_number DESC, log_index DESC
       LIMIT ${REDEMPTIONS_TAIL}
    `;

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({
      market: {
        id: r.id,
        marketId: r.market_id,
        poolAddress: r.pool_address,
        factoryAddress: r.factory_address,
        chainId: Number(r.chain_id),
        question: r.question,
        category: r.category,
        outcomes,
        outcomeCount: Number(r.outcome_count) || outcomes.length,
        protocolVersion: r.protocol_version || 'v1',
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome != null ? Number(r.outcome) : null,
        seedLiquidity: r.seed_liquidity != null ? Number(r.seed_liquidity) : 0,
        prices,
        liquidity: r.s_liquidity != null ? Number(r.s_liquidity) : 0,
        volume24h: r.s_volume != null ? Number(r.s_volume) : 0,
        snapshotAt: r.s_snapshot,
        resolutionSource: r.resolution_src,
        txHash: r.tx_hash,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      },
      trades: trades.map(t => ({
        side: t.side,
        isYes: t.is_yes,
        outcomeIndex: t.outcome_index != null ? Number(t.outcome_index) : null,
        collateral: Number(t.collateral_amt),
        shares: Number(t.shares_amt),
        fee: Number(t.fee_amt) || 0,
        price: t.price_at_trade != null ? Number(t.price_at_trade) : null,
        trader: t.trader,
        txHash: t.tx_hash,
        blockNumber: Number(t.block_number),
        createdAt: t.created_at,
      })),
      redemptions: redemptions.map(r2 => ({
        user: r2.user_address,
        outcomeIndex: r2.outcome_index != null ? Number(r2.outcome_index) : null,
        shares: Number(r2.shares),
        payout: Number(r2.payout),
        txHash: r2.tx_hash,
        blockNumber: Number(r2.block_number),
        createdAt: r2.created_at,
      })),
    });
  } catch (e) {
    console.error('[protocol/market] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'market_failed' });
  }
}

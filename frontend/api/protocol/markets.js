/**
 * GET /api/protocol/markets
 *   ?status=active|resolved|all   (default: active)
 *   ?category=...                 (optional)
 *   ?limit=...                    (default 60, max 200)
 *
 * Public read endpoint backing the MVP build's market grid + detail
 * pages. Reads from `protocol_markets` (indexer-owned) joined with
 * the latest `price_snapshots` row per market for current prices.
 *
 * Returns an array of {
 *   id, marketId, poolAddress, factoryAddress, chainId,
 *   question, category, outcomes, outcomeCount, protocolVersion,
 *   endTime, status, outcome,
 *   prices, liquidity, volume24h, snapshotAt,
 *   seedLiquidity, txHash, createdAt,
 * } — shape mirrors what the legacy MarketsGrid/MarketCard expects
 * so the migration doesn't need a per-component reshape.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

const ALLOWED_STATUS = new Set(['active', 'resolved', 'all']);
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

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

  const statusParam = String(req.query.status || 'active').toLowerCase();
  const status = ALLOWED_STATUS.has(statusParam) ? statusParam : 'active';
  const category = typeof req.query.category === 'string' && req.query.category.trim()
    ? req.query.category.trim().toLowerCase()
    : null;
  // chainId filter — typically used when the same DB tracks multiple
  // chains (testnet vs mainnet). Pass `?chainId=42161` to scope mainnet.
  const chainIdRaw = Number.parseInt(req.query.chainId ?? req.query.chain_id, 10);
  const chainId = Number.isFinite(chainIdRaw) && chainIdRaw > 0 ? chainIdRaw : null;
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    // LATERAL join pulls the most recent price snapshot per market.
    // Old PG driver versions complain when the LATERAL alias clashes
    // with main columns, so we prefix the snapshot fields with `s_`.
    let rows;
    if (status === 'all') {
      rows = await sql`
        SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
               m.question, m.category, m.outcomes, m.outcome_count,
               m.protocol_version, m.start_time, m.end_time, m.status, m.outcome,
               m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at,
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
         WHERE (${category}::text IS NULL OR LOWER(m.category) = ${category})
           AND (${chainId}::int IS NULL OR m.chain_id = ${chainId})
         ORDER BY
           -- Live markets first (kickoff has passed, deadline hasn't).
           -- start_time is NULL for non-sports markets so they fall
           -- through to the created_at ordering below.
           CASE WHEN m.start_time IS NOT NULL
                 AND m.start_time <= NOW()
                 AND m.end_time > NOW() THEN 0 ELSE 1 END,
           m.created_at DESC
         LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
               m.question, m.category, m.outcomes, m.outcome_count,
               m.protocol_version, m.start_time, m.end_time, m.status, m.outcome,
               m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at,
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
         WHERE m.status = ${status}
           AND (${category}::text IS NULL OR LOWER(m.category) = ${category})
           AND (${chainId}::int IS NULL OR m.chain_id = ${chainId})
         ORDER BY
           -- Live markets first (kickoff has passed, deadline hasn't).
           -- start_time is NULL for non-sports markets so they fall
           -- through to the created_at ordering below.
           CASE WHEN m.start_time IS NOT NULL
                 AND m.start_time <= NOW()
                 AND m.end_time > NOW() THEN 0 ELSE 1 END,
           m.created_at DESC
         LIMIT ${limit}
      `;
    }

    const markets = rows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const prices = parseJsonb(r.s_prices, null)
        || (r.s_yes != null ? [Number(r.s_yes), Number(r.s_no)] : null);
      return {
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
        startTime: r.start_time,
        endTime: r.end_time,
        // Live = sports market currently in its game window. Mirrors
        // the ORDER BY computation above so the UI can render a LIVE
        // badge without re-doing the date math.
        live: !!(r.start_time
          && new Date(r.start_time).getTime() <= Date.now()
          && r.end_time
          && new Date(r.end_time).getTime() > Date.now()
          && r.status === 'active'),
        status: r.status,
        outcome: r.outcome != null ? Number(r.outcome) : null,
        seedLiquidity: r.seed_liquidity != null ? Number(r.seed_liquidity) : 0,
        prices,
        liquidity: r.s_liquidity != null ? Number(r.s_liquidity) : 0,
        volume24h: r.s_volume != null ? Number(r.s_volume) : 0,
        snapshotAt: r.s_snapshot,
        txHash: r.tx_hash,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      };
    });

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({ markets });
  } catch (e) {
    console.error('[protocol/markets] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'markets_failed' });
  }
}

/**
 * GET /api/points/market?id=<id>
 *
 * Single market + its current reserves + derived prices. Used by the
 * detail page to render the ring chart and buy buttons.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  // Top-level try/catch guarantees JSON output — see markets.js for
  // details on why this matters.
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    try {
      await ensurePointsSchema(schemaSql);

      const rows = await sql`
        SELECT m.*,
          (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
        FROM points_markets m
        WHERE m.id = ${id}
        LIMIT 1
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'market_not_found' });
      }
      const r = rows[0];
      // Legs are not directly addressable — always redirect through the
      // parent so the detail page sees the full group.
      if (r.parent_id) {
        return res.status(404).json({ error: 'market_not_found', detail: 'leg; use parent id' });
      }

      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const ammMode = r.amm_mode || 'unified';
      const outcomeImagesRaw = parseJsonb(r.outcome_images, null);
      const outcomeImages = Array.isArray(outcomeImagesRaw) && outcomeImagesRaw.length === outcomes.length
        ? outcomeImagesRaw
        : null;

      // Expose resolver metadata in a minimal shape — just the type +
      // source name from the config, nothing auth-related. Frontend
      // maps (type, source) → a human label ("Chainlink", "ESPN", …).
      const resolverCfg = parseJsonb(r.resolver_config, null);
      const resolverType = r.resolver_type || null;
      const resolverSource = resolverCfg?.source || null;

      if (ammMode === 'parallel') {
        const legRows = await sql`
          SELECT l.id, l.leg_label, l.reserves, l.seed_liquidity, l.status, l.outcome,
            (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = l.id) AS trade_volume
          FROM points_markets l
          WHERE l.parent_id = ${r.id}
          ORDER BY l.id ASC
        `;
        const legs = legRows.map((l, i) => {
          const lr = parseJsonb(l.reserves, []).map(Number);
          const lp = lr.length === 2 ? binaryPrices(lr) : [1 / outcomes.length, 1 - 1 / outcomes.length];
          return {
            id: l.id,
            outcomeIndex: i,
            label: l.leg_label || outcomes[i] || `Opción ${i + 1}`,
            reserves: lr,
            prices: lp,                     // [YES, NO] for the leg
            seedLiquidity: Number(l.seed_liquidity || 0),
            tradeVolume: Number(l.trade_volume || 0),
            status: l.status,
            outcome: l.outcome,             // 0 if this leg's YES won, 1 if NO won
          };
        });
        const seedTotal = legs.reduce((s, l) => s + l.seedLiquidity, 0);
        const tradeTotal = legs.reduce((s, l) => s + l.tradeVolume, 0);
        return res.status(200).json({
          market: {
            id: r.id,
            ammMode: 'parallel',
            question: r.question,
            category: r.category,
            icon: r.icon,
            outcomes,
            reserves: [],
            prices: legs.map(l => l.prices[0] ?? 1 / outcomes.length),
            seedLiquidity: seedTotal,
            volume: seedTotal,
            tradeVolume: tradeTotal,
            startTime: r.start_time,
            endTime: r.end_time,
            status: r.status,
            outcome: r.outcome,
            resolvedAt: r.resolved_at,
            createdAt: r.created_at,
            resolverType,
            resolverSource,
            sport: r.sport || null,
            league: r.league || null,
            outcomeImages,
            mode: r.mode || 'points',
            chainId: r.chain_id || null,
            chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
            chainAddress: r.chain_address || null,
          },
          legs,
        });
      }

      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);

      return res.status(200).json({
        market: {
          id: r.id,
          ammMode: 'unified',
          question: r.question,
          category: r.category,
          icon: r.icon,
          outcomes,
          reserves,
          prices,
          seedLiquidity: Number(r.seed_liquidity || 0),
          volume: Number(r.seed_liquidity || 0),
          tradeVolume: Number(r.trade_volume || 0),
          startTime: r.start_time,
          endTime: r.end_time,
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          createdAt: r.created_at,
          resolverType,
          resolverSource,
          sport: r.sport || null,
          league: r.league || null,
          outcomeImages,
          mode: r.mode || 'points',
          chainId: r.chain_id || null,
          chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
          chainAddress: r.chain_address || null,
        },
      });
    } catch (e) {
      console.error('[points/market] db error', { message: e?.message, code: e?.code });
      return res.status(500).json({
        error: 'db_unavailable',
        detail: e?.message?.slice(0, 240) || null,
      });
    }
  } catch (e) {
    console.error('[points/market] unhandled error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}

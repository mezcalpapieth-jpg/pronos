/**
 * GET /api/points/markets?status=active|resolved&category=X
 *
 * Public list endpoint — no auth required. Returns minimal market data +
 * derived prices so the grid can render without an extra call per card.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';

// Lazy neon client init — defer until the first request so a missing
// DATABASE_URL at module-load time surfaces as a structured JSON error
// from inside the handler, not an uncaught exception during Vercel's
// Lambda bootstrap (which produces an unparseable 500).
let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

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
  // Binary: use the audited helper that matches the AMM contract.
  if (reserves.length === 2) return binaryPrices(reserves);
  // Multi unified: factor-trick P_i = (1/r_i)/Σ(1/r_k). Matches the
  // amm-math.js multiPrices() formulation exactly (the two are
  // algebraically identical — see the explanation in amm-math.js).
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  // Top-level try/catch: the home page renders "HTTP 500" raw when this
  // endpoint ever returns non-JSON, so guarantee JSON output no matter
  // what throws. Inner try/catch still handles the specific DB path.
  try {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const status = req.query.status === 'resolved' ? 'resolved' : 'active';
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  // `mode` segregates off-chain Points markets from on-chain MVP markets
  // so the two apps render isolated universes even though they share the
  // same table. Omitted → Points default ('points'). MVP passes
  // `?mode=onchain` on every list call. `?mode=all` skips the filter
  // (used by the shared internal indexer + admin tools).
  const modeParam = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : '';
  const modeFilter = modeParam === 'onchain' ? 'onchain'
                    : modeParam === 'all'    ? null
                    : 'points';
  // Chain filter: MVP can narrow to a specific chain_id (e.g. 421614
  // for Sepolia, 42161 for Arbitrum One) so flipping env chains between
  // testnet and mainnet is a one-variable change — each chain sees only
  // its own on-chain markets. Mode='points' markets have chain_id=NULL
  // so this filter should only be sent with mode='onchain'.
  const chainIdRaw = req.query.chain_id;
  const chainIdFilter = Number.isFinite(Number(chainIdRaw)) && Number(chainIdRaw) > 0
    ? Number(chainIdRaw)
    : null;
  // Soft cap on returned rows. Default 100 keeps the home grid snappy
  // (trending doesn't need every market, just the ones about to close);
  // category pages request a higher cap so nothing is hidden. Clamped
  // at 2000 so we never return a multi-megabyte response by accident.
  const reqLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(reqLimit) && reqLimit > 0
    ? Math.min(reqLimit, 2000)
    : 100;
  // featured filter: the home "Trending" grid only shows curated
  // (featured=true) markets. Category pages pass featured=all to see
  // everything. Default without a category = trending, so featured=true.
  // Explicit ?featured=all bypasses the filter entirely.
  const featuredParam = req.query.featured;
  const featuredOnly = !category && featuredParam !== 'all';

  try {
    const schemaSql = getSchemaSql();
    const sql = getSql();
    await ensurePointsSchema(schemaSql);

    // Only fetch parents / unified markets. Legs (parent_id IS NOT NULL)
    // are rolled up below and never surface as standalone rows.
    // `modeFilter` is NULL (skip), 'points', or 'onchain'. We pass it
    // explicitly into each branch — Neon's tagged template takes a
    // literal; a CASE/COALESCE around `m.mode = $` keeps the plan simple
    // and indexable. Rows with mode IS NULL are treated as 'points' for
    // backward-compat with pre-M3 schemas that hadn't populated the column.
    const rows = category
      ? await sql`
          SELECT m.*,
            (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
          FROM points_markets m
          WHERE m.status = ${status} AND m.category = ${category}
            AND m.parent_id IS NULL
            AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
          ORDER BY m.end_time ASC
          LIMIT ${limit}
        `
      : featuredOnly
        ? await sql`
            SELECT m.*,
              (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
            FROM points_markets m
            WHERE m.status = ${status}
              AND m.featured = true
              AND m.parent_id IS NULL
              AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
            ORDER BY m.end_time ASC
            LIMIT ${limit}
          `
        : await sql`
            SELECT m.*,
              (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
            FROM points_markets m
            WHERE m.status = ${status}
              AND m.parent_id IS NULL
              AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
            ORDER BY m.end_time ASC
            LIMIT ${limit}
          `;

    // Collect parallel-parent ids so we can batch-fetch their legs in
    // one query instead of N+1 round-trips.
    const parallelIds = rows
      .filter(r => r.amm_mode === 'parallel')
      .map(r => r.id);
    let legsByParent = new Map();
    if (parallelIds.length > 0) {
      const legs = await sql`
        SELECT l.id, l.parent_id, l.leg_label, l.reserves, l.seed_liquidity, l.status, l.outcome,
          (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = l.id) AS trade_volume
        FROM points_markets l
        WHERE l.parent_id = ANY(${parallelIds})
        ORDER BY l.parent_id ASC, l.id ASC
      `;
      for (const leg of legs) {
        const pid = leg.parent_id;
        if (!legsByParent.has(pid)) legsByParent.set(pid, []);
        legsByParent.get(pid).push(leg);
      }
    }

    const markets = rows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const ammMode = r.amm_mode || 'unified';

      const outcomeImages = parseJsonb(r.outcome_images, null);

      if (ammMode === 'parallel') {
        // Aggregate legs. Each leg is a binary Sí/No market; the parent
        // outcome's "price" is that leg's YES (outcome 0) price.
        const legs = legsByParent.get(r.id) || [];
        const legPrices = legs.map(l => {
          const lr = parseJsonb(l.reserves, []).map(Number);
          return lr.length === 2 ? binaryPrices(lr)[0] : 1 / outcomes.length;
        });
        const seedTotal = legs.reduce((s, l) => s + Number(l.seed_liquidity || 0), 0);
        const tradeTotal = legs.reduce((s, l) => s + Number(l.trade_volume || 0), 0);
        return {
          id: r.id,
          ammMode: 'parallel',
          question: r.question,
          category: r.category,
          icon: r.icon,
          outcomes,
          reserves: [],   // parent has no pool
          prices: legPrices.length === outcomes.length
            ? legPrices
            : outcomes.map(() => 1 / outcomes.length),
          seedLiquidity: seedTotal,
          volume: seedTotal,
          tradeVolume: tradeTotal,
          startTime: r.start_time,
          endTime: r.end_time,
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          finalScore: r.final_score || null,
          createdAt: r.created_at,
          sport: r.sport || null,
          league: r.league || null,
          outcomeImages: Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length
            ? outcomeImages
            : null,
          mode: r.mode || 'points',
          chainId: r.chain_id || null,
          chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
          chainAddress: r.chain_address || null,
        };
      }

      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);
      return {
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
        finalScore: r.final_score || null,
        createdAt: r.created_at,
        sport: r.sport || null,
        league: r.league || null,
        outcomeImages: Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length
          ? outcomeImages
          : null,
        mode: r.mode || 'points',
        chainId: r.chain_id || null,
        chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
        chainAddress: r.chain_address || null,
      };
    });

    return res.status(200).json({ markets });
  } catch (e) {
    console.error('[points/markets] db error', {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
  } catch (e) {
    console.error('[points/markets] unhandled error', {
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

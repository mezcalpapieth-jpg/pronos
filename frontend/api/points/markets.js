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
import { applySeriesGateToMarket, normalizeSeriesMeta, seriesSubtitle } from '../_lib/series-markets.js';
import { deriveMarketTags } from '../_lib/category-tags.js';
import { deriveOutcomeCountryLabels } from '../_lib/outcome-country-labels.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';

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

function cryptoIntervalFromResolverConfig(resolverCfg) {
  if (resolverCfg?.shape !== 'binary-direction') return null;
  const minutes = Number(resolverCfg.intervalMinutes || resolverCfg.windowMinutes || 5);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
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

function binaryLegPricesFromRow({ reserves, status, outcome }, fallbackYes = 0.5) {
  if (String(status || '') === 'resolved') {
    const resolvedOutcome = Number(outcome);
    if (resolvedOutcome === 0) return [1, 0];
    if (resolvedOutcome === 1) return [0, 1];
  }
  if (Array.isArray(reserves) && reserves.length === 2) return binaryPrices(reserves);
  const yes = Number.isFinite(Number(fallbackYes)) ? Number(fallbackYes) : 0.5;
  return [yes, 1 - yes];
}

function publicSeriesMetaFromRow(row) {
  const resolverCfg = parseJsonb(row.resolver_config, null);
  const sourceData = parseJsonb(row.pending_source_data, null);
  const meta = normalizeSeriesMeta({ resolverConfig: resolverCfg, sourceData, row });
  if (!meta?.gameNumber) return null;
  return {
    key: meta.key,
    leaguePath: meta.leaguePath,
    league: meta.league,
    sport: meta.sport,
    gameNumber: meta.gameNumber,
    bestOf: meta.bestOf,
    winTarget: meta.winTarget,
    guaranteedGames: meta.guaranteedGames,
    round: meta.round,
    seasonYear: meta.seasonYear,
    homeTeam: meta.homeTeam,
    awayTeam: meta.awayTeam,
    teams: meta.teams,
    espnSeriesWins: meta.espnSeriesWins || null,
    subtitle: seriesSubtitle({ gameNumber: meta.gameNumber }),
  };
}

function publicCategoryAlias(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'nuevos-mercados') return 'world-cup';
  return raw || null;
}

export default async function handler(req, res) {
  // Top-level try/catch: the home page renders "HTTP 500" raw when this
  // endpoint ever returns non-JSON, so guarantee JSON output no matter
  // what throws. Inner try/catch still handles the specific DB path.
  const timer = createApiTimer(res, 'points/markets');
  try {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const status = req.query.status === 'resolved' ? 'resolved' : 'active';
  const category = typeof req.query.category === 'string' ? publicCategoryAlias(req.query.category) : null;
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
  // every public-visible market. Default without a category = trending,
  // so featured=true. Explicit ?featured=all bypasses the curation filter,
  // but still respects hidden_from_home for active non-trophy markets.
  const featuredParam = req.query.featured;
  const featuredOnly = !category && featuredParam !== 'all';
  const cacheKey = [
    'points:markets:v4',
    status,
    category || 'all',
    modeFilter || 'all-modes',
    chainIdFilter || 'all-chains',
    limit,
    featuredOnly ? 'featured' : 'all-featured',
  ].join(':');

  try {
    setCacheHeaders(res, { scope: 'public', maxAge: 10, sMaxage: 30, staleWhileRevalidate: 120 });
    const { value: payload, hit } = await cachedJson(cacheKey, 20_000, async () => {
      const schemaSql = getSchemaSql();
      const sql = getSql();
      await timer.time('schema', () => ensurePointsSchema(schemaSql));

    // Only fetch parents / unified markets. Legs (parent_id IS NOT NULL)
    // are rolled up below and never surface as standalone rows.
    // `modeFilter` is NULL (skip), 'points', or 'onchain'. We pass it
    // explicitly into each branch — Neon's tagged template takes a
    // literal; a CASE/COALESCE around `m.mode = $` keeps the plan simple
    // and indexable. Rows with mode IS NULL are treated as 'points' for
    // backward-compat with pre-M3 schemas that hadn't populated the column.
      const rows = await timer.time('db_markets', () => category
        ? sql`
          SELECT m.*, pm.source_data AS pending_source_data,
            (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
          FROM points_markets m
          LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
          WHERE m.status = ${status}
            AND (m.category = ${category} OR COALESCE(m.category_tags, '[]'::jsonb) ? ${category})
            AND m.parent_id IS NULL
            AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
            AND (
              ${status}::text <> 'active'
              OR m.hidden_from_home IS NOT TRUE
              OR m.tournament_featured = true
            )
          ORDER BY
            CASE WHEN ${status}::text = 'resolved' THEN m.resolved_at END DESC NULLS LAST,
            -- Live markets first (kickoff has passed, deadline hasn't).
            CASE WHEN m.start_time IS NOT NULL
                  AND m.start_time <= NOW()
                  AND m.end_time > NOW() THEN 0 ELSE 1 END,
            m.end_time ASC,
            m.id ASC
          LIMIT ${limit}
        `
        : featuredOnly
          ? sql`
            SELECT m.*, pm.source_data AS pending_source_data,
              (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
            FROM points_markets m
            LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
            WHERE m.status = ${status}
              AND (
                (m.featured = true AND m.hidden_from_home = false)
                OR m.tournament_featured = true
              )
              AND m.parent_id IS NULL
              AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
            ORDER BY
              CASE WHEN ${status}::text = 'resolved' THEN m.resolved_at END DESC NULLS LAST,
              -- Live markets first (kickoff has passed, deadline hasn't).
              -- Sports stories where the game is in progress jump to the
              -- front of the grid + the trending tab. Non-sports markets
              -- have NULL start_time and fall through to the end_time
              -- ordering below as before.
              CASE WHEN m.start_time IS NOT NULL
                    AND m.start_time <= NOW()
                    AND m.end_time > NOW() THEN 0 ELSE 1 END,
              m.end_time ASC,
              m.id ASC
            LIMIT ${limit}
          `
          : sql`
            SELECT m.*, pm.source_data AS pending_source_data,
              (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
            FROM points_markets m
            LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
            WHERE m.status = ${status}
              AND m.parent_id IS NULL
              AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
            AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
            AND m.archived_at IS NULL
            AND (
              ${status}::text <> 'active'
              OR m.hidden_from_home IS NOT TRUE
              OR m.tournament_featured = true
            )
            ORDER BY
              CASE WHEN ${status}::text = 'resolved' THEN m.resolved_at END DESC NULLS LAST,
              -- Live markets first (kickoff has passed, deadline hasn't).
              -- Sports stories where the game is in progress jump to the
              -- front of the grid + the trending tab. Non-sports markets
              -- have NULL start_time and fall through to the end_time
              -- ordering below as before.
              CASE WHEN m.start_time IS NOT NULL
                    AND m.start_time <= NOW()
                    AND m.end_time > NOW() THEN 0 ELSE 1 END,
              m.end_time ASC,
              m.id ASC
            LIMIT ${limit}
            `);

    // Collect parallel-parent ids so we can batch-fetch their legs in
    // one query instead of N+1 round-trips.
      const parallelIds = rows
        .filter(r => r.amm_mode === 'parallel')
        .map(r => r.id);
      let legsByParent = new Map();
      if (parallelIds.length > 0) {
        const legs = await timer.time('db_legs', () => sql`
        SELECT l.id, l.parent_id, l.leg_label, l.reserves, l.seed_liquidity, l.status, l.outcome,
          (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = l.id) AS trade_volume
        FROM points_markets l
        WHERE l.parent_id = ANY(${parallelIds})
          AND l.status <> 'canceled'
        ORDER BY l.parent_id ASC, l.id ASC
        `);
        for (const leg of legs) {
          const pid = leg.parent_id;
          if (!legsByParent.has(pid)) legsByParent.set(pid, []);
          legsByParent.get(pid).push(leg);
        }
      }

      const markets = rows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const ammMode = r.amm_mode || 'unified';
      const seriesMeta = publicSeriesMetaFromRow(r);
      const sourceData = parseJsonb(r.pending_source_data, {});
      const resolverConfig = parseJsonb(r.resolver_config, null);
      const tags = deriveMarketTags({
        ...r,
        source_data: sourceData,
        resolver_config: resolverConfig || {},
        category_tags: parseJsonb(r.category_tags, []),
        geo_tags: parseJsonb(r.geo_tags, []),
        topic_tags: parseJsonb(r.topic_tags, []),
      });
      const outcomeCountryLabels = deriveOutcomeCountryLabels({
        ...r,
        outcomes,
        source_data: sourceData,
      });

      const outcomeImages = parseJsonb(r.outcome_images, null);
      // `featured` is the admin flame. Home fetches featured=all so it
      // can add user-starred teams on top, therefore the payload itself
      // must still mark flame-selected rows as trending.
      const cfg = resolverConfig;
      const isOpenEnded = cfg?.source === 'next-opponent';
      const startMs = r.start_time ? new Date(r.start_time).getTime() : 0;
      const endMs   = r.end_time   ? new Date(r.end_time).getTime()   : 0;
      const windowOk = startMs > 0 && endMs > startMs
        && (endMs - startMs) <= 14 * 86_400_000;
      const live = !!(!isOpenEnded
        && windowOk
        && startMs <= Date.now()
        && endMs > Date.now()
        && r.status === 'active');

      if (ammMode === 'parallel') {
        // Aggregate legs. Each leg is a binary Sí/No market; the parent
        // outcome's "price" is that leg's YES (outcome 0) price.
        const legs = legsByParent.get(r.id) || [];
        const legPrices = legs.map(l => {
          const lr = parseJsonb(l.reserves, []).map(Number);
          return binaryLegPricesFromRow({
            reserves: lr,
            status: l.status,
            outcome: l.outcome,
          }, 1 / outcomes.length)[0];
        });
        const seedTotal = legs.reduce((s, l) => s + Number(l.seed_liquidity || 0), 0);
        const tradeTotal = legs.reduce((s, l) => s + Number(l.trade_volume || 0), 0);
        // Per-outcome leg ids so the card-level buy drawer can target the
        // right leg without an extra round-trip to /api/points/market.
        // Each leg is binary Sí/No, ordered to match `outcomes`.
        const legIds = legs.map(l => l.id);
        const legStatuses = legs.map(l => l.status || null);
        const legOutcomes = legs.map(l => l.outcome == null ? null : Number(l.outcome));
        const activeOutcomeIndexes = legs
          .map((l, i) => String(l.status || '').toLowerCase() === 'active' ? i : null)
          .filter(i => i !== null);
        return applySeriesGateToMarket({
          id: r.id,
          ammMode: 'parallel',
          question: r.question,
          category: r.category,
          icon: null,
          outcomes,
          reserves: [],   // parent has no pool
          prices: legPrices.length === outcomes.length
            ? legPrices
            : outcomes.map(() => 1 / outcomes.length),
          legIds: legIds.length === outcomes.length ? legIds : null,
          legStatuses: legStatuses.length === outcomes.length ? legStatuses : null,
          legOutcomes: legOutcomes.length === outcomes.length ? legOutcomes : null,
          activeOutcomeIndexes,
          seedLiquidity: seedTotal,
          volume: seedTotal,
          tradeVolume: tradeTotal,
          startTime: r.start_time,
          endTime: r.end_time,
          live,
          featured: r.featured === true,
          hiddenFromHome: r.hidden_from_home === true,
          tournamentFeatured: r.tournament_featured === true,
          trending: r.hidden_from_home !== true && (r.featured === true || live),
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          finalScore: r.final_score || null,
          seriesMeta,
          createdAt: r.created_at,
          source: r.source || null,
          sourceEventId: r.source_event_id || null,
          resolverConfig,
          sport: r.sport || null,
          league: r.league || null,
          categoryTags: tags.categoryTags,
          geoTags: tags.geoTags,
          topicTags: tags.topicTags,
          outcomeImages: Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length
            ? outcomeImages
            : null,
          outcomeCountryLabels,
          mode: r.mode || 'points',
          chainId: r.chain_id || null,
          chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
          chainAddress: r.chain_address || null,
          crypto5min: false,
        });
      }

      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);
      // "Live" is the red EN VIVO pill — only for fixed-window sports
      // events. Two defenses against open-ended prediction markets
      // accidentally showing live:
      //   (a) resolver_config.source === 'next-opponent' is explicitly
      //       excluded — these are 180-day open-ended fights with no
      //       kickoff. Existing rows in production already have a
      //       start_time stamped at creation (legacy generator bug);
      //       this filter neutralizes them without a DB migration.
      //   (b) duration > 14 days is also excluded as a backstop in
      //       case any other generator ships a long-window market
      //       with start_time set.
      // Discriminator for crypto-5min markets (BTC/ETH "sube o baja a
      // las HH:MM CDMX"). Exposed so the category page can offer a
      // dedicated "5 minutos" sub-filter — otherwise resueltos and the
      // crypto tab are dominated by 5-min rollover history.
      const crypto5min = cfg?.shape === 'binary-direction';
      const cryptoIntervalMinutes = cryptoIntervalFromResolverConfig(cfg);
      return applySeriesGateToMarket({
        id: r.id,
        ammMode: 'unified',
        question: r.question,
        category: r.category,
        icon: null,
        outcomes,
        reserves,
        prices,
        seedLiquidity: Number(r.seed_liquidity || 0),
        volume: Number(r.seed_liquidity || 0),
        tradeVolume: Number(r.trade_volume || 0),
        startTime: r.start_time,
        endTime: r.end_time,
        // Live = sports market currently in its game window. Mirrors the
        // PointsMarketCard isLive computation but pre-computed here so
        // every consumer (carousel, grid, trending tab) reads the same
        // boolean without re-doing the date math.
        live,
        featured: r.featured === true,
        hiddenFromHome: r.hidden_from_home === true,
        tournamentFeatured: r.tournament_featured === true,
        trending: r.hidden_from_home !== true && (r.featured === true || live),
        crypto5min,
        cryptoIntervalMinutes,
        cryptoWindowMinutes: cryptoIntervalMinutes,
        status: r.status,
        outcome: r.outcome,
        resolvedAt: r.resolved_at,
        finalScore: r.final_score || null,
        seriesMeta,
        createdAt: r.created_at,
        source: r.source || null,
        sourceEventId: r.source_event_id || null,
        resolverConfig,
        sport: r.sport || null,
        league: r.league || null,
        categoryTags: tags.categoryTags,
        geoTags: tags.geoTags,
        topicTags: tags.topicTags,
        outcomeImages: Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length
          ? outcomeImages
          : null,
        outcomeCountryLabels,
        mode: r.mode || 'points',
        chainId: r.chain_id || null,
        chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
        chainAddress: r.chain_address || null,
      });
    });

      return { markets };
    });
    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ cache: hit ? 'hit' : 'miss', markets: payload.markets?.length || 0 });
    return res.status(200).json(payload);
  } catch (e) {
    timer.end({ error: 'db_unavailable' });
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
    timer.end({ error: 'server_error' });
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

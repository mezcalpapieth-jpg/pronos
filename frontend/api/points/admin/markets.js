/**
 * GET /api/points/admin/markets?status=all|active|resolved&category=<slug>
 *
 * Admin-only full market list (including expired / resolved) with trade
 * counts. Used by the admin panel to pick what to resolve.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { normalizeSeriesMeta, seriesSubtitle } from '../../_lib/series-markets.js';
import { deriveMarketTags, matchesMarketTaxonomy } from '../../_lib/category-tags.js';
import { formatPointsResolutionCandidate } from '../../_lib/points-resolution-candidates.js';
import { PRONOS_TREASURY_USERNAME } from '../../_lib/points-limit-orders.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

function cryptoIntervalFromResolverConfig(resolverCfg) {
  if (resolverCfg?.shape !== 'binary-direction') return null;
  const minutes = Number(resolverCfg.intervalMinutes || resolverCfg.windowMinutes || 5);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
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
    subtitle: seriesSubtitle({ gameNumber: meta.gameNumber }),
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const filter = ['all', 'active', 'pending', 'resolved', 'canceled', 'archived'].includes(req.query.status) ? req.query.status : 'all';
  const categoryParam = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
  const categoryFilter = categoryParam && categoryParam !== 'all' ? categoryParam : null;
  const sportParam = typeof req.query.sport === 'string' ? req.query.sport.trim().toLowerCase() : '';
  const sportFilter = sportParam && sportParam !== 'all' ? sportParam : null;
  const leagueParam = typeof req.query.league === 'string' ? req.query.league.trim().toLowerCase() : '';
  const leagueFilter = leagueParam && leagueParam !== 'all' ? leagueParam : null;
  const cryptoTypeParam = typeof req.query.crypto_type === 'string' ? req.query.crypto_type.trim().toLowerCase() : '';
  const cryptoTypeFilter = ['5min', 'general'].includes(cryptoTypeParam) ? cryptoTypeParam : null;
  const geoParam = typeof req.query.geo === 'string' ? req.query.geo.trim().toLowerCase() : '';
  const geoFilter = geoParam && geoParam !== 'all' ? geoParam : null;
  const topicParam = typeof req.query.topic === 'string' ? req.query.topic.trim().toLowerCase() : '';
  const topicFilter = topicParam && topicParam !== 'all' ? topicParam : null;
  // Same mode split as the public /api/points/markets — lets the MVP
  // admin query only on-chain markets while Points admin stays on
  // off-chain ones. Default 'points' (matches the public endpoint
  // default) so markets registered through MVP admin never surface in
  // the Points admin lists. `?mode=all` keeps the legacy behaviour for
  // any tooling that wants every row regardless of mode.
  const modeParam = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : '';
  const modeFilter = modeParam === 'onchain' ? 'onchain'
                    : modeParam === 'all'    ? null
                    : 'points';
  // Chain filter: MVP admin scopes to whatever chain is currently
  // active (Sepolia 421614, Arbitrum One 42161, etc). When omitted the
  // admin sees markets across every chain.
  const chainIdRaw = req.query.chain_id;
  const chainIdFilter = Number.isFinite(Number(chainIdRaw)) && Number(chainIdRaw) > 0
    ? Number(chainIdRaw)
    : null;
  // By default we hide archived (soft-deleted) rows from the admin
  // lists too — they only surface on the explicit `status=archived`
  // tab or when `show_archived=1`.
  const showArchived = req.query.show_archived === '1' || filter === 'archived';

  try {
    await ensurePointsSchema(schemaSql);
    // Parallel legs (parent_id IS NOT NULL) are implicit children of
    // their parent — hiding them here keeps the admin table uncluttered
    // for markets with many outcomes. Admin resolves the parent; the
    // resolve endpoint cascades to every leg.
    //
    // Push the cheap filters into SQL before LIMIT. This matters for
    // curation: after "Ocultar mercados", hidden active rows still need
    // to be reachable in admin so a BTC 12h market can be marked as a
    // tournament override and shown publicly again.
    let rows;
    if (filter === 'archived') {
      rows = await sql`
        SELECT m.*, pm.id AS pending_id, pm.status AS pending_status, pm.source_data AS pending_source_data,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_count
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.parent_id IS NULL
          AND m.archived_at IS NOT NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${categoryFilter}::text IS NULL OR m.category = ${categoryFilter}::text OR COALESCE(m.category_tags, '[]'::jsonb) ? ${categoryFilter}::text)
          AND (${sportFilter}::text IS NULL OR m.sport = ${sportFilter}::text)
          AND (${leagueFilter}::text IS NULL OR m.league = ${leagueFilter}::text)
          AND (
            ${cryptoTypeFilter}::text IS NULL
            OR (${cryptoTypeFilter}::text = '5min' AND m.resolver_config->>'shape' = 'binary-direction')
            OR (${cryptoTypeFilter}::text = 'general' AND COALESCE(m.resolver_config->>'shape', '') <> 'binary-direction')
          )
        ORDER BY m.archived_at DESC
        LIMIT 2000
      `;
    } else if (filter === 'all') {
      rows = await sql`
        SELECT m.*, pm.id AS pending_id, pm.status AS pending_status, pm.source_data AS pending_source_data,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_count
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.parent_id IS NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
          AND (${categoryFilter}::text IS NULL OR m.category = ${categoryFilter}::text OR COALESCE(m.category_tags, '[]'::jsonb) ? ${categoryFilter}::text)
          AND (${sportFilter}::text IS NULL OR m.sport = ${sportFilter}::text)
          AND (${leagueFilter}::text IS NULL OR m.league = ${leagueFilter}::text)
          AND (
            ${cryptoTypeFilter}::text IS NULL
            OR (${cryptoTypeFilter}::text = '5min' AND m.resolver_config->>'shape' = 'binary-direction')
            OR (${cryptoTypeFilter}::text = 'general' AND COALESCE(m.resolver_config->>'shape', '') <> 'binary-direction')
          )
        ORDER BY m.created_at DESC
        LIMIT 2000
      `;
    } else if (filter === 'pending') {
      rows = await sql`
        SELECT m.*, pm.id AS pending_id, pm.status AS pending_status, pm.source_data AS pending_source_data,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_count
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.status = 'active'
          AND m.parent_id IS NULL
          AND m.end_time IS NOT NULL
          AND m.end_time < NOW()
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
          AND (${categoryFilter}::text IS NULL OR m.category = ${categoryFilter}::text OR COALESCE(m.category_tags, '[]'::jsonb) ? ${categoryFilter}::text)
          AND (${sportFilter}::text IS NULL OR m.sport = ${sportFilter}::text)
          AND (${leagueFilter}::text IS NULL OR m.league = ${leagueFilter}::text)
          AND (
            ${cryptoTypeFilter}::text IS NULL
            OR (${cryptoTypeFilter}::text = '5min' AND m.resolver_config->>'shape' = 'binary-direction')
            OR (${cryptoTypeFilter}::text = 'general' AND COALESCE(m.resolver_config->>'shape', '') <> 'binary-direction')
          )
        ORDER BY m.end_time ASC
        LIMIT 2000
      `;
    } else {
      rows = await sql`
        SELECT m.*, pm.id AS pending_id, pm.status AS pending_status, pm.source_data AS pending_source_data,
          (SELECT COUNT(*)::int FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_count
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
        WHERE m.status = ${filter} AND m.parent_id IS NULL
          AND (${modeFilter}::text IS NULL OR COALESCE(m.mode, 'points') = ${modeFilter}::text)
          AND (${chainIdFilter}::integer IS NULL OR m.chain_id = ${chainIdFilter}::integer)
          AND (${showArchived} OR m.archived_at IS NULL)
          AND (${categoryFilter}::text IS NULL OR m.category = ${categoryFilter}::text OR COALESCE(m.category_tags, '[]'::jsonb) ? ${categoryFilter}::text)
          AND (${sportFilter}::text IS NULL OR m.sport = ${sportFilter}::text)
          AND (${leagueFilter}::text IS NULL OR m.league = ${leagueFilter}::text)
          AND (
            ${cryptoTypeFilter}::text IS NULL
            OR (${cryptoTypeFilter}::text = '5min' AND m.resolver_config->>'shape' = 'binary-direction')
            OR (${cryptoTypeFilter}::text = 'general' AND COALESCE(m.resolver_config->>'shape', '') <> 'binary-direction')
          )
        ORDER BY
          CASE WHEN ${filter}::text = 'resolved' THEN m.resolved_at END DESC NULLS LAST,
          CASE WHEN ${filter}::text = 'active'
                AND m.start_time IS NOT NULL
                AND m.start_time <= NOW()
                AND m.end_time > NOW() THEN 0 ELSE 1 END,
          CASE WHEN ${filter}::text = 'active' THEN m.end_time END ASC NULLS LAST,
          m.created_at DESC
        LIMIT 2000
      `;
    }

    const filteredRows = rows.filter(r => matchesMarketTaxonomy({
      ...r,
      source_data: parseJsonb(r.pending_source_data, {}),
      resolver_config: parseJsonb(r.resolver_config, {}),
      category_tags: parseJsonb(r.category_tags, []),
      geo_tags: parseJsonb(r.geo_tags, []),
      topic_tags: parseJsonb(r.topic_tags, []),
      crypto5min: parseJsonb(r.resolver_config, null)?.shape === 'binary-direction',
    }, {
      category: categoryFilter,
      sport: sportFilter,
      league: leagueFilter,
      cryptoType: cryptoTypeFilter,
      geo: geoFilter,
      topic: topicFilter,
    })).slice(0, 200);

    const parallelIds = filteredRows
      .filter(r => r.amm_mode === 'parallel')
      .map(r => Number(r.id))
      .filter(Number.isInteger);
    const legsByParent = new Map();
    if (parallelIds.length > 0) {
      const legRows = await sql`
        SELECT l.id, l.parent_id, l.leg_label, l.reserves, l.seed_liquidity,
               l.seed_liquidities, l.status, l.outcome,
               (SELECT COUNT(*)::int
                  FROM points_trades t
                 WHERE t.market_id = l.id
                   AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_count
          FROM points_markets l
         WHERE l.parent_id = ANY(${parallelIds})
           AND l.archived_at IS NULL
         ORDER BY l.parent_id ASC, l.id ASC
      `;
      for (const leg of legRows) {
        const parentId = Number(leg.parent_id);
        if (!legsByParent.has(parentId)) legsByParent.set(parentId, []);
        legsByParent.get(parentId).push(leg);
      }
    }

    const candidateByMarket = new Map();
    if (filteredRows.length > 0) {
      const ids = filteredRows.map(r => Number(r.id)).filter(Number.isInteger);
      const candidateRows = await sql.query(
        `SELECT *
           FROM points_resolution_candidates
          WHERE status = 'pending'
            AND points_market_id = ANY($1::int[])
          ORDER BY created_at DESC`,
        [ids],
      );
      const rowsArray = Array.isArray(candidateRows) ? candidateRows : (candidateRows.rows || []);
      for (const row of rowsArray) {
        const marketId = Number(row.points_market_id);
        if (!candidateByMarket.has(marketId)) {
          candidateByMarket.set(marketId, row);
        }
      }
    }

    return res.status(200).json({
      markets: filteredRows.map(r => {
        const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
        const resolverConfig = parseJsonb(r.resolver_config, null);
        const cryptoIntervalMinutes = cryptoIntervalFromResolverConfig(resolverConfig);
        const tags = deriveMarketTags({
          ...r,
          source_data: parseJsonb(r.pending_source_data, {}),
          resolver_config: resolverConfig || {},
          category_tags: parseJsonb(r.category_tags, []),
          geo_tags: parseJsonb(r.geo_tags, []),
          topic_tags: parseJsonb(r.topic_tags, []),
        });
        return {
        id: r.id,
        source: r.source || null,
        sourceEventId: r.source_event_id || null,
        question: r.question,
        category: r.category,
        icon: null,
        outcomes,
        outcomeImages: parseJsonb(r.outcome_images, null),
        reserves: parseJsonb(r.reserves, []).map(Number),
        seedLiquidity: Number(r.seed_liquidity || 0),
        parallelLegs: r.amm_mode === 'parallel'
          ? (legsByParent.get(Number(r.id)) || []).map((leg) => ({
            id: leg.id,
            label: leg.leg_label || null,
            reserves: parseJsonb(leg.reserves, []).map(Number),
            seedLiquidity: Number(leg.seed_liquidity || 0),
            seedLiquidities: parseJsonb(leg.seed_liquidities, null),
            status: leg.status,
            outcome: leg.outcome,
            tradeCount: Number(leg.trade_count || 0),
          }))
          : null,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        pendingId: r.pending_id || null,
        pendingStatus: r.pending_status || null,
        ammMode: r.amm_mode || 'unified',
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        tradeCount: r.trade_count || 0,
        featured: r.featured === true || r.featured === false ? r.featured : true,
        hiddenFromHome: r.hidden_from_home === true,
        tournamentFeatured: r.tournament_featured === true,
        resolverType: r.resolver_type || null,
        mode: r.mode || 'points',
        chainId: r.chain_id || null,
        chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
        chainAddress: r.chain_address || null,
        sport: r.sport || null,
        league: r.league || null,
        archivedAt: r.archived_at || null,
        finalScore: r.final_score || null,
        resolverConfig,
        crypto5min: resolverConfig?.shape === 'binary-direction',
        cryptoIntervalMinutes,
        cryptoWindowMinutes: cryptoIntervalMinutes,
        seriesMeta: publicSeriesMetaFromRow(r),
        categoryTags: tags.categoryTags,
        geoTags: tags.geoTags,
        topicTags: tags.topicTags,
        resolutionCandidate: candidateByMarket.has(Number(r.id))
          ? formatPointsResolutionCandidate(candidateByMarket.get(Number(r.id)), outcomes)
          : null,
      };
      }),
    });
  } catch (e) {
    console.error('[admin/markets] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'list_failed' });
  }
}

import { deriveMarketTags, isCryptoFiveMinute } from './category-tags.js';
import { deriveOutcomeCountryLabels } from './outcome-country-labels.js';
import { normalizeSeriesMeta, seriesSubtitle } from './series-markets.js';

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function numericArray(value) {
  const parsed = parseJsonb(value, null);
  return Array.isArray(parsed) ? parsed.map(Number) : null;
}

export function buildProtocolMarketPayload(row = {}) {
  const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
  const prices = numericArray(row.s_prices)
    || (row.s_yes != null ? [Number(row.s_yes), Number(row.s_no)] : null);
  const category = String(row.category || 'general').toLowerCase();
  const sport = firstValue(row.meta_sport, row.sport);
  const league = firstValue(row.meta_league, row.league);
  const source = firstValue(row.meta_source, row.source);
  const sourceEventId = firstValue(row.meta_source_event_id, row.source_event_id);
  const resolverType = firstValue(row.meta_resolver_type, row.resolver_type);
  const resolverConfig = parseJsonb(firstValue(row.meta_resolver_config, row.resolver_config), null);
  const sourceData = parseJsonb(firstValue(
    row.meta_source_data,
    row.protocol_source_data,
    row.source_data,
    row.pending_source_data,
  ), {});
  const outcomeImagesRaw = parseJsonb(firstValue(row.meta_outcome_images, row.outcome_images), null);
  const outcomeImages = Array.isArray(outcomeImagesRaw) && outcomeImagesRaw.length === outcomes.length
    ? outcomeImagesRaw
    : null;
  const tags = deriveMarketTags({
    ...row,
    source,
    source_event_id: sourceEventId,
    sport,
    league,
    resolver_type: resolverType,
    resolver_config: resolverConfig,
    source_data: sourceData,
    category_tags: firstValue(row.meta_category_tags, row.category_tags),
    geo_tags: firstValue(row.meta_geo_tags, row.geo_tags),
    topic_tags: firstValue(row.meta_topic_tags, row.topic_tags),
  });
  const outcomeCountryLabels = deriveOutcomeCountryLabels({
    ...row,
    outcomes,
    sport,
    league,
    source_data: sourceData,
  });
  const seriesMeta = normalizeSeriesMeta({
    resolverConfig,
    sourceData,
    row: {
      ...row,
      outcomes,
      sport,
      league,
      start_time: row.start_time,
    },
  });

  const startMs = row.start_time ? new Date(row.start_time).getTime() : 0;
  const endMs = row.end_time ? new Date(row.end_time).getTime() : 0;
  const isOpenEnded = resolverConfig?.source === 'next-opponent';
  const windowOk = startMs > 0 && endMs > startMs
    && (endMs - startMs) <= 14 * 86_400_000;

  return {
    id: row.id,
    marketId: row.market_id,
    poolAddress: row.pool_address,
    factoryAddress: row.factory_address,
    chainId: row.chain_id != null ? Number(row.chain_id) : null,
    question: row.question,
    category,
    icon: firstValue(row.meta_icon, row.icon),
    outcomes,
    outcomeCount: Number(row.outcome_count) || outcomes.length,
    protocolVersion: row.protocol_version || 'v1',
    startTime: row.start_time || null,
    endTime: row.end_time || null,
    live: !!(!isOpenEnded
      && windowOk
      && startMs <= Date.now()
      && endMs > Date.now()
      && row.status === 'active'),
    status: row.status,
    outcome: row.outcome != null ? Number(row.outcome) : null,
    seedLiquidity: row.seed_liquidity != null ? Number(row.seed_liquidity) : 0,
    prices,
    liquidity: row.s_liquidity != null ? Number(row.s_liquidity) : 0,
    volume24h: row.s_volume != null ? Number(row.s_volume) : 0,
    snapshotAt: row.s_snapshot || null,
    resolutionSource: row.resolution_src || null,
    resolverType,
    resolverSource: resolverConfig?.source || null,
    txHash: row.tx_hash || null,
    createdAt: row.created_at || null,
    resolvedAt: row.resolved_at || null,
    finalScore: firstValue(row.meta_final_score, row.final_score),
    source,
    sourceEventId,
    sport,
    league,
    categoryTags: tags.categoryTags,
    geoTags: tags.geoTags,
    topicTags: tags.topicTags,
    outcomeImages,
    outcomeCountryLabels,
    seriesMeta: seriesMeta ? {
      key: seriesMeta.key,
      leaguePath: seriesMeta.leaguePath,
      league: seriesMeta.league,
      sport: seriesMeta.sport,
      gameNumber: seriesMeta.gameNumber,
      bestOf: seriesMeta.bestOf,
      winTarget: seriesMeta.winTarget,
      guaranteedGames: seriesMeta.guaranteedGames,
      round: seriesMeta.round,
      seasonYear: seriesMeta.seasonYear,
      homeTeam: seriesMeta.homeTeam,
      awayTeam: seriesMeta.awayTeam,
      teams: seriesMeta.teams,
      espnSeriesWins: seriesMeta.espnSeriesWins || null,
      subtitle: seriesSubtitle({ gameNumber: seriesMeta.gameNumber }),
    } : null,
    crypto5min: isCryptoFiveMinute({
      ...row,
      resolver_config: resolverConfig,
    }),
    mode: 'onchain',
  };
}

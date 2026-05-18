import { deriveMarketTags } from './category-tags.js';

export const ALLOWED_PROTOCOL_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup',
]);

export function cleanOptionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeOutcomeImages(outcomeImages, outcomeCount) {
  if (!Array.isArray(outcomeImages) || outcomeImages.length === 0) return { ok: true, value: null };
  if (outcomeImages.length !== outcomeCount) return { ok: false, error: 'outcome_images_length_mismatch' };
  const cleaned = outcomeImages.map(u => typeof u === 'string' ? u.trim() : '');
  if (!cleaned.every(u => u === '' || /^https?:\/\//i.test(u))) {
    return { ok: false, error: 'invalid_outcome_image_url' };
  }
  return { ok: true, value: cleaned };
}

export function factoryAddressForVariant(variant) {
  const raw = String(variant || '').startsWith('v2')
    ? process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS
    : process.env.ONCHAIN_MARKET_FACTORY_ADDRESS;
  return raw ? raw.toLowerCase() : null;
}

export function parallelLegQuestion(parentQuestion, label) {
  const raw = `${parentQuestion.trim()} - ¿${label}?`;
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

export async function upsertProtocolMarketMetadata(sql, {
  result,
  question,
  category,
  icon,
  outcomes,
  endTime,
  resolutionSource,
  seedAmount,
  sport,
  league,
  outcomeImages,
  factoryVariant,
  source,
  sourceEventId,
  startTime,
  resolverType,
  resolverConfig,
  sourceData,
  categoryTags,
  geoTags,
  topicTags,
}) {
  const factoryAddress = factoryAddressForVariant(factoryVariant || result.factoryVariant);
  if (!factoryAddress || !result.marketAddress || result.marketId == null) return null;

  const tags = deriveMarketTags({
    question,
    category,
    sport,
    league,
    source,
    source_event_id: sourceEventId,
    source_data: sourceData || {},
    resolver_type: resolverType,
    resolver_config: resolverConfig || {},
    categoryTags,
    geoTags,
    topicTags,
  });
  const protocolVersion = String(factoryVariant || result.factoryVariant || '').startsWith('v2')
    ? 'v2'
    : 'v1';

  const rows = await sql`
    INSERT INTO protocol_markets (
      chain_id, factory_address, pool_address, market_id,
      question, category, icon, start_time, end_time, resolution_src,
      tx_hash, seed_liquidity, protocol_version, outcome_count, outcomes,
      sport, league, outcome_images, category_tags, geo_tags, topic_tags,
      source, source_event_id, resolver_type, resolver_config
    )
    VALUES (
      ${result.chainId}, ${factoryAddress}, ${String(result.marketAddress).toLowerCase()}, ${result.marketId},
      ${question}, ${category}, ${icon}, ${startTime || null}, ${endTime}, ${resolutionSource},
      ${result.txHash || null}, ${seedAmount}, ${protocolVersion}, ${outcomes.length}, ${JSON.stringify(outcomes)}::jsonb,
      ${sport}, ${league}, ${outcomeImages ? JSON.stringify(outcomeImages) : null}::jsonb,
      ${JSON.stringify(tags.categoryTags)}::jsonb, ${JSON.stringify(tags.geoTags)}::jsonb, ${JSON.stringify(tags.topicTags)}::jsonb,
      ${source || null}, ${sourceEventId || null}, ${resolverType || null}, ${resolverConfig ? JSON.stringify(resolverConfig) : null}::jsonb
    )
    ON CONFLICT (chain_id, factory_address, market_id) DO UPDATE SET
      pool_address = EXCLUDED.pool_address,
      question = EXCLUDED.question,
      category = EXCLUDED.category,
      icon = COALESCE(EXCLUDED.icon, protocol_markets.icon),
      start_time = COALESCE(EXCLUDED.start_time, protocol_markets.start_time),
      end_time = EXCLUDED.end_time,
      resolution_src = EXCLUDED.resolution_src,
      tx_hash = COALESCE(EXCLUDED.tx_hash, protocol_markets.tx_hash),
      seed_liquidity = CASE
        WHEN COALESCE(protocol_markets.seed_liquidity, 0) = 0 THEN EXCLUDED.seed_liquidity
        ELSE protocol_markets.seed_liquidity
      END,
      protocol_version = EXCLUDED.protocol_version,
      outcome_count = EXCLUDED.outcome_count,
      outcomes = EXCLUDED.outcomes,
      sport = COALESCE(EXCLUDED.sport, protocol_markets.sport),
      league = COALESCE(EXCLUDED.league, protocol_markets.league),
      outcome_images = COALESCE(EXCLUDED.outcome_images, protocol_markets.outcome_images),
      category_tags = EXCLUDED.category_tags,
      geo_tags = EXCLUDED.geo_tags,
      topic_tags = EXCLUDED.topic_tags,
      source = COALESCE(EXCLUDED.source, protocol_markets.source),
      source_event_id = COALESCE(EXCLUDED.source_event_id, protocol_markets.source_event_id),
      resolver_type = COALESCE(EXCLUDED.resolver_type, protocol_markets.resolver_type),
      resolver_config = COALESCE(EXCLUDED.resolver_config, protocol_markets.resolver_config)
    RETURNING id
  `;
  return rows?.[0]?.id || null;
}

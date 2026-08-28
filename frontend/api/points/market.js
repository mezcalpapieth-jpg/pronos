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
import {
  applySeriesDetailGateToMarket,
  buildSeriesDetail,
  normalizeSeriesMeta,
  seriesSubtitle,
  teamPairKeyFromMeta,
} from '../_lib/series-markets.js';
import { deriveMarketTags } from '../_lib/category-tags.js';
import { buildEspnLiveScoreConfig } from '../_lib/espn-live-score.js';
import { deriveOutcomeCountryLabels } from '../_lib/outcome-country-labels.js';
import { PRONOS_TREASURY_USERNAME } from '../_lib/points-limit-orders.js';
import { binaryPricesWithBookTrade } from '../_lib/points-display-prices.js';
import { readSession } from '../_lib/session.js';
import { isAdminUsername } from '../_lib/points-admin.js';
import { BANXICO_FIX_RESOLUTION_CRITERIA } from '../_lib/banxico.js';
import { COINGECKO_TOKEN_MCAP_SOURCE } from '../_lib/solana-token-mcap.js';
import {
  WEATHER_MAX_TEMP_RESOLUTION_CRITERIA,
  weatherResolutionCriteriaForBuckets,
} from '../_lib/weather.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeTranscriptTimestampItem(item) {
  if (!item || typeof item !== 'object') return null;
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  const seconds = Number(item.seconds);
  const url = typeof item.url === 'string' && /^https?:\/\//i.test(item.url)
    ? item.url
    : null;
  if (!label && !Number.isFinite(seconds)) return null;
  return {
    label: label || `${Math.max(0, Math.floor(seconds))}s`,
    seconds: Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : null,
    url,
    text: typeof item.text === 'string' ? item.text.slice(0, 180) : null,
  };
}

function normalizeTranscriptPositionItem(item) {
  if (!item || typeof item !== 'object') return null;
  const charIndex = Number(item.charIndex);
  const totalChars = Number(item.totalChars);
  if (!Number.isFinite(charIndex) || charIndex < 0) return null;
  return {
    charIndex: Math.floor(charIndex),
    charEnd: Number.isFinite(Number(item.charEnd)) ? Math.floor(Number(item.charEnd)) : null,
    totalChars: Number.isFinite(totalChars) && totalChars > 0 ? Math.floor(totalChars) : null,
    percent: Number.isFinite(Number(item.percent)) ? Number(item.percent) : null,
    snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 260) : null,
  };
}

function transcriptEvidenceFromResolverConfig(resolverCfg, { includeAdminDetails = false } = {}) {
  if (!resolverCfg || typeof resolverCfg !== 'object') return null;
  const hasTranscriptResult = resolverCfg.transcriptMatchCount != null
    || resolverCfg.transcriptSource
    || Array.isArray(resolverCfg.transcriptRequiredMatchTimestamps)
    || Array.isArray(resolverCfg.transcriptMatchTimestamps)
    || Array.isArray(resolverCfg.transcriptRequiredMatchPositions)
    || Array.isArray(resolverCfg.transcriptMatchPositions);
  if (!hasTranscriptResult) return null;

  const preferredTimestamps = Array.isArray(resolverCfg.transcriptRequiredMatchTimestamps)
    && resolverCfg.transcriptRequiredMatchTimestamps.length > 0
    ? resolverCfg.transcriptRequiredMatchTimestamps
    : resolverCfg.transcriptMatchTimestamps;
  const timestamps = (Array.isArray(preferredTimestamps) ? preferredTimestamps : [])
    .map(normalizeTranscriptTimestampItem)
    .filter(Boolean)
    .slice(0, 10);

  const evidence = {
    phrase: typeof resolverCfg.phrase === 'string' ? resolverCfg.phrase : null,
    matchCount: resolverCfg.transcriptMatchCount == null ? null : Number(resolverCfg.transcriptMatchCount),
    op: typeof resolverCfg.op === 'string' ? resolverCfg.op : null,
    threshold: resolverCfg.threshold == null ? null : Number(resolverCfg.threshold),
    source: typeof resolverCfg.transcriptSource === 'string'
      ? resolverCfg.transcriptSource
      : (typeof resolverCfg.source === 'string' ? resolverCfg.source : null),
    transcriptUrl: typeof resolverCfg.transcriptUrl === 'string' && /^https?:\/\//i.test(resolverCfg.transcriptUrl)
      ? resolverCfg.transcriptUrl
      : null,
    transcriptTitle: typeof resolverCfg.transcriptTitle === 'string' ? resolverCfg.transcriptTitle : null,
    timestamps,
  };

  if (includeAdminDetails) {
    const preferredPositions = Array.isArray(resolverCfg.transcriptRequiredMatchPositions)
      && resolverCfg.transcriptRequiredMatchPositions.length > 0
      ? resolverCfg.transcriptRequiredMatchPositions
      : resolverCfg.transcriptMatchPositions;
    evidence.positions = (Array.isArray(preferredPositions) ? preferredPositions : [])
      .map(normalizeTranscriptPositionItem)
      .filter(Boolean)
      .slice(0, 10);
    evidence.timestampEvidenceUnavailableReason =
      typeof resolverCfg.transcriptTimestampEvidenceUnavailableReason === 'string'
        ? resolverCfg.transcriptTimestampEvidenceUnavailableReason
        : null;
  }

  const countOk = Number.isFinite(Number(evidence.matchCount));
  if (!countOk && evidence.timestamps.length === 0 && (!includeAdminDetails || evidence.positions.length === 0)) {
    return null;
  }
  return evidence;
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

function cryptoMetaFromResolverConfig(resolverCfg) {
  if (resolverCfg?.shape !== 'binary-direction') return null;
  const intervalMinutes = Number(resolverCfg.intervalMinutes || resolverCfg.windowMinutes || 5);
  return {
    asset:            resolverCfg.asset            || null,
    symbol:           resolverCfg.symbol           || null,
    coinbaseProductId:resolverCfg.coinbaseProductId|| null,
    intervalMinutes:  Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 5,
    windowMinutes:    Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 5,
    threshold:        resolverCfg.threshold == null ? null : Number(resolverCfg.threshold),
    openPrice:        resolverCfg.openPrice  == null ? null : Number(resolverCfg.openPrice),
    closePrice:       resolverCfg.closePrice == null ? null : Number(resolverCfg.closePrice),
    openPriceSource:  resolverCfg.openPriceSource  || null,
    openPriceAt:      resolverCfg.openPriceAt      || null,
    closePriceSource: resolverCfg.closePriceSource || null,
    closePriceAt:     resolverCfg.closePriceAt     || null,
    openedAt:         resolverCfg.openedAt          || null,
    closesAt:         resolverCfg.closesAt          || null,
    rounding:         resolverCfg.rounding          || 1,
  };
}

// Solana token market-cap markets carry the token's identity in their
// resolver config. Expose the public bits so the detail page can show
// the token art, its contract address and a CoinGecko link.
function tokenMcapMetaFromResolverConfig(resolverCfg) {
  if (resolverCfg?.source !== COINGECKO_TOKEN_MCAP_SOURCE) return null;
  return {
    symbol:       resolverCfg.symbol       || null,
    coinId:       resolverCfg.coinId       || null,
    network:      resolverCfg.network      || null,
    tokenAddress: resolverCfg.tokenAddress || null,
  };
}

function summarizeCryptoMarketRow(row) {
  const resolverCfg = parseJsonb(row.resolver_config, null);
  const cryptoMeta = cryptoMetaFromResolverConfig(resolverCfg);
  if (!cryptoMeta) return null;
  const outcomes = parseJsonb(row.outcomes, ['SUBE', 'BAJA']);
  const reserves = parseJsonb(row.reserves, []).map(Number);
  return {
    id: row.id,
    question: row.question,
    outcomes,
    prices: pricesFromReserves(reserves, outcomes.length),
    status: row.status,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    finalScore: row.final_score || null,
    startTime: row.start_time,
    endTime: row.end_time,
    cryptoMeta,
  };
}

function publicSeriesMetaFromRow(row, { requireGameNumber = true } = {}) {
  const resolverCfg = parseJsonb(row.resolver_config, null);
  const sourceData = parseJsonb(row.pending_source_data, null);
  const meta = normalizeSeriesMeta({ resolverConfig: resolverCfg, sourceData, row });
  if (!meta) return null;
  if (requireGameNumber && !meta.gameNumber) return null;
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

function summarizeSeriesMarketRow(row, fallbackMeta, rawMeta = null) {
  const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
  const resolvedMeta = rawMeta || publicSeriesMetaFromRow(row, { requireGameNumber: false });
  return {
    id: row.id,
    question: row.question,
    outcomes,
    status: row.status,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    finalScore: row.final_score || null,
    startTime: row.start_time,
    endTime: row.end_time,
    seriesMeta: {
      ...fallbackMeta,
      gameNumber: resolvedMeta?.gameNumber || null,
      espnSeriesWins: resolvedMeta?.espnSeriesWins || fallbackMeta?.espnSeriesWins || null,
    },
  };
}

function summarizePendingSeriesRow(row, fallbackMeta, rawMeta = null) {
  const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
  const resolvedMeta = rawMeta || publicSeriesMetaFromRow(row, { requireGameNumber: false });
  const endMs = row.end_time ? new Date(row.end_time).getTime() : NaN;
  const isPast = Number.isFinite(endMs) && endMs < Date.now();
  return {
    id: null,
    pendingId: row.pending_id || row.id || null,
    question: row.question,
    outcomes,
    status: isPast ? 'resolved' : (row.status || 'pending'),
    outcome: null,
    resolvedAt: null,
    finalScore: null,
    startTime: row.start_time,
    endTime: row.end_time,
    seriesMeta: {
      ...fallbackMeta,
      gameNumber: resolvedMeta?.gameNumber || null,
      espnSeriesWins: resolvedMeta?.espnSeriesWins || fallbackMeta?.espnSeriesWins || null,
    },
  };
}

async function loadSeriesDetail(sqlClient, currentRow, currentMeta) {
  if (!currentMeta?.leaguePath) return null;
  const currentPair = teamPairKeyFromMeta(currentMeta);
  if (!currentPair) return null;
  const anchor = currentRow.start_time || currentRow.end_time || currentRow.created_at;
  if (!anchor) return null;

  const rows = await sqlClient`
    SELECT m.id, m.question, m.outcomes, m.start_time, m.end_time,
           m.status, m.outcome, m.resolved_at, m.final_score,
           m.resolver_config, m.sport, m.league,
           pm.source_data AS pending_source_data
    FROM points_markets m
    LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
    WHERE m.parent_id IS NULL
      AND m.resolver_type = 'sports_api'
      AND m.resolver_config->>'source' = 'espn'
      AND m.resolver_config->>'leaguePath' = ${currentMeta.leaguePath}
      AND m.start_time >= ${anchor}::timestamptz - INTERVAL '45 days'
      AND m.start_time <= ${anchor}::timestamptz + INTERVAL '45 days'
    ORDER BY m.start_time ASC NULLS LAST, m.id ASC
    LIMIT 80
  `;

  let hasExplicitGameNumber = Boolean(currentMeta.gameNumber);
  const siblings = rows
    .map((row) => {
      const meta = publicSeriesMetaFromRow(row, { requireGameNumber: false });
      if (!meta || meta.leaguePath !== currentMeta.leaguePath) return null;
      if (teamPairKeyFromMeta(meta) !== currentPair) return null;
      if (meta.gameNumber) hasExplicitGameNumber = true;
      return summarizeSeriesMarketRow(row, currentMeta, meta);
    })
    .filter(Boolean);

  const pendingRows = await sqlClient`
    SELECT p.id AS pending_id, p.question, p.outcomes, p.start_time, p.end_time,
           p.status, p.resolver_config, p.sport, p.league,
           p.source_data AS pending_source_data
    FROM points_pending_markets p
    WHERE p.approved_market_id IS NULL
      AND p.resolver_type = 'sports_api'
      AND p.resolver_config->>'source' = 'espn'
      AND p.resolver_config->>'leaguePath' = ${currentMeta.leaguePath}
      AND p.start_time >= ${anchor}::timestamptz - INTERVAL '45 days'
      AND p.start_time <= ${anchor}::timestamptz + INTERVAL '45 days'
    ORDER BY p.start_time ASC NULLS LAST, p.id ASC
    LIMIT 80
  `;

  const pendingSiblings = pendingRows
    .map((row) => {
      const meta = publicSeriesMetaFromRow(row, { requireGameNumber: false });
      if (!meta || meta.leaguePath !== currentMeta.leaguePath) return null;
      if (teamPairKeyFromMeta(meta) !== currentPair) return null;
      if (meta.gameNumber) hasExplicitGameNumber = true;
      return summarizePendingSeriesRow(row, currentMeta, meta);
    })
    .filter(Boolean);

  const seriesItems = [...siblings, ...pendingSiblings];
  if (seriesItems.length === 0) return null;
  if (!hasExplicitGameNumber) return null;
  const detail = buildSeriesDetail(currentMeta, seriesItems);
  if (!detail) return null;
  const currentItem = detail.sequence?.find(item => Number(item.id) === Number(currentRow.id));
  const gameNumber = currentItem?.gameNumber || detail.gameNumber || currentMeta.gameNumber || null;
  return {
    ...detail,
    gameNumber,
    subtitle: currentItem?.subtitle || seriesSubtitle({ gameNumber, summary: detail.summary }),
  };
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

    let viewerIsAdmin = false;
    try {
      const session = readSession(req, res);
      viewerIsAdmin = isAdminUsername(session?.username);
    } catch {
      viewerIsAdmin = false;
    }

    try {
      await ensurePointsSchema(schemaSql);

      const rows = await sql`
        SELECT
          m.id, m.parent_id, m.question, m.category, m.outcomes, m.reserves,
          m.seed_liquidity, m.image_url, m.start_time, m.end_time, m.status, m.outcome,
          m.created_at, m.resolved_at, m.final_score, m.amm_mode, m.chart_style,
          m.resolver_type, m.resolver_config, m.sport, m.league, m.category_tags,
          m.geo_tags, m.topic_tags, m.outcome_images, m.mode, m.chain_id,
          m.chain_market_id, m.chain_address, m.archived_at, m.source,
          m.source_event_id,
          pm.source_data AS pending_source_data,
          (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_volume,
          (SELECT MAX(created_at) FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS last_trade_at,
          (SELECT t.outcome_index FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_outcome_index,
          (SELECT t.price_at_trade FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_price,
          (SELECT (t.reserves_before IS NOT NULL AND t.reserves_after IS NOT NULL AND t.reserves_before = t.reserves_after) FROM points_trades t WHERE t.market_id = m.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_is_book
        FROM points_markets m
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
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
      const sourceData = parseJsonb(r.pending_source_data, {});
      const outcomeCountryLabels = deriveOutcomeCountryLabels({
        ...r,
        outcomes,
        source_data: sourceData,
      });

      // Expose resolver metadata in a minimal shape — just the type +
      // source name from the config, nothing auth-related. Frontend
      // maps (type, source) → a human label ("Chainlink", "ESPN", …).
      const resolverCfg = parseJsonb(r.resolver_config, null);
      const resolverType = r.resolver_type || null;
      const resolverSource = resolverCfg?.source || null;
      const transcriptEvidence = viewerIsAdmin
        ? transcriptEvidenceFromResolverConfig(resolverCfg, { includeAdminDetails: true })
        : null;
      const resolutionCriteria =
        (typeof resolverCfg?.criteria === 'string' && resolverCfg.criteria.trim())
        || (typeof sourceData?.resolutionCriteria === 'string' && sourceData.resolutionCriteria.trim())
        || (resolverSource === 'banxico-fix' ? BANXICO_FIX_RESOLUTION_CRITERIA : null)
        || (resolverType === 'weather_api' && Array.isArray(resolverCfg?.buckets)
          ? weatherResolutionCriteriaForBuckets(resolverCfg.buckets, {
              resolutionSource: resolverCfg?.resolutionSource || null,
            })
          : null)
        || (resolverType === 'weather_api' ? WEATHER_MAX_TEMP_RESOLUTION_CRITERIA : null)
        || null;
      const tokenMeta = tokenMcapMetaFromResolverConfig(resolverCfg);
      const liveScoreConfig = buildEspnLiveScoreConfig({
        resolverType,
        resolverConfig: resolverCfg,
        sourceData,
        sport: r.sport || null,
        league: r.league || null,
        startTime: r.start_time,
      });
      const tags = deriveMarketTags({
        ...r,
        source_data: sourceData,
        resolver_config: resolverCfg,
        category_tags: parseJsonb(r.category_tags, []),
        geo_tags: parseJsonb(r.geo_tags, []),
        topic_tags: parseJsonb(r.topic_tags, []),
      });
      const baseSeriesMeta = publicSeriesMetaFromRow(r, { requireGameNumber: false });
      const seriesMeta = baseSeriesMeta
        ? await loadSeriesDetail(sql, r, baseSeriesMeta).catch(() => (
            baseSeriesMeta.gameNumber ? baseSeriesMeta : null
          ))
        : null;

      // Crypto-5min direction markets ship a small public metadata
      // bundle so the live-chart UI can render threshold + asset
      // without needing to refetch resolver_config separately.
      // Fields here are display-only — feedAddress / chainId stay
      // server-side. Null for any other market shape.
      let cryptoMeta = cryptoMetaFromResolverConfig(resolverCfg);
      if (cryptoMeta) {
        cryptoMeta = {
          ...cryptoMeta,
          nextMarketId: null,  // populated below when a pending sibling exists
          prevMarketId: null,  // populated below when an older sibling is still on the books
          marketSequence: [],
          alternateAssetMarket: null,
        };
      }

      // Look up sibling 5-min windows for the same asset so the detail
      // page can render Próximo / Anterior CTAs and the user can hop
      // between consecutive markets without bouncing back to the grid.
      // Lifecycle:
      //   - The cron pre-creates each upcoming window as 'pending' a
      //     full window before activation, so an active market almost
      //     always has a nextMarketId.
      //   - Resolved markets stay on the books for 24h (archive window)
      //     before being soft-deleted; during that time the next market
      //     can still find them via prevMarketId for back-navigation.
      if (cryptoMeta && r.end_time) {
        try {
          const sib = await sql`
            SELECT id FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND start_time = ${r.end_time}
              AND id <> ${r.id}
              AND archived_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `;
          if (sib.length > 0) {
            cryptoMeta = { ...cryptoMeta, nextMarketId: sib[0].id };
          }
        } catch { /* surfacing this as a hard failure isn't worth it */ }
      }
      if (cryptoMeta && r.start_time) {
        try {
          const prev = await sql`
            SELECT id FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND end_time = ${r.start_time}
              AND id <> ${r.id}
              AND archived_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `;
          if (prev.length > 0) {
            cryptoMeta = { ...cryptoMeta, prevMarketId: prev[0].id };
          }
        } catch { /* same — best-effort */ }
      }
      if (cryptoMeta && r.start_time) {
        try {
          const sequenceWindowMinutes = Math.max(15, Number(cryptoMeta.intervalMinutes || 5) * 3);
          const sequenceRows = await sql`
            SELECT id, question, outcomes, reserves, start_time, end_time,
                   status, outcome, resolved_at, final_score, resolver_config
            FROM points_markets
            WHERE resolver_config->>'source' = 'chainlink'
              AND resolver_config->>'shape'  = 'binary-direction'
              AND resolver_config->>'asset'  = ${cryptoMeta.asset || ''}
              AND start_time >= ${r.start_time}::timestamptz - (${sequenceWindowMinutes} * INTERVAL '1 minute')
              AND start_time <= ${r.start_time}::timestamptz + (${sequenceWindowMinutes} * INTERVAL '1 minute')
              AND archived_at IS NULL
            ORDER BY start_time ASC, id ASC
            LIMIT 9
          `;
          const marketSequence = sequenceRows
            .map(summarizeCryptoMarketRow)
            .filter(Boolean);
          if (marketSequence.length > 0) {
            cryptoMeta = { ...cryptoMeta, marketSequence };
          }
        } catch { /* best-effort; the main market payload is enough to render */ }
      }
      if (cryptoMeta && r.start_time) {
        const alternateAsset = cryptoMeta.asset === 'btc'
          ? 'eth'
          : cryptoMeta.asset === 'eth'
            ? 'btc'
            : null;
        if (alternateAsset) {
          try {
            const alternateRows = await sql`
              SELECT id, resolver_config
              FROM points_markets
              WHERE resolver_config->>'source' = 'chainlink'
                AND resolver_config->>'shape'  = 'binary-direction'
                AND resolver_config->>'asset'  = ${alternateAsset}
                AND start_time = ${r.start_time}
                AND archived_at IS NULL
              ORDER BY id DESC
              LIMIT 1
            `;
            if (alternateRows.length > 0) {
              const altMeta = cryptoMetaFromResolverConfig(parseJsonb(alternateRows[0].resolver_config, null));
              cryptoMeta = {
                ...cryptoMeta,
                alternateAssetMarket: {
                  id: alternateRows[0].id,
                  asset: altMeta?.asset || alternateAsset,
                  symbol: altMeta?.symbol || (alternateAsset === 'eth' ? 'ETH/USD' : 'BTC/USD'),
                },
              };
            }
          } catch { /* optional affordance only */ }
        }
      }

      if (ammMode === 'parallel') {
        const legRows = await sql`
          SELECT l.id, l.leg_label, l.reserves, l.seed_liquidity, l.status, l.outcome,
            (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = l.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS trade_volume,
            (SELECT MAX(created_at) FROM points_trades t WHERE t.market_id = l.id AND t.username <> ${PRONOS_TREASURY_USERNAME}) AS last_trade_at,
            (SELECT t.outcome_index FROM points_trades t WHERE t.market_id = l.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_outcome_index,
            (SELECT t.price_at_trade FROM points_trades t WHERE t.market_id = l.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_price,
            (SELECT (t.reserves_before IS NOT NULL AND t.reserves_after IS NOT NULL AND t.reserves_before = t.reserves_after) FROM points_trades t WHERE t.market_id = l.id AND t.username <> ${PRONOS_TREASURY_USERNAME} AND t.price_at_trade IS NOT NULL ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS display_trade_is_book
          FROM points_markets l
          WHERE l.parent_id = ${r.id}
            AND l.status <> 'canceled'
          ORDER BY l.id ASC
        `;
        const legs = legRows.map((l, i) => {
          const lr = parseJsonb(l.reserves, []).map(Number);
          const basePrices = binaryLegPricesFromRow({
            reserves: lr,
            status: l.status,
            outcome: l.outcome,
          }, 1 / outcomes.length);
          const displayPrices = binaryPricesWithBookTrade(basePrices, {
            status: l.status,
            outcomeIndex: l.display_trade_outcome_index,
            price: l.display_trade_price,
            isBookTrade: l.display_trade_is_book,
          });
          return {
            id: l.id,
            outcomeIndex: i,
            label: l.leg_label || outcomes[i] || `Opción ${i + 1}`,
            reserves: lr,
            prices: displayPrices,          // [YES, NO] for the leg
            seedLiquidity: Number(l.seed_liquidity || 0),
            tradeVolume: Number(l.trade_volume || 0),
            lastTradeAt: l.last_trade_at,
            status: l.status,
            outcome: l.outcome,             // 0 if this leg's YES won, 1 if NO won
          };
        });
        const seedTotal = legs.reduce((s, l) => s + l.seedLiquidity, 0);
        const tradeTotal = legs.reduce((s, l) => s + l.tradeVolume, 0);
        const lastTradeAt = legs.reduce((latest, leg) => {
          const next = leg.lastTradeAt ? new Date(leg.lastTradeAt).getTime() : NaN;
          const current = latest ? new Date(latest).getTime() : NaN;
          return Number.isFinite(next) && (!Number.isFinite(current) || next > current)
            ? leg.lastTradeAt
            : latest;
        }, r.last_trade_at || null);
        const marketPayload = applySeriesDetailGateToMarket({
            id: r.id,
            ammMode: 'parallel',
            question: r.question,
            category: r.category,
            imageUrl: r.image_url || null,
            icon: null,
            outcomes,
            chartStyle: r.chart_style || null,
            reserves: [],
            prices: legs.map(l => l.prices[0] ?? 1 / outcomes.length),
            seedLiquidity: seedTotal,
            volume: seedTotal,
            tradeVolume: tradeTotal,
            lastTradeAt,
            startTime: r.start_time,
            endTime: r.end_time,
            status: r.status,
            outcome: r.outcome,
            resolvedAt: r.resolved_at,
            finalScore: r.final_score || null,
            createdAt: r.created_at,
            resolverType,
            resolverSource,
            resolutionCriteria,
            transcriptEvidence,
            liveScoreConfig,
            cryptoMeta,
            tokenMeta,
            seriesMeta,
            sport: r.sport || null,
            league: r.league || null,
            categoryTags: tags.categoryTags,
            geoTags: tags.geoTags,
            topicTags: tags.topicTags,
            outcomeImages,
            outcomeCountryLabels,
            mode: r.mode || 'points',
            chainId: r.chain_id || null,
            chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
            chainAddress: r.chain_address || null,
          }, seriesMeta);
        return res.status(200).json({
          market: marketPayload,
          legs,
        });
      }

      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = binaryPricesWithBookTrade(pricesFromReserves(reserves, outcomes.length), {
        status: r.status,
        outcomeIndex: r.display_trade_outcome_index,
        price: r.display_trade_price,
        isBookTrade: r.display_trade_is_book,
      });

      const marketPayload = applySeriesDetailGateToMarket({
          id: r.id,
          ammMode: 'unified',
          question: r.question,
          category: r.category,
          imageUrl: r.image_url || null,
          icon: null,
          outcomes,
          chartStyle: r.chart_style || null,
          reserves,
          prices,
          seedLiquidity: Number(r.seed_liquidity || 0),
          volume: Number(r.seed_liquidity || 0),
          tradeVolume: Number(r.trade_volume || 0),
          lastTradeAt: r.last_trade_at,
          startTime: r.start_time,
          endTime: r.end_time,
          status: r.status,
          outcome: r.outcome,
          resolvedAt: r.resolved_at,
          finalScore: r.final_score || null,
          createdAt: r.created_at,
          resolverType,
          resolverSource,
          resolutionCriteria,
          transcriptEvidence,
          liveScoreConfig,
          cryptoMeta,
          tokenMeta,
          seriesMeta,
          sport: r.sport || null,
          league: r.league || null,
          categoryTags: tags.categoryTags,
          geoTags: tags.geoTags,
          topicTags: tags.topicTags,
          outcomeImages,
          outcomeCountryLabels,
          mode: r.mode || 'points',
          chainId: r.chain_id || null,
          chainMarketId: r.chain_market_id ? String(r.chain_market_id) : null,
          chainAddress: r.chain_address || null,
          archivedAt: r.archived_at || null,
        }, seriesMeta);
      return res.status(200).json({
        market: marketPayload,
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

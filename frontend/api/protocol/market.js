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
import { ensureProtocolSchema } from '../_lib/protocol-schema.js';
import { buildProtocolMarketPayload } from '../_lib/protocol-market-payload.js';
import {
  applySeriesDetailGateToMarket,
  buildSeriesDetail,
  normalizeSeriesMeta,
  seriesSubtitle,
  teamPairKeyFromMeta,
} from '../_lib/series-markets.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);
const TRADES_TAIL = 30;
const REDEMPTIONS_TAIL = 20;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function publicSeriesMetaFromRow(row, { requireGameNumber = true } = {}) {
  const resolverCfg = parseJsonb(row.meta_resolver_config ?? row.resolver_config, null);
  const sourceData = parseJsonb(row.meta_source_data ?? row.protocol_source_data ?? row.pending_source_data, null);
  const outcomes = parseJsonb(row.outcomes, []);
  const meta = normalizeSeriesMeta({
    resolverConfig: resolverCfg,
    sourceData,
    row: {
      ...row,
      outcomes,
      sport: row.meta_sport || row.sport || null,
      league: row.meta_league || row.league || null,
    },
  });
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
    finalScore: row.meta_final_score || row.final_score || null,
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
           ppm.source_data AS protocol_source_data
      FROM protocol_markets m
      LEFT JOIN protocol_pending_markets ppm ON ppm.approved_protocol_market_id = m.id
     WHERE m.chain_id = ${currentRow.chain_id}
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
           p.source_data AS protocol_source_data
      FROM protocol_pending_markets p
     WHERE p.approved_protocol_market_id IS NULL
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
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const id = Number.parseInt(req.query.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  try {
    await ensureProtocolSchema(schemaSql);
    const rows = await sql`
      SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
             m.question, m.category, m.icon, m.sport, m.league, m.outcome_images,
             m.category_tags, m.geo_tags, m.topic_tags,
             m.source, m.source_event_id, m.resolver_type, m.resolver_config,
             m.outcomes, m.outcome_count,
             m.protocol_version, m.start_time, m.end_time, m.status, m.featured, m.previous_status,
             m.lifecycle_note, m.lifecycle_updated_at, m.lifecycle_updated_by,
             m.canceled_at, m.dispute_opened_at, m.outcome,
             m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at, m.final_score,
             m.resolution_src,
             COALESCE(pmp.icon, pm.icon) AS meta_icon,
             COALESCE(pmp.sport, pm.sport) AS meta_sport,
             COALESCE(pmp.league, pm.league) AS meta_league,
             COALESCE(pmp.outcome_images, pm.outcome_images) AS meta_outcome_images,
             COALESCE(pmp.category_tags, pm.category_tags) AS meta_category_tags,
             COALESCE(pmp.geo_tags, pm.geo_tags) AS meta_geo_tags,
             COALESCE(pmp.topic_tags, pm.topic_tags) AS meta_topic_tags,
             COALESCE(pmp.source, pm.source) AS meta_source,
             COALESCE(pmp.source_event_id, pm.source_event_id) AS meta_source_event_id,
             COALESCE(pmp.resolver_type, pm.resolver_type) AS meta_resolver_type,
             COALESCE(pmp.resolver_config, pm.resolver_config) AS meta_resolver_config,
             ppm.source_data AS meta_source_data,
             pppm.source_data AS protocol_source_data,
             COALESCE(pmp.final_score, pm.final_score) AS meta_final_score,
             s.yes_price AS s_yes, s.no_price AS s_no, s.prices AS s_prices,
             s.liquidity AS s_liquidity, s.volume_24h AS s_volume,
             s.snapshot_at AS s_snapshot
        FROM protocol_markets m
        LEFT JOIN points_markets pm
          ON COALESCE(pm.mode, 'points') = 'onchain'
         AND pm.chain_id = m.chain_id
         AND LOWER(pm.chain_address) = LOWER(m.pool_address)
        LEFT JOIN points_markets pmp ON pmp.id = pm.parent_id
        LEFT JOIN points_pending_markets ppm ON ppm.approved_market_id = COALESCE(pm.parent_id, pm.id)
        LEFT JOIN protocol_pending_markets pppm ON pppm.approved_protocol_market_id = m.id
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
    const market = buildProtocolMarketPayload(r);
    const baseSeriesMeta = publicSeriesMetaFromRow(r, { requireGameNumber: false });
    const seriesMeta = baseSeriesMeta
      ? await loadSeriesDetail(sql, r, baseSeriesMeta).catch(() => (
          baseSeriesMeta.gameNumber ? baseSeriesMeta : null
        ))
      : null;
    if (seriesMeta) market.seriesMeta = seriesMeta;
    const gatedMarket = applySeriesDetailGateToMarket(market, seriesMeta);

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
      market: gatedMarket,
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

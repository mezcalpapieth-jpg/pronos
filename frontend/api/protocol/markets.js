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
import { ensureProtocolSchema } from '../_lib/protocol-schema.js';
import { buildProtocolMarketPayload } from '../_lib/protocol-market-payload.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

const ALLOWED_STATUS = new Set(['active', 'resolved', 'canceled', 'disputed', 'all']);
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

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
    await ensureProtocolSchema(schemaSql);
    // LATERAL join pulls the most recent price snapshot per market.
    // Old PG driver versions complain when the LATERAL alias clashes
    // with main columns, so we prefix the snapshot fields with `s_`.
    let rows;
    if (status === 'all') {
      rows = await sql`
        SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
               m.question, m.category, m.icon, m.sport, m.league, m.outcome_images,
               m.category_tags, m.geo_tags, m.topic_tags,
               m.source, m.source_event_id, m.resolver_type, m.resolver_config,
               m.outcomes, m.outcome_count,
               m.protocol_version, m.start_time, m.end_time, m.status, m.featured, m.previous_status,
               m.lifecycle_note, m.lifecycle_updated_at, m.lifecycle_updated_by,
               m.canceled_at, m.dispute_opened_at, m.outcome,
               m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at, m.final_score,
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
               rc.id AS resolution_candidate_id,
               rc.protocol_market_id AS resolution_candidate_market_id,
               rc.resolver_type AS resolution_candidate_resolver_type,
               rc.source AS resolution_candidate_source,
               rc.source_event_id AS resolution_candidate_source_event_id,
               rc.outcome_index AS resolution_candidate_outcome_index,
               rc.outcome_count AS resolution_candidate_outcome_count,
               rc.confidence_bps AS resolution_candidate_confidence_bps,
               rc.observed_at AS resolution_candidate_observed_at,
               rc.final_score AS resolution_candidate_final_score,
               rc.evidence_url AS resolution_candidate_evidence_url,
               rc.evidence AS resolution_candidate_evidence,
               rc.rationale AS resolution_candidate_rationale,
               rc.status AS resolution_candidate_status,
               rc.created_at AS resolution_candidate_created_at,
               rc.reviewed_at AS resolution_candidate_reviewed_at,
               rc.reviewer AS resolution_candidate_reviewer,
               rc.admin_note AS resolution_candidate_admin_note,
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
            SELECT id, protocol_market_id, resolver_type, source, source_event_id,
                   outcome_index, outcome_count, confidence_bps, observed_at,
                   final_score, evidence_url, evidence, rationale, status,
                   created_at, reviewed_at, reviewer, admin_note
              FROM protocol_resolution_candidates
             WHERE protocol_market_id = m.id
               AND status = 'pending'
             ORDER BY created_at DESC
             LIMIT 1
          ) rc ON TRUE
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
               m.question, m.category, m.icon, m.sport, m.league, m.outcome_images,
               m.category_tags, m.geo_tags, m.topic_tags,
               m.source, m.source_event_id, m.resolver_type, m.resolver_config,
               m.outcomes, m.outcome_count,
               m.protocol_version, m.start_time, m.end_time, m.status, m.featured, m.previous_status,
               m.lifecycle_note, m.lifecycle_updated_at, m.lifecycle_updated_by,
               m.canceled_at, m.dispute_opened_at, m.outcome,
               m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at, m.final_score,
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
               rc.id AS resolution_candidate_id,
               rc.protocol_market_id AS resolution_candidate_market_id,
               rc.resolver_type AS resolution_candidate_resolver_type,
               rc.source AS resolution_candidate_source,
               rc.source_event_id AS resolution_candidate_source_event_id,
               rc.outcome_index AS resolution_candidate_outcome_index,
               rc.outcome_count AS resolution_candidate_outcome_count,
               rc.confidence_bps AS resolution_candidate_confidence_bps,
               rc.observed_at AS resolution_candidate_observed_at,
               rc.final_score AS resolution_candidate_final_score,
               rc.evidence_url AS resolution_candidate_evidence_url,
               rc.evidence AS resolution_candidate_evidence,
               rc.rationale AS resolution_candidate_rationale,
               rc.status AS resolution_candidate_status,
               rc.created_at AS resolution_candidate_created_at,
               rc.reviewed_at AS resolution_candidate_reviewed_at,
               rc.reviewer AS resolution_candidate_reviewer,
               rc.admin_note AS resolution_candidate_admin_note,
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
            SELECT id, protocol_market_id, resolver_type, source, source_event_id,
                   outcome_index, outcome_count, confidence_bps, observed_at,
                   final_score, evidence_url, evidence, rationale, status,
                   created_at, reviewed_at, reviewer, admin_note
              FROM protocol_resolution_candidates
             WHERE protocol_market_id = m.id
               AND status = 'pending'
             ORDER BY created_at DESC
             LIMIT 1
          ) rc ON TRUE
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

    const markets = rows.map(r => buildProtocolMarketPayload(r));

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({ markets });
  } catch (e) {
    console.error('[protocol/markets] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'markets_failed' });
  }
}

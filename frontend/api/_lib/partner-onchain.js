import { buildProtocolMarketPayload } from './protocol-market-payload.js';
import { protocolChainConfig } from './onchain-trader.js';

export const PARTNER_ONCHAIN_API_VERSION = '2026-09-21';

export const PARTNER_ONCHAIN_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-PRONOS-PARTNER',
].join(', ');

function cleanString(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function applyPartnerCors(req, res, { methods = 'GET, POST, OPTIONS' } = {}) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', PARTNER_ONCHAIN_HEADERS);
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return res;
  }
  return null;
}

export function normalizeStatus(value) {
  const status = cleanString(value || 'active').toLowerCase();
  return ['active', 'resolved', 'canceled', 'disputed', 'all'].includes(status)
    ? status
    : 'active';
}

export function normalizeLimit(value, { fallback = 100, max = 200 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export function normalizeChainId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function normalizeMarketLookup(value) {
  const raw = cleanString(value);
  if (/^0x[a-f0-9]{40}$/i.test(raw)) {
    return { dbId: null, chainMarketId: null, poolAddress: raw.toLowerCase() };
  }
  const id = Number.parseInt(raw, 10);
  if (Number.isInteger(id) && id > 0) {
    return { dbId: id, chainMarketId: id, poolAddress: null };
  }
  return { dbId: null, chainMarketId: null, poolAddress: null };
}

export function normalizeWalletAddress(value) {
  const raw = cleanString(value).toLowerCase();
  return /^0x[a-f0-9]{40}$/i.test(raw) ? raw : null;
}

export function normalizeAction(value) {
  const action = cleanString(value || 'buy').toLowerCase();
  if (['buy', 'sell', 'redeem'].includes(action)) return action;
  return null;
}

export function normalizeOutcomeIndex(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function publicBaseUrl(req) {
  const configured = cleanString(process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const host = req?.headers?.host;
  if (!host) return 'https://pronos.io';
  const proto = req?.headers?.['x-forwarded-proto']
    || (req?.connection?.encrypted ? 'https' : 'http');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function partnerCapabilities() {
  const chain = protocolChainConfig();
  return {
    apiVersion: PARTNER_ONCHAIN_API_VERSION,
    venue: {
      id: 'pronos',
      name: 'Pronos',
      type: 'prediction_market',
      defaultLocale: 'es',
      supportedLocales: ['es', 'en'],
    },
    capabilities: {
      marketDiscovery: true,
      marketDetail: true,
      quotes: true,
      calldata: true,
      positionsByWallet: true,
      serverSideExecution: false,
      directWalletSigning: true,
      actions: ['buy', 'sell', 'redeem'],
      marketTypes: ['binary', 'multi_outcome'],
      settlement: 'onchain',
    },
    chain: {
      chainId: chain.chainId,
      collateral: {
        symbol: chain.collateralSymbol,
        address: chain.collateralAddress,
        decimals: chain.collateralDecimals,
      },
    },
  };
}

export function withPartnerEnvelope(req, payload = {}) {
  return {
    ...partnerCapabilities(),
    ...payload,
    generatedAt: new Date().toISOString(),
    links: {
      documentationPath: 'docs/bitso-onchain-integration.md',
      ...payload.links,
    },
  };
}

export function marketUrl(req, marketId) {
  return `${publicBaseUrl(req)}/points/market?id=${encodeURIComponent(String(marketId))}`;
}

export function toPartnerMarket(rowOrPayload, { req, includeRules = false } = {}) {
  const m = rowOrPayload?.mode === 'onchain'
    ? rowOrPayload
    : buildProtocolMarketPayload(rowOrPayload || {});
  const outcomes = Array.isArray(m.outcomes) ? m.outcomes : ['Sí', 'No'];
  const outcomesEs = Array.isArray(m.outcomes_es) ? m.outcomes_es : outcomes;
  const outcomesEn = Array.isArray(m.outcomes_en) ? m.outcomes_en : outcomes;
  const prices = Array.isArray(m.prices) ? m.prices.map(numberOrNull) : null;
  const outcomeImages = Array.isArray(m.outcomeImages) ? m.outcomeImages : [];
  const endMs = m.endTime ? new Date(m.endTime).getTime() : 0;
  const tradable = m.status === 'active'
    && !!m.poolAddress
    && (!endMs || endMs > Date.now());

  return {
    id: String(m.id),
    venueMarketId: `pronos:${m.chainId || 'unknown'}:${m.marketId ?? m.id}`,
    chainMarketId: m.marketId != null ? String(m.marketId) : null,
    poolAddress: m.poolAddress || null,
    factoryAddress: m.factoryAddress || null,
    chainId: m.chainId != null ? Number(m.chainId) : null,
    protocolVersion: m.protocolVersion || null,
    marketType: outcomes.length === 2 ? 'binary' : 'multi_outcome',
    status: m.status || null,
    tradable,
    question: {
      default: m.question || m.title || null,
      es: m.title_es || m.question || null,
      en: m.title_en || m.question || null,
    },
    category: m.category || 'general',
    tags: {
      category: m.categoryTags || [],
      geo: m.geoTags || [],
      topic: m.topicTags || [],
    },
    times: {
      start: m.startTime || null,
      close: m.endTime || null,
      created: m.createdAt || null,
      resolved: m.resolvedAt || null,
    },
    outcomes: outcomes.map((label, index) => ({
      index,
      label,
      labels: {
        es: outcomesEs[index] || label,
        en: outcomesEn[index] || label,
      },
      price: prices ? prices[index] ?? null : null,
      imageUrl: outcomeImages[index] || null,
      winner: m.outcome != null ? Number(m.outcome) === index : null,
    })),
    prices,
    liquidity: numberOrNull(m.liquidity) ?? 0,
    volume24h: numberOrNull(m.volume24h) ?? 0,
    seedLiquidity: numberOrNull(m.seedLiquidity) ?? 0,
    snapshotAt: m.snapshotAt || null,
    resolver: {
      type: m.resolverType || null,
      source: m.resolverSource || m.source || null,
      sourceEventId: m.sourceEventId || null,
      finalScore: m.finalScore || null,
    },
    links: {
      web: req ? marketUrl(req, m.id) : null,
      tx: m.txHash ? `https://arbiscan.io/tx/${m.txHash}` : null,
    },
    ...(includeRules ? {
      rules: {
        resolutionSource: m.resolutionSource || m.resolverSource || m.source || null,
        resolutionCandidate: m.resolutionCandidate || null,
        lifecycleNote: m.lifecycleNote || null,
      },
    } : {}),
  };
}

export function partnerMarketSelectSql() {
  return `
    SELECT m.id, m.market_id, m.pool_address, m.factory_address, m.chain_id,
           m.question, m.category, m.icon, m.sport, m.league, m.outcome_images,
           m.category_tags, m.geo_tags, m.topic_tags,
           m.source, m.source_event_id, m.resolver_type, m.resolver_config,
           m.outcomes, m.outcome_count,
           m.protocol_version, m.start_time, m.end_time, m.status, m.featured, m.previous_status,
           m.lifecycle_note, m.lifecycle_updated_at, m.lifecycle_updated_by,
           m.canceled_at, m.dispute_opened_at, m.outcome,
           m.seed_liquidity, m.tx_hash, m.created_at, m.resolved_at, m.final_score,
           pppm.source_data AS protocol_source_data,
           s.yes_price AS s_yes, s.no_price AS s_no, s.prices AS s_prices,
           s.liquidity AS s_liquidity, s.volume_24h AS s_volume,
           s.snapshot_at AS s_snapshot
      FROM protocol_markets m
      LEFT JOIN protocol_pending_markets pppm ON pppm.approved_protocol_market_id = m.id
      LEFT JOIN LATERAL (
        SELECT yes_price, no_price, prices, liquidity, volume_24h, snapshot_at
          FROM price_snapshots
         WHERE market_id = m.id
         ORDER BY snapshot_at DESC
         LIMIT 1
      ) s ON TRUE
  `;
}

export async function readPartnerMarketRows(sql, {
  status = 'active',
  category = null,
  chainId = null,
  limit = 100,
} = {}) {
  const query = `
    ${partnerMarketSelectSql()}
     WHERE ($1::text = 'all' OR m.status = $1::text)
       AND ($2::text IS NULL OR LOWER(m.category) = LOWER($2::text))
       AND ($3::int IS NULL OR m.chain_id = $3::int)
     ORDER BY
       CASE WHEN m.status = 'active' THEN 0 ELSE 1 END,
       CASE WHEN m.start_time IS NOT NULL
             AND m.start_time <= NOW()
             AND m.end_time > NOW() THEN 0 ELSE 1 END,
       CASE WHEN m.status = 'active' THEN m.end_time END ASC NULLS LAST,
       m.created_at DESC,
       m.id DESC
     LIMIT $4
  `;
  const result = await sql.query(query, [status, category, chainId, limit]);
  return result?.rows || [];
}

export async function readPartnerMarketRow(sql, { lookup, chainId = null } = {}) {
  const query = `
    ${partnerMarketSelectSql()}
     WHERE (
       ($1::int IS NOT NULL AND (m.id = $1::int OR m.market_id = $1::int))
       OR ($2::text IS NOT NULL AND LOWER(m.pool_address) = LOWER($2::text))
     )
       AND ($3::int IS NULL OR m.chain_id = $3::int)
     ORDER BY
       CASE
         WHEN $1::int IS NOT NULL AND m.id = $1::int THEN 0
         WHEN $1::int IS NOT NULL AND m.market_id = $1::int THEN 1
         ELSE 2
       END,
       m.id DESC
     LIMIT 1
  `;
  const result = await sql.query(query, [
    lookup?.dbId || lookup?.chainMarketId || null,
    lookup?.poolAddress || null,
    chainId,
  ]);
  return result?.rows?.[0] || null;
}

export function partnerError(res, status, error, detail = null) {
  return res.status(status).json({
    error,
    ...(detail ? { detail } : {}),
    generatedAt: new Date().toISOString(),
  });
}

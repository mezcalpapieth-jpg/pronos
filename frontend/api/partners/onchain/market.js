import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import {
  applyPartnerCors,
  normalizeChainId,
  normalizeMarketLookup,
  partnerError,
  readPartnerMarketRow,
  toPartnerMarket,
  withPartnerEnvelope,
} from '../../_lib/partner-onchain.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function marketIdFromRequest(req) {
  const queryId = req.query?.marketId || req.query?.id || req.query?.poolAddress;
  if (queryId) return String(queryId);
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  return path.split('/').pop();
}

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return partnerError(res, 405, 'method_not_allowed');

  const limited = rateLimit(req, res, {
    key: `partner-onchain-market:${clientIp(req)}`,
    limit: 300,
    windowMs: 60_000,
    structuredError: true,
  });
  if (limited) return;

  const lookup = normalizeMarketLookup(marketIdFromRequest(req));
  if (!lookup.dbId && !lookup.poolAddress) {
    return partnerError(res, 400, 'invalid_market_id', 'Use a Pronos market id, chain market id, or pool address.');
  }

  try {
    await ensureProtocolSchema(schemaSql);
    const chainId = normalizeChainId(req.query?.chainId ?? req.query?.chain_id);
    const row = await readPartnerMarketRow(sql, { lookup, chainId });
    if (!row) return partnerError(res, 404, 'market_not_found');

    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    return res.status(200).json(withPartnerEnvelope(req, {
      market: toPartnerMarket(row, { req, includeRules: true }),
    }));
  } catch (e) {
    console.error('[partners/onchain/market] failed', { message: e?.message, code: e?.code });
    return partnerError(res, 500, 'market_failed', 'Could not load partner market.');
  }
}


import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import {
  applyPartnerCors,
  normalizeChainId,
  normalizeLimit,
  normalizeStatus,
  partnerError,
  readPartnerMarketRows,
  toPartnerMarket,
  withPartnerEnvelope,
} from '../../_lib/partner-onchain.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return partnerError(res, 405, 'method_not_allowed');

  const limited = rateLimit(req, res, {
    key: `partner-onchain-markets:${clientIp(req)}`,
    limit: 240,
    windowMs: 60_000,
    structuredError: true,
  });
  if (limited) return;

  try {
    await ensureProtocolSchema(schemaSql);
    const status = normalizeStatus(req.query?.status);
    const category = typeof req.query?.category === 'string' && req.query.category.trim()
      ? req.query.category.trim().toLowerCase()
      : null;
    const chainId = normalizeChainId(req.query?.chainId ?? req.query?.chain_id);
    const limit = normalizeLimit(req.query?.limit, { fallback: 100, max: 200 });
    const rows = await readPartnerMarketRows(sql, { status, category, chainId, limit });

    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    return res.status(200).json(withPartnerEnvelope(req, {
      count: rows.length,
      filters: { status, category, chainId, limit },
      markets: rows.map(row => toPartnerMarket(row, { req })),
    }));
  } catch (e) {
    console.error('[partners/onchain/markets] failed', { message: e?.message, code: e?.code });
    return partnerError(res, 500, 'markets_failed', 'Could not load partner markets.');
  }
}


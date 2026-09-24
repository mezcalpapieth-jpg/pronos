import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import { quoteBuyOnChain, quoteSellOnChain } from '../../_lib/onchain-trader.js';
import {
  applyPartnerCors,
  normalizeAction,
  normalizeChainId,
  normalizeMarketLookup,
  normalizeOutcomeIndex,
  partnerError,
  positiveNumber,
  readPartnerMarketRow,
  toPartnerMarket,
  withPartnerEnvelope,
} from '../../_lib/partner-onchain.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function marketForChain(row) {
  return {
    chain_address: row.pool_address,
    outcomes: Array.isArray(row.outcomes) ? row.outcomes : JSON.parse(row.outcomes || '["Sí","No"]'),
  };
}

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'POST, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'POST') return partnerError(res, 405, 'method_not_allowed');

  const limited = rateLimit(req, res, {
    key: `partner-onchain-quote:${clientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
    structuredError: true,
  });
  if (limited) return;

  const body = req.body || {};
  const action = normalizeAction(body.action || body.side || 'buy');
  if (!action || action === 'redeem') {
    return partnerError(res, 400, 'invalid_action', 'Quote supports buy or sell.');
  }
  const lookup = normalizeMarketLookup(body.marketId || body.id || body.poolAddress);
  if (!lookup.dbId && !lookup.poolAddress) return partnerError(res, 400, 'invalid_market_id');
  const outcomeIndex = normalizeOutcomeIndex(body.outcomeIndex);
  if (outcomeIndex === null) return partnerError(res, 400, 'invalid_outcome_index');

  const collateral = positiveNumber(body.collateral ?? body.amount);
  const shares = positiveNumber(body.shares ?? body.amount);
  if (action === 'buy' && collateral === null) return partnerError(res, 400, 'invalid_collateral');
  if (action === 'sell' && shares === null) return partnerError(res, 400, 'invalid_shares');

  try {
    await ensureProtocolSchema(schemaSql);
    const chainId = normalizeChainId(body.chainId ?? body.chain_id);
    const row = await readPartnerMarketRow(sql, { lookup, chainId });
    if (!row) return partnerError(res, 404, 'market_not_found');
    if (row.status !== 'active') return partnerError(res, 400, 'market_closed');
    if (row.end_time && new Date(row.end_time) <= new Date()) {
      return partnerError(res, 400, 'market_expired');
    }
    const market = marketForChain(row);
    if (!market.chain_address) return partnerError(res, 400, 'market_missing_pool');
    if (outcomeIndex >= market.outcomes.length) return partnerError(res, 400, 'invalid_outcome_index');

    const quote = action === 'buy'
      ? await quoteBuyOnChain({ market, outcomeIndex, collateral })
      : await quoteSellOnChain({ market, outcomeIndex, shares });

    return res.status(200).json(withPartnerEnvelope(req, {
      market: toPartnerMarket(row, { req }),
      request: {
        action,
        outcomeIndex,
        collateral: action === 'buy' ? collateral : null,
        shares: action === 'sell' ? shares : null,
      },
      quote,
    }));
  } catch (e) {
    if (e?.status) return partnerError(res, e.status, e.message, e.detail);
    console.error('[partners/onchain/quote] failed', { message: e?.message, code: e?.code });
    return partnerError(res, 500, 'quote_failed', 'Could not quote partner trade.');
  }
}


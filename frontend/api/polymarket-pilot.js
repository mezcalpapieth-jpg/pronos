import { applyCors } from './_lib/cors.js';
import { POLYMARKET_BUILDER_PROFILE } from './_lib/polymarket-builder.js';
import {
  discoverSportsMarkets,
  loadPolymarketSnapshot,
  quotePolymarket,
} from './_lib/polymarket-distribution.js';

// These are immutable pilot capabilities, not a production trading toggle.
export const POLYMARKET_PILOT_POLICY = Object.freeze({
  mode: 'read_only',
  tradingEnabled: false,
  subsidizesVenueFees: false,
  subsidizesFunding: false,
  pronosRebateBps: 0,
  builderCode: POLYMARKET_BUILDER_PROFILE.code,
  builderFeeBps: POLYMARKET_BUILDER_PROFILE.takerFeeBps,
  makerFeeBps: POLYMARKET_BUILDER_PROFILE.makerFeeBps,
  builderFeeStatus: 'target_unverified',
  feeCollectionVerified: false,
  chainId: 137,
  collateral: 'pUSD',
});

function badQuery(code = 'invalid_query') {
  const error = new Error(code);
  error.code = code;
  error.status = 400;
  return error;
}

function readQuery(req) {
  const query = req.query ?? Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw badQuery();
  const allowed = new Set(['action', 'limit', 'marketId', 'outcomeIndex', 'side', 'amount']);
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 100) throw badQuery();
  }
  // Vercel preserves duplicate query values as arrays. Cover raw Node requests too.
  if (req.query == null) {
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw badQuery();
  }
  return query;
}

export function createPolymarketPilotHandler({
  discover = discoverSportsMarkets,
  loadSnapshot = loadPolymarketSnapshot,
  quote = quotePolymarket,
  env = process.env,
  now = Date.now,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (applyCors(req, res, { methods: 'GET, OPTIONS' })) return;
    if (env.POLYMARKET_PILOT_ENABLED !== 'true') {
      return res.status(404).json({ ok: false, error: 'polymarket_pilot_disabled' });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      return res.status(405).json({ ok: false, error: 'read_only_pilot' });
    }
    try {
      const query = readQuery(req);
      const action = query.action || 'markets';
      if (action === 'markets') {
        if (Object.keys(query).some(key => !['action', 'limit'].includes(key))) throw badQuery();
        const limit = query.limit ?? '5';
        if (!/^[1-5]$/.test(limit)) throw badQuery('invalid_limit');
        const markets = await discover({ limit: Number(limit), now });
        return res.status(200).json({ ok: true, markets, policy: POLYMARKET_PILOT_POLICY });
      }
      if (action !== 'quote') throw badQuery('unsupported_action');
      if (query.limit != null) throw badQuery();
      if (!/^[1-9]\d{0,17}$/.test(query.marketId || '')) throw badQuery('invalid_market_id');
      if (!/^[01]$/.test(query.outcomeIndex || '')) throw badQuery('invalid_outcome');
      if (!['buy', 'sell'].includes(query.side)) throw badQuery('invalid_side');
      if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(query.amount || '')
        || Number(query.amount) <= 0 || Number(query.amount) > 1000000) throw badQuery('invalid_amount');
      const snapshot = await loadSnapshot({
        marketId: query.marketId,
        outcomeIndex: Number(query.outcomeIndex),
        now,
      });
      const result = quote({ snapshot, side: query.side, amount: query.amount, now });
      return res.status(200).json({
        ok: true,
        quote: result,
        market: snapshot.market,
        policy: POLYMARKET_PILOT_POLICY,
      });
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[a-z_]{1,80}$/i.test(error.code)
        ? error.code.toLowerCase() : 'market_data_unavailable';
      if (code === 'unsupported_cancellation') return res.status(422).json({ ok: false, error: code });
      return res.status(error?.status === 400 ? 400 : 502).json({ ok: false, error: code });
    }
  };
}

export default createPolymarketPilotHandler();

import { applyCors } from './_lib/cors.js';
import { checkoutData } from './_lib/mxn-checkout-data.js';
import { checkoutError, FEE_CAP_BPS, quoteMxn, TICKETS_MXN } from './_lib/mxn-checkout-quote.js';
import { createMxnFundingQuoteService } from './_lib/mxn-funding-quote.js';

const POLICY = Object.freeze({
  mode: 'read_only', tradingEnabled: false, feeCapBps: FEE_CAP_BPS,
  fundingEnabled: false, subsidizesVenueFees: false, subsidizesFunding: false,
});

const venueOptions = ['hip4', 'polymarket'];
const amountOptions = TICKETS_MXN.map(String);

function params(req) {
  if (req.query != null) return req.query;
  const query = new URL(req.url || '/', 'http://localhost').searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) throw checkoutError('invalid_query');
  return Object.fromEntries(query);
}

function readQuoteQuery(query) {
  const { venue, marketId, outcomeIndex, side, amountMxn } = query;
  if (Object.keys(query).length !== 6 || !venueOptions.includes(venue)
    || !/^[1-9]\d{0,17}$/.test(marketId ?? '') || !['0', '1'].includes(outcomeIndex)
    || !['buy', 'sell'].includes(side) || !amountOptions.includes(amountMxn)) {
    throw checkoutError('invalid_query');
  }
  return { venue, marketId, outcomeIndex: Number(outcomeIndex), side, ticketMxn: Number(amountMxn) };
}

function readFundingQuery(query) {
  const { venue, direction, amountMxn } = query;
  if (Object.keys(query).length !== 4 || !venueOptions.includes(venue)
    || !['deposit', 'withdrawal'].includes(direction) || !amountOptions.includes(amountMxn)) {
    throw checkoutError('invalid_query');
  }
  return { venue, direction, ticketMxn: Number(amountMxn) };
}

export function createMxnCheckoutHandler({
  env = process.env, now = Date.now, data = checkoutData({ now }),
  funding = createMxnFundingQuoteService({ now, fx: () => data.fx() }),
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (applyCors(req, res, { methods: 'GET, OPTIONS' })) return;
    if (env.MXN_CHECKOUT_ENABLED !== 'true') {
      return res.status(404).json({ ok: false, error: 'mxn_checkout_disabled' });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      return res.status(405).json({ ok: false, error: 'read_only_checkout' });
    }
    try {
      const query = params(req);
      if (!query || typeof query !== 'object' || Array.isArray(query)
        || Object.values(query).some(value => typeof value !== 'string' || value.length > 100)) {
        throw checkoutError('invalid_query');
      }
      if (query.action === 'markets' && Object.keys(query).length === 1) {
        const result = await data.markets();
        return res.status(200).json({ ok: true, ...result, policy: POLICY });
      }
      if (query.action === 'funding') {
        const quote = await funding.quote(readFundingQuery(query));
        return res.status(200).json({ ok: true, quote, policy: POLICY });
      }
      if (query.action !== 'quote') throw checkoutError('invalid_query');
      const input = readQuoteQuery(query);
      const [snapshot, fx] = await Promise.all([data.snapshot(input), data.fx()]);
      const quote = quoteMxn({ snapshot, fx, ...input, nowMs: now() });
      return res.status(200).json({ ok: true, market: snapshot.market, quote, policy: POLICY });
    } catch (error) {
      const code = /^[a-z_]{1,80}$/i.test(error?.code ?? '') ? error.code.toLowerCase() : 'market_data_unavailable';
      const status = code === 'invalid_query' ? 400 : ['market_not_trading', 'unsupported_cancellation'].includes(code) ? 422 : 502;
      return res.status(status).json({ ok: false, error: code });
    }
  };
}

export default createMxnCheckoutHandler();

/**
 * @deprecated DO NOT USE — Polymarket CLOB proxy removed.
 *
 * Pronos used to proxy Polymarket's centralized order book here so
 * the browser could derive API keys, place orders, fetch books, and
 * read positions without CORS pain. As of 2026-05-06 Pronos runs its
 * own AMM protocol on Arbitrum (MarketFactory + PronosAMM + PronosToken)
 * with MXNB collateral on mainnet and USDC on Sepolia. Trades are
 * dispatched server-side through /api/protocol/{buy,sell,redeem} via
 * Turnkey delegated signing — no CLOB, no L1/L2 signature flow.
 *
 * This handler is kept as a 410 Gone responder so any stale caller
 * (an old admin tool, a leftover bookmark, a forgotten browser tab)
 * fails loudly instead of pinging Polymarket again.
 *
 * Frontend partner: /frontend/app/src/lib/clob.js — also stubbed.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(410).json({
    error: 'gone',
    message: 'Polymarket CLOB proxy removed. Use /api/protocol/{buy,sell,redeem,markets,positions}.',
  });
}

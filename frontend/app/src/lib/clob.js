/**
 * @deprecated Polymarket CLOB integration removed.
 *
 * Pronos used to mirror Polymarket markets and place orders on its
 * CTF Exchange via this module. As of 2026-05-06 we run our OWN
 * AMM protocol on Arbitrum (MarketFactory + PronosAMM + PronosToken),
 * with MXNB collateral on mainnet and a USDC stand-in on Sepolia.
 * Trades go through /api/protocol/buy and Turnkey-signed transactions.
 *
 * Every function in this file now throws so any stale caller fails
 * loudly with a useful migration message instead of silently hitting
 * Polymarket. Constants are kept for backward-compat; they're inert
 * (Polygon is no longer in the chain map).
 *
 * Once `frontend/app/src/components/MarketsGrid.jsx` and any other
 * stale importers are migrated to /api/protocol/markets, this entire
 * file (and `frontend/api/clob.js`) can be deleted.
 */

const REMOVED = 'polymarket_clob_removed';

function gone(name) {
  const err = new Error(REMOVED);
  err.detail = `${name}: Polymarket CLOB removed; use /api/protocol/* endpoints`;
  throw err;
}

// ── Inert constants (kept so import statements still resolve) ──────
export const POLYGON_CHAIN_ID = 137;
export const USDC_ADDRESS     = '0x0000000000000000000000000000000000000000';
export const MXNB_ADDRESS     = USDC_ADDRESS;
export const CTF_EXCHANGE     = '0x0000000000000000000000000000000000000000';
export const NEG_RISK_ADAPTER = '0x0000000000000000000000000000000000000000';
export const NEG_RISK_EXCHANGE = '0x0000000000000000000000000000000000000000';

// ── Pure helpers — kept because they're trivially correct and a
//    couple of UI components may still call them for display math ──
export function usdcToRaw(amount) { return BigInt(Math.round(amount * 1e6)); }
export function rawToUsdc(raw) { return Number(raw) / 1e6; }

// ── Network-touching helpers — every call throws ───────────────────
export async function getUsdcBalance() { gone('getUsdcBalance'); }
export async function getUsdcAllowance() { gone('getUsdcAllowance'); }
export async function approveUsdc() { gone('approveUsdc'); }
export async function deriveClobApiKey() { gone('deriveClobApiKey'); }
export async function placeClobOrder() { gone('placeClobOrder'); }
export async function getClobPositions() { gone('getClobPositions'); }
export async function fetchOrderBook() { gone('fetchOrderBook'); }
export function simulateMarketBuy() { gone('simulateMarketBuy'); }

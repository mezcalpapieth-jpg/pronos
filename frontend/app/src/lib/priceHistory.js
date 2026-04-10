// ─── PRICE HISTORY CLIENT ───────────────────────────────────────────────────
// Client-side helpers to fetch and use Polymarket price history from our own
// /api/price-history proxy endpoint.

const API = '/api/price-history';

function isLocal() {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}
const base = isLocal() ? 'https://pronos.io' : '';

/**
 * Fetch price history for one or more clobTokenIds in a single request.
 *
 * @param {string[]} tokenIds           list of clobTokenIds
 * @param {object}   opts
 * @param {string}   opts.interval      "1h" | "6h" | "1d" | "1w" | "1m" | "max"
 * @param {number}   opts.fidelity      resolution in minutes (1–1440)
 * @returns {Promise<Record<string, Array<{t:number,p:number}>>>}
 *          map from clobTokenId → points (p is 0–100)
 */
export async function fetchPriceHistory(tokenIds, opts = {}) {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return {};
  const ids = tokenIds.filter(Boolean);
  if (ids.length === 0) return {};

  const qs = new URLSearchParams({
    clobTokenIds: ids.join(','),
    interval: opts.interval || '1w',
    fidelity: String(opts.fidelity || 60),
  });

  try {
    const res = await fetch(`${base}${API}?${qs.toString()}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.history || {};
  } catch (_) {
    return {};
  }
}

/**
 * Given a market (with `_clobTokenIds`) and a history map, return the price
 * series for a specific option index as an array of numbers (0–100). Returns
 * null when there's no history available, so callers can fall back to the
 * seeded mock in <Sparkline>.
 *
 * Polymarket usually has two clobTokenIds per market: [YES, NO]. For binary
 * markets the "No" series is just `100 - p` of the "Yes" series, but we keep
 * them independent in case CLOB returns different data.
 */
export function extractSeries(market, historyMap, optionIndex = 0) {
  const tokenId = market?._clobTokenIds?.[optionIndex];
  if (!tokenId || !historyMap) return null;
  const points = historyMap[tokenId];
  if (!Array.isArray(points) || points.length < 2) return null;
  return points.map(pt => pt.p);
}

/**
 * Collect every clobTokenId from a list of markets — handy for MarketsGrid to
 * batch a single request for every visible card.
 */
export function collectTokenIds(markets) {
  const set = new Set();
  for (const m of markets || []) {
    const ids = m?._clobTokenIds;
    if (Array.isArray(ids)) ids.forEach(id => id && set.add(id));
  }
  return Array.from(set);
}
